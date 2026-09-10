/**
 * Runs every *.journey.mjs against one freshly booted production bundle.
 * Exit code is non-zero if any check in any journey fails.
 */
import { readdirSync } from "node:fs";
import { connectDb, seedFixtures, startServer, stopServer, summary } from "./harness.mjs";

const dir = new URL("./", import.meta.url);
// One or more comma-separated substrings: `run.mjs 13` for a single journey,
// `run.mjs 01-,02-` for a chosen set.
const only = (process.argv[2] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const files = readdirSync(dir).filter((f) => f.endsWith(".journey.mjs") && (only.length === 0 || only.some((o) => f.includes(o)))).sort();

const db = await connectDb();
await seedFixtures(db);
const server = await startServer();
console.log(`server ${server.base} (log: ${server.logPath})`);
try {
  for (const f of files) {
    console.log(`\n=== ${f} ===`);
    const mod = await import(new URL(f, dir));
    await mod.run({ base: server.base, db, server });
  }
} finally {
  stopServer(server);
  await db.end();
}
process.exit(summary() === 0 ? 0 : 1);
