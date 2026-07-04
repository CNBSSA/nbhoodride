#!/usr/bin/env node
/**
 * Ensures manifest-referenced PWA icons and screenshots exist before release.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "client", "public");
const manifest = JSON.parse(readFileSync(join(publicDir, "manifest.json"), "utf8"));

const missing = [];

for (const icon of manifest.icons ?? []) {
  const path = join(publicDir, icon.src.replace(/^\//, ""));
  try {
    readFileSync(path);
  } catch {
    missing.push(icon.src);
  }
}

for (const shot of manifest.screenshots ?? []) {
  const path = join(publicDir, shot.src.replace(/^\//, ""));
  try {
    readFileSync(path);
  } catch {
    missing.push(shot.src);
  }
}

const storeIcon = join(root, "store-listing", "icon-1024-store.png");
try {
  readFileSync(storeIcon);
} catch {
  missing.push("store-listing/icon-1024-store.png");
}

if (missing.length) {
  console.error("Missing PWA / store assets:\n" + missing.map((m) => `  - ${m}`).join("\n"));
  console.error("\nRun: python3 scripts/generate-app-icons.py");
  process.exit(1);
}

console.log("PWA asset check OK");
