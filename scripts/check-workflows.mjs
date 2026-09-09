#!/usr/bin/env node
/**
 * Workflow files must parse. A GitHub Actions workflow with a YAML error
 * does not fail loudly: every run of it dies at parse time with no jobs,
 * and the failure shows only in the Actions tab. The production watch
 * shipped that way once (a multi-line shell string that broke the `run: |`
 * block), so `npm run check` now parses every workflow before tsc runs.
 *
 * Uses python3 + PyYAML, present on every ubuntu-latest runner and most
 * developer machines; skips with a warning where they are missing.
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const dir = new URL("../.github/workflows/", import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).map((f) => join(dir, f));
const py = spawnSync("python3", ["-c", `
import sys, yaml
bad = 0
for f in sys.argv[1:]:
    try:
        d = yaml.safe_load(open(f))
        on = d.get("on", d.get(True))
        if not isinstance(d, dict) or on is None or "jobs" not in d:
            print(f"[workflows] {f}: no 'on' or 'jobs' at top level"); bad += 1
    except Exception as e:
        print(f"[workflows] {f}: {e}"); bad += 1
print(f"[workflows] {len(sys.argv) - 1} checked, {bad} broken")
sys.exit(1 if bad else 0)
`, ...files], { encoding: "utf8" });
if (py.error || (py.status !== 0 && /No module named|not found/.test(`${py.stderr}`))) {
  console.warn("[workflows] python3 with PyYAML not available; workflow parse check skipped");
  process.exit(0);
}
process.stdout.write(py.stdout);
process.stderr.write(py.stderr);
process.exit(py.status ?? 1);
