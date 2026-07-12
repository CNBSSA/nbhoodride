#!/usr/bin/env bash
# Restore node_modules from the vendor/node-modules-cache branch.
# Useful in Cursor Cloud Agents where registry.npmjs.org is egress-blocked.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BRANCH="${VENDOR_BRANCH:-vendor/node-modules-cache}"
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

echo "[restore] Fetching $BRANCH..."
git fetch origin "$BRANCH"

echo "[restore] Extracting vendor chunks..."
git archive "origin/$BRANCH" | tar -x -C "$TMP"
if [[ ! -d "$TMP/vendor" ]]; then
  echo "[restore] No vendor/ directory on $BRANCH" >&2
  exit 1
fi

echo "[restore] Reassembling tarball..."
cat "$TMP"/vendor/node_modules.tar.gz.part* > "$TMP/node_modules.tar.gz"
EXPECTED="$(awk '{print $1}' "$TMP/vendor/node_modules.tar.gz.sha256")"
ACTUAL="$(sha256sum "$TMP/node_modules.tar.gz" | awk '{print $1}')"
if [[ "$EXPECTED" != "$ACTUAL" ]]; then
  echo "[restore] SHA-256 mismatch (expected $EXPECTED, got $ACTUAL)" >&2
  exit 1
fi

echo "[restore] Extracting node_modules..."
rm -rf node_modules
tar -xzf "$TMP/node_modules.tar.gz"
echo "[restore] Done — $(ls node_modules | wc -l) top-level packages."
