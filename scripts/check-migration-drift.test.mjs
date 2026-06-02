// AH-064 seed test #2 — migration drift checker.
//
// Smoke-tests the script added in PR #26 (the guardrail that prevents the
// recurring "column does not exist" 500 bug). Spawns the script as a child
// process against the real shared/schema.ts + scripts/migrate.mjs and asserts:
//   (a) it exits 0 on the current main (clean state),
//   (b) it exits 1 when we deliberately introduce a schema column without
//       a matching ALTER (the bug we're trying to prevent).
//
// Doesn't need a DB. Runs in ~1s.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const SCHEMA = resolve(REPO, "shared/schema.ts");
const MIGRATE = resolve(REPO, "scripts/migrate.mjs");
const CHECKER = resolve(__dirname, "check-migration-drift.mjs");

function run() {
  return spawnSync("node", [CHECKER], { encoding: "utf8" });
}

describe("check-migration-drift", () => {
  let schemaBackup;
  let migrateBackup;

  beforeEach(() => {
    schemaBackup = readFileSync(SCHEMA, "utf8");
    migrateBackup = readFileSync(MIGRATE, "utf8");
  });

  afterEach(() => {
    writeFileSync(SCHEMA, schemaBackup, "utf8");
    writeFileSync(MIGRATE, migrateBackup, "utf8");
  });

  it("passes on the current schema/migration state", () => {
    const r = run();
    expect(r.status, `stderr was:\n${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/OK — schema\.ts and migrate\.mjs are in sync/);
  });

  it("fails when a column is added to schema.ts but has no matching ALTER", () => {
    // Insert a brand new column into the users pgTable definition. Because
    // we don't add a matching ALTER in migrate.mjs, the checker should
    // refuse to accept the drift.
    const schema = readFileSync(SCHEMA, "utf8");
    const patched = schema.replace(
      /isDriver: boolean\("is_driver"\)\.default\(false\),/,
      'isDriver: boolean("is_driver").default(false),\n  driftTestColumn: varchar("drift_test_column"),',
    );
    expect(patched).not.toEqual(schema); // sanity — replacement actually fired
    writeFileSync(SCHEMA, patched, "utf8");

    // Also add it to CREATE TABLE in migrate.mjs (so the column isn't
    // missing entirely — which is a different error) but DO NOT add the
    // ALTER. This simulates the exact "in CREATE but no ALTER" scenario
    // from the four production 500s.
    const migrate = readFileSync(MIGRATE, "utf8");
    const patchedMigrate = migrate.replace(
      /is_driver BOOLEAN DEFAULT false,/,
      "is_driver BOOLEAN DEFAULT false,\n  drift_test_column VARCHAR,",
    );
    expect(patchedMigrate).not.toEqual(migrate);
    writeFileSync(MIGRATE, patchedMigrate, "utf8");

    const r = run();
    expect(r.status, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/drift_test_column/);
    expect(r.stderr).toMatch(/Columns in CREATE TABLE without a matching ALTER/);
  });

  it("fails when a column is in schema.ts but completely missing from migrate.mjs", () => {
    const schema = readFileSync(SCHEMA, "utf8");
    const patched = schema.replace(
      /isDriver: boolean\("is_driver"\)\.default\(false\),/,
      'isDriver: boolean("is_driver").default(false),\n  driftMissingColumn: varchar("drift_missing_column"),',
    );
    writeFileSync(SCHEMA, patched, "utf8");
    // Note: we DO NOT touch migrate.mjs.

    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/drift_missing_column/);
    expect(r.stderr).toMatch(/missing from scripts\/migrate\.mjs entirely/);
  });
});
