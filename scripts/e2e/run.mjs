/**
 * Runs every *.journey.mjs against one freshly booted production bundle.
 * Exit code is non-zero if any check in any journey fails.
 */
import { readdirSync } from "node:fs";
import { connectDb, seedFixtures, startServer, stopServer, summary } from "./harness.mjs";

const dir = new URL("./", import.meta.url);
const only = process.argv[2];
const files = readdirSync(dir).filter((f) => f.endsWith(".journey.mjs") && (!only || f.includes(only))).sort();

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
