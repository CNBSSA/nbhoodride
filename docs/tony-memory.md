# Tony's memory

I am **Tony**, the AI engineer working on PG Ride with Festus (he named me on 2026-10-01). CLAUDE.md loads this file into every session, so whatever is written here is what I remember. Read it first; add to it when something is worth keeping; keep it short and current. Remove what stops being true. Never put secrets, tokens or anyone's personal details here.

## How Festus works

- He often answers in one word ("Next", "Please promote", "Ok"). "Next" means: take the next priority yourself. He asked me to set priorities.
- Promotion to `main` needs his explicit approval. The standing rule is the 03:30 ET quiet window; "Please promote" means now.
- He relays production facts I can't see: Railway logs, Telegram pages, the daily reliability digest. Ask him for those, precisely: what to open, and what to send back.
- Fleet money stays off in production (`FLEET_ENABLED`) until his accountant settles the 1099 question.

## What I can and can't reach from a session

- I can't reach production or Railway: the proxy blocks it. I can't start the Production Watch workflow (403). Scheduled watch runs arrive only every few hours, not every 10 minutes.
- So after a promotion, **it is not shipped until a watch run, or Festus, confirms the new build answers.** Say "merged, not yet confirmed".
- Local Postgres in the sandbox stops on its own. Restart it with:
  `runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_ctl -D /var/local/pgtest/data -l /var/local/pgtest/pg.log -w start`
- Chromium for the button audit: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
- Journeys run against `dist/`: always `npm run build` first, and use a fresh database each time the schema changed.
- Rewriting branch history (reset plus force-push) is refused here. Add commits instead; squash-merge cleans it up.
- `tsc` rejects `for..of` over a Set or Map iterator: use `Array.from`.

## Lessons

- **2026-09-29, flaky heartbeat check.** A journey that drives a timer the server also runs by itself must tolerate the server's own tick. Journey 43 was fixed that way.
- **2026-09-30, outage after promotion #445.** The new build started at 03:09 UTC, answered requests, then went silent. It stopped answering until the 07:46 rollback, and the rollback (#446) restored riders. Two local soaks did not reproduce it: 25 minutes idle, and 25 minutes with about 1,000 socket connections opening and dropping. The cause is still open. The deciding evidence is whether `reliability_events` rows kept appearing between 03:09 and 07:46 (I asked Festus to run that query). Until then the batch stays off `main`.
- **After a revert on `main`:** `develop` reads as "behind" and never "ahead", so a normal promotion can't re-ship the batch. **Never merge `main` into `develop`**: it pulls the revert in and silently deletes the batch. Re-ship it with a revert of the revert, once the cause is fixed.
- **The quiet-hour routine can't re-ship a reverted batch**, so don't pause it for that reason (I did, wrongly, and re-enabled it).
- **Merging many PRs that each append to CLAUDE.md:** merge one, then merge `develop` into the rest. Keep both sides of the append, `develop`'s first, and watch for duplicated paragraphs.

## Open items

- The 2026-09-30 outage: the cause is unknown, and the batch (#436–#444) waits on it.
- Festus has not answered whether to revive or remove the crashed prisma-baseline helper.
- Still Festus's to do before texting riders: point Twilio's inbound webhook at the signed route, and A2P 10DLC registration.
