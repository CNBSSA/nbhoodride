/**
 * Which build this server is running.
 *
 * Written by scripts/write-build-id.mjs at build time and read here once, so
 * the server, the client bundle and /api/version all agree on WHICH build is
 * live. Crash reports carry the client's id and are compared against this.
 */
import { readFileSync } from "fs";

export interface BuildInfo { id: string; builtAt: string }

let info: BuildInfo = { id: "dev", builtAt: "" };
try {
  info = JSON.parse(readFileSync("build-id.json", "utf8"));
} catch { /* dev, or the file is not deployed alongside the bundle */ }

export const buildInfo: BuildInfo = info;
export const BUILD_ID = info.id;
