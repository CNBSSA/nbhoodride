#!/usr/bin/env bash
# Local/cloud-agent helper: ensure Postgres is reachable, migrate, then start the app.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "[dev-up] Missing .env — copy from .env.example and set DATABASE_URL + SESSION_SECRET"
  exit 1
fi

# shellcheck disable=SC1091
set -a
source .env
set +a

if [[ -z "${DATABASE_URL:-}" || -z "${SESSION_SECRET:-}" ]]; then
  echo "[dev-up] DATABASE_URL and SESSION_SECRET are required"
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "[dev-up] Installing dependencies..."
  npm ci --no-audit --no-fund
fi

echo "[dev-up] Running migrations..."
npm run db:push

echo "[dev-up] Starting development server on port ${PORT:-5000}..."
exec npm run dev
