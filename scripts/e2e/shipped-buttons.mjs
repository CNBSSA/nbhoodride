/**
 * Nothing built is removed — the gate.
 *
 * Company policy (CLAUDE.md, Festus 2026-09-16): a button that has shipped
 * stays. This check keeps a register of every `data-testid="button-…"`
 * that has ever been in client/src (scripts/e2e/shipped-buttons.json) and
 * fails when one is gone from the source unless it is recorded under
 * `retired` with a reason and who approved it. New buttons must be added
 * to the register (`node scripts/e2e/shipped-buttons.mjs --update` does
 * it), so the register is always the full list of what has shipped.
 *
 * Pure source check: no browser, no server, runs in a second. The
 * every-button audit (button-audit.mjs) proves a button works; this proves
 * it is still there.
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const REGISTER_PATH = join(ROOT, "scripts/e2e/shipped-buttons.json");

function sourceFiles(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(tsx|ts)$/.test(f)) out.push(p);
  }
  return out;
}

/** Every button testid in the source: static ids as-is, templated ones as `prefix*`. */
export function inventory(src) {
  const ids = new Set([...src.matchAll(/data-testid=\{?"(button-[^"]+)"/g)].map((m) => m[1]));
  for (const m of src.matchAll(/data-testid=\{`(button-[^`$]+)\$\{/g)) ids.add(`${m[1]}*`);
  return [...ids].sort();
}

/**
 * The rule. `present` is what the source has now; `register` is what has
 * shipped. Returns what is missing without approval, what is new and not
 * yet registered, and what is marked retired but is back.
 */
export function judge(present, register) {
  const have = new Set(present);
  const retired = register.retired ?? {};
  const shipped = register.shipped ?? [];
  const removed = shipped.filter((id) => !have.has(id) && !(id in retired));
  const unregistered = present.filter((id) => !shipped.includes(id));
  const returned = Object.keys(retired).filter((id) => have.has(id));
  const badRetirements = Object.entries(retired)
    .filter(([, r]) => !r || !String(r.reason ?? "").trim() || !String(r.approvedBy ?? "").trim() || !String(r.date ?? "").trim())
    .map(([id]) => id);
  return { removed, unregistered, returned, badRetirements };
}

export function readRegister() {
  return existsSync(REGISTER_PATH) ? JSON.parse(readFileSync(REGISTER_PATH, "utf8")) : { shipped: [], retired: {} };
}

function main() {
  const update = process.argv.includes("--update");
  const src = sourceFiles(join(ROOT, "client/src")).map((p) => readFileSync(p, "utf8")).join("\n");
  const present = inventory(src);
  const register = readRegister();
  const verdict = judge(present, register);
  let failed = false;
  const fail = (msg) => { failed = true; console.log(`❌ ${msg}`); };

  if (verdict.badRetirements.length) fail(`retired entries need reason, approvedBy and date: ${verdict.badRetirements.join(", ")}`);
  if (verdict.removed.length) {
    fail(`${verdict.removed.length} shipped button(s) are gone from client/src without an approved retirement: ${verdict.removed.join(", ")}`);
    console.log("   Nothing built is removed (CLAUDE.md). Put the button back, or — only with Festus's explicit approval, named as a removal — record it under \"retired\" in scripts/e2e/shipped-buttons.json with reason, approvedBy and date.");
  }
  if (verdict.returned.length) console.log(`✨ back in the source, remove from retired: ${verdict.returned.join(", ")}`);
  if (verdict.unregistered.length) {
    if (update) {
      register.shipped = [...new Set([...(register.shipped ?? []), ...verdict.unregistered])].sort();
      register.note = register.note ?? "Every button testid that has ever shipped in client/src (templated ids end in *). Nothing here is removed from the source without an entry under retired: { reason, approvedBy, date }. Update with: node scripts/e2e/shipped-buttons.mjs --update";
      writeFileSync(REGISTER_PATH, JSON.stringify(register, null, 2) + "\n");
      console.log(`✅ registered ${verdict.unregistered.length} new button(s): ${verdict.unregistered.join(", ")}`);
    } else {
      fail(`${verdict.unregistered.length} button(s) in client/src are not in the shipped register: ${verdict.unregistered.join(", ")} — run: node scripts/e2e/shipped-buttons.mjs --update`);
    }
  }
  const kept = (register.shipped ?? []).filter((id) => present.includes(id)).length;
  console.log(`${failed ? "❌" : "✅"} shipped buttons: ${kept} still in place, ${Object.keys(register.retired ?? {}).length} retired with approval, ${present.length} in source`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
