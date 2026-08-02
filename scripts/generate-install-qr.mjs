#!/usr/bin/env node
/**
 * Generate printable QR for PG Ride install gate.
 * Usage: node scripts/generate-install-qr.mjs
 * Output: docs/qr/pg-ride-install-qr.png
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const url = process.env.PG_RIDE_QR_URL || "https://peoplegoverned.com/?qr=1";
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "qr", "pg-ride-install-qr.png");

mkdirSync(dirname(out), { recursive: true });

const { default: QRCode } = await import("qrcode");
await QRCode.toFile(out, url, { width: 512, margin: 2, errorCorrectionLevel: "M" });
console.log(`Written ${out} → ${url}`);
