#!/usr/bin/env node
/**
 * Schema ↔ migration drift check.
 *
 * Runs as part of `npm run check`. Catches the recurring class of bug that's
 * caused four "column does not exist" 500s in production:
 *
 *   1. PR #18 — users.email_verification_token et al
 *   2. PR #21 — rides.virtual_amount_authorized, rides.stripe_authorized_amount
 *   3. PR #22 — driver_profiles.vehicle_photo_urls
 *   4. PR #25 — driver_profiles.checkr_candidate_id, checkr_report_id, ...
 *
 * The pattern: someone adds a column to `shared/schema.ts` and to the
 * CREATE TABLE block in `scripts/migrate.mjs`, but forgets the matching
 * ALTER TABLE ADD COLUMN IF NOT EXISTS. CREATE TABLE IF NOT EXISTS is a
 * no-op on existing tables, so production DBs (created before the new
 * column existed) never get it. Drizzle's `select()` lists every schema
 * column → query fails → 500.
 *
 * What this checks:
 *
 *   For every column declared in `shared/schema.ts`:
 *     (a) MUST appear in `scripts/migrate.mjs` somewhere (either a CREATE
 *         TABLE block OR an ALTER TABLE ADD COLUMN IF NOT EXISTS). Catches
 *         forgotten migrations.
 *     (b) IF the table is in the LIVE_TABLES list (already in production),
 *         the column MUST also appear in an ALTER block UNLESS it's listed
 *         as legacy (was in the table at first deploy and never needed
 *         backfilling). Catches the four-time bug above.
 *
 * Legacy columns are tracked in `migration-drift-baseline.json` next to
 * this script. To regenerate the baseline (only do this when you understand
 * what you're doing — usually only when bringing a new "live" table under
 * the check), run:
 *
 *     node scripts/check-migration-drift.mjs --write-baseline
 *
 * Exit codes:
 *   0  — no drift
 *   1  — drift detected
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const SCHEMA_PATH = resolve(REPO, "shared/schema.ts");
const MIGRATE_PATH = resolve(REPO, "scripts/migrate.mjs");
const BASELINE_PATH = resolve(__dirname, "migration-drift-baseline.json");

// Tables already deployed to production. New columns added to these tables
// must be backfilled with ALTER TABLE ADD COLUMN IF NOT EXISTS so existing
// rows in prod actually pick up the column. Tables not in this list are
// presumed to be either newly created (no prod DB has them yet) or unused.
const LIVE_TABLES = new Set([
  "sessions",
  "users",
  "driver_profiles",
  "vehicles",
  "rides",
  "shared_ride_groups",
  "ride_groups",
  "push_subscriptions",
  "payout_requests",
  "disputes",
  "emergency_incidents",
  "driver_weekly_hours",
  "driver_ownership",
  "share_certificates",
  "ownership_rebalance_log",
  "profit_declarations",
  "profit_distributions",
  "admin_activity_log",
  "wallet_transactions",
  "conversations",
  "chat_messages",
  "driver_rate_cards",
  "event_tracking",
  "ai_feedback",
  "platform_insights",
  "faq_entries",
  "demand_heatmap",
  "driver_scorecard",
  "safety_alerts",
]);

// ── Parse uniqueness declarations ─────────────────────────────────────────
//
// Catches the AH-062 / AH-066 bug class where schema.ts declares
// `index("foo_unique")` (a regular non-unique index whose name HAPPENS to
// say "unique") while migrate.mjs adds a real UNIQUE constraint via
// CREATE UNIQUE INDEX or ALTER TABLE ADD CONSTRAINT ... UNIQUE. The DB
// has the constraint, prod is correct — but a dev environment synced via
// drizzle-kit push gets only the non-unique index, defeating the very
// invariant the constraint is meant to enforce (idempotency / duplicate
// rejection).
//
// We canonicalize each declaration as a stable signature and require the
// schema/migrate signatures to agree.

function parseSchemaIndexes(src) {
  // Match index("name") and uniqueIndex("name") calls. We capture the
  // builder kind (index vs uniqueIndex) and the index name. This is the
  // Drizzle-side surface that drizzle-kit push would emit.
  const indexes = []; // { kind: "index"|"uniqueIndex", name }
  const idxRegex = /\b(index|uniqueIndex)\(\s*"([^"]+)"\s*\)/g;
  let m;
  while ((m = idxRegex.exec(src))) {
    indexes.push({ kind: m[1], name: m[2] });
  }
  return indexes;
}

function parseMigrateIndexes(src) {
  // Extract the SQL block.
  const sqlMatch = src.match(/const SQL = `([\s\S]*?)`;/);
  if (!sqlMatch) return [];
  const sql = sqlMatch[1];

  const indexes = []; // { kind: "index"|"uniqueIndex", name }

  // CREATE [UNIQUE] INDEX [IF NOT EXISTS] name ON ...
  const ciRegex = /CREATE\s+(UNIQUE\s+)?INDEX(?:\s+IF NOT EXISTS)?\s+"?([a-z_][a-z0-9_]*)"?\s+ON\b/gi;
  let m;
  while ((m = ciRegex.exec(sql))) {
    const isUnique = !!m[1];
    indexes.push({ kind: isUnique ? "uniqueIndex" : "index", name: m[2] });
  }

  // ALTER TABLE ... ADD CONSTRAINT name UNIQUE (...). Treated as a unique
  // index for drift-checking purposes (Drizzle's uniqueIndex covers either
  // representation).
  const acRegex = /ADD\s+CONSTRAINT\s+"?([a-z_][a-z0-9_]*)"?\s+UNIQUE\b/gi;
  while ((m = acRegex.exec(sql))) {
    indexes.push({ kind: "uniqueIndex", name: m[1] });
  }

  return indexes;
}

function checkIndexKindDrift(schemaIndexes, migrateIndexes) {
  // Group by name from both sides. Mismatched kinds (index in one, unique
  // in the other) are the bug we're hunting.
  const byName = new Map(); // name → { schema: kind|null, migrate: kind|null }
  for (const { name, kind } of schemaIndexes) {
    const entry = byName.get(name) ?? { schema: null, migrate: null };
    entry.schema = kind;
    byName.set(name, entry);
  }
  for (const { name, kind } of migrateIndexes) {
    const entry = byName.get(name) ?? { schema: null, migrate: null };
    entry.migrate = kind;
    byName.set(name, entry);
  }
  const mismatches = [];
  for (const [name, { schema, migrate }] of byName) {
    // Only flag when both sides declare the index AND disagree on uniqueness.
    // Missing-from-one-side is not part of this check (some indexes only
    // live in one place legitimately).
    if (schema && migrate && schema !== migrate) {
      mismatches.push({ name, schema, migrate });
    }
  }
  return mismatches;
}

// ── Parse shared/schema.ts ────────────────────────────────────────────────
function parseSchema(src) {
  const tables = new Map();
  // Match: pgTable("name", { ... }) — the body block ends at "\n}" at the
  // same nesting level. We rely on the project's consistent formatting.
  const tableRegex = /pgTable\(\s*"(\w+)"\s*,\s*\{([\s\S]*?)\n\s*\}/g;
  let m;
  while ((m = tableRegex.exec(src))) {
    const tableName = m[1];
    const block = m[2];
    const cols = [];
    // Each property: someName: someType("snake_name", ...). We only want
    // the snake_name (DB column).
    const propRegex = /(\w+):\s*\w+\(\s*"(\w+)"/g;
    let pm;
    while ((pm = propRegex.exec(block))) {
      cols.push(pm[2]);
    }
    tables.set(tableName, cols);
  }
  return tables;
}

// ── Parse scripts/migrate.mjs ─────────────────────────────────────────────
function parseMigrate(src) {
  // Extract the SQL string literal.
  const sqlMatch = src.match(/const SQL = `([\s\S]*?)`;/);
  if (!sqlMatch) throw new Error("Could not find `const SQL = `...`` in migrate.mjs");
  const sql = sqlMatch[1];

  const createTables = new Map(); // table → Set<column>
  const alters = new Map(); // table → Set<column>

  // CREATE TABLE [IF NOT EXISTS] "?name"? ( ... );
  const ctRegex = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?(\w+)"?\s*\(([\s\S]*?)\n\);/g;
  let m;
  while ((m = ctRegex.exec(sql))) {
    const tableName = m[1];
    const body = m[2];
    const cols = new Set();
    // Each column line starts with whitespace + identifier (lowercase letters,
    // digits, underscores) followed by space and a type. Skip CONSTRAINT
    // and FOREIGN KEY lines.
    const lineRegex = /^\s*"?([a-z_][a-z0-9_]*)"?\s+(?!CONSTRAINT|FOREIGN|PRIMARY|UNIQUE|CHECK)\S/gm;
    let lm;
    while ((lm = lineRegex.exec(body))) {
      cols.add(lm[1]);
    }
    createTables.set(tableName, cols);
  }

  // ALTER TABLE [IF EXISTS] "?name"? ADD COLUMN [IF NOT EXISTS] "?col"? ...;
  const alterRegex = /ALTER TABLE\s+(?:IF EXISTS\s+)?"?(\w+)"?\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+"?(\w+)"?/g;
  while ((m = alterRegex.exec(sql))) {
    const tableName = m[1];
    const colName = m[2];
    if (!alters.has(tableName)) alters.set(tableName, new Set());
    alters.get(tableName).add(colName);
  }

  return { createTables, alters };
}

// ── Baseline ──────────────────────────────────────────────────────────────
function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return { legacy: {} };
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
}

function saveBaseline(baseline) {
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify(baseline, null, 2) + "\n",
    "utf8",
  );
}

// ── Main ──────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const writeBaseline = args.includes("--write-baseline");

  const schemaSrc = readFileSync(SCHEMA_PATH, "utf8");
  const migrateSrc = readFileSync(MIGRATE_PATH, "utf8");

  const schemaTables = parseSchema(schemaSrc);
  const { createTables, alters } = parseMigrate(migrateSrc);
  const schemaIndexes = parseSchemaIndexes(schemaSrc);
  const migrateIndexes = parseMigrateIndexes(migrateSrc);
  const indexMismatches = checkIndexKindDrift(schemaIndexes, migrateIndexes);

  const baseline = loadBaseline();
  const legacy = baseline.legacy || {};

  const missingFromMigrate = []; // column entirely absent
  const missingAlter = []; // column in CREATE TABLE but no ALTER (and not legacy)
  const newlyDetectedLegacy = {}; // for --write-baseline

  for (const [table, schemaCols] of schemaTables) {
    const ctCols = createTables.get(table) || new Set();
    const alterCols = alters.get(table) || new Set();
    const legacyCols = new Set(legacy[table] || []);

    for (const col of schemaCols) {
      const inCreate = ctCols.has(col);
      const inAlter = alterCols.has(col);

      if (!inCreate && !inAlter) {
        missingFromMigrate.push({ table, col });
        continue;
      }

      // Live tables: column must be in ALTER or in the legacy allowlist.
      // Tables not in LIVE_TABLES are presumed not deployed yet, so the
      // CREATE TABLE alone is fine (fresh DB will pick it up).
      if (LIVE_TABLES.has(table) && !inAlter) {
        if (legacyCols.has(col)) continue;
        if (writeBaseline) {
          if (!newlyDetectedLegacy[table]) newlyDetectedLegacy[table] = [];
          newlyDetectedLegacy[table].push(col);
          continue;
        }
        missingAlter.push({ table, col });
      }
    }
  }

  if (writeBaseline) {
    const merged = { legacy: { ...legacy } };
    for (const [t, cols] of Object.entries(newlyDetectedLegacy)) {
      merged.legacy[t] = Array.from(new Set([...(merged.legacy[t] || []), ...cols])).sort();
    }
    saveBaseline(merged);
    const total = Object.values(newlyDetectedLegacy).reduce((s, a) => s + a.length, 0);
    console.log(`[migration-drift] Wrote baseline with ${total} newly-detected legacy column(s).`);
    if (missingFromMigrate.length) {
      console.error(
        `[migration-drift] Cannot write baseline — ${missingFromMigrate.length} column(s) are missing from migrate.mjs entirely. Fix those first.`,
      );
      for (const { table, col } of missingFromMigrate) {
        console.error(`  - ${table}.${col}`);
      }
      process.exit(1);
    }
    return;
  }

  if (missingFromMigrate.length === 0 && missingAlter.length === 0 && indexMismatches.length === 0) {
    console.log(`[migration-drift] OK — schema.ts and migrate.mjs are in sync (${schemaTables.size} tables checked, ${schemaIndexes.length} schema indexes).`);
    return;
  }

  if (indexMismatches.length > 0) {
    console.error("[migration-drift] ❌ Index uniqueness mismatch between schema.ts and migrate.mjs:");
    console.error("(Caused production bugs AH-062 and AH-066 — schema said index(), migrate.mjs created UNIQUE.");
    console.error(" A fresh dev DB synced via drizzle-kit push would skip the UNIQUE, silently breaking idempotency.)");
    for (const { name, schema, migrate } of indexMismatches) {
      console.error(`  - ${name}: schema=${schema}, migrate=${migrate}`);
    }
    console.error("");
    console.error("Fix: change shared/schema.ts to match migrate.mjs (usually uniqueIndex(...) when migrate.mjs has UNIQUE).");
    console.error("");
  }

  if (missingFromMigrate.length > 0) {
    console.error("[migration-drift] ❌ Columns in shared/schema.ts but missing from scripts/migrate.mjs entirely:");
    for (const { table, col } of missingFromMigrate) {
      console.error(`  - ${table}.${col}`);
    }
    console.error("");
    console.error("Add the column to the CREATE TABLE block AND add an ALTER TABLE ADD COLUMN IF NOT EXISTS for existing prod DBs.");
    console.error("");
  }

  if (missingAlter.length > 0) {
    console.error("[migration-drift] ❌ Columns in CREATE TABLE without a matching ALTER TABLE ADD COLUMN IF NOT EXISTS:");
    console.error("These will not exist on production DBs created before the column was added.");
    for (const { table, col } of missingAlter) {
      console.error(`  - ${table}.${col}`);
    }
    console.error("");
    console.error("Add to scripts/migrate.mjs:");
    console.error("  ALTER TABLE <table> ADD COLUMN IF NOT EXISTS <column> <TYPE> [DEFAULT ...];");
    console.error("");
    console.error("If this column was always part of the original CREATE TABLE and has been");
    console.error("safely deployed before this check existed, regenerate the baseline:");
    console.error("  node scripts/check-migration-drift.mjs --write-baseline");
  }

  process.exit(1);
}

main();
