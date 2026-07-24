# CLAUDE.md — context for AI agents (PGRide / nbhoodride)

If you are an AI agent reading this repo for the first time, start here.

## CNBSSA agent system (corp)

- **Corp agent system (context layers, memory, learning):** `autonomusFV/agents/CNBSSA_AGENT_SYSTEM.md` (workspace clone path); org conventions: `autonomusFV/org-conventions/`.

Corporation-wide workflow and audits: `autonomusFV/CLAUDE.md`. Product positioning: `autonomusFV/agents/product_knowledge.md` → **PGRide**.

## What this product is

**PGRide** — ride-sharing for Prince George's County, MD (USA): riders, driver-partners, Stripe/cash fares, wallet ledger, driver equity program, super-admin ops. Stack: Node.js/TypeScript, React, PostgreSQL, Railway (`nbhoodride-production.up.railway.app`).

## Workflow

Develop on `develop`; promote to `main` only with Festus's explicit approval after testing. Planning → change-impact audit → implement → test → post-implementation audit.
