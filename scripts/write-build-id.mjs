// Writes build-id.json so the client bundle and the server agree on WHICH
// build they are. Railway exposes the commit; locally fall back to git, then
// to a timestamp. The client bakes the id in at build time (vite define) and
// the server serves it from /api/version, so a phone running an old bundle
// can notice a newer deploy and refresh itself.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
let id = (process.env.RAILWAY_GIT_COMMIT_SHA || "").slice(0, 12);
if (!id) { try { id = execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch {} }
if (!id) id = `t${Date.now()}`;
writeFileSync("build-id.json", JSON.stringify({ id, builtAt: new Date().toISOString() }) + "\n");
console.log(`[build] id ${id}`);
