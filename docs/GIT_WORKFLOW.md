# Git workflow — trunk-based, `main` is live

**Non-negotiable for all AI agents working on PG Ride.**

## The model

| Branch | Role |
|--------|------|
| **`main`** | The only long-lived branch. Live production — Railway deploys it on every merge. |
| `cursor/*`, `claude/*` | Short-lived feature/fix branches, always cut from current `main`, merged back to `main` via PR, then deleted. |

There is **no `develop` / staging branch**. One founder, one deploy target:
an integration branch would be a parking lot where agent work sits
"merged" but never actually ships — while the agent believes it did.

## Rules for AI agents

1. **Audit and review on `main`.**
   `git fetch origin main && git checkout main && git pull` — read code as
   deployed; probe the live URL; run `npm run audit:daily`.
   Daily playbook: [DAILY_AUDIT_PROMPT.md](./DAILY_AUDIT_PROMPT.md).

2. **Branch from current `main`, always.**
   `git checkout -b cursor/<topic>-a737 origin/main`
   **Never base a branch on another unmerged PR's branch.** Stacked bases
   have already lost a full feature in this repo (PR #63: its base branch
   merged to `main` first, the child PR "merged" into a dead branch, and
   the feature silently never shipped until a combined review caught it).

3. **Open PRs as drafts with base `main`.**
   Run the gates first: `npm run check` + `npm test` + `npm run build`
   must all pass on the branch.

4. **Never merge your own PR.**
   The founder reviews and merges. A merge to `main` is a production
   deploy — that judgment stays human.

5. **Keep PRs single-purpose and current.**
   If `main` moves while your PR is open, merge `main` into your branch
   and re-run the gates. Reviewers should never have to untangle a stale
   diff (a 5-commits-behind branch once made a clean PR look like it
   deleted three files of recent work).

## When a real staging environment exists (future)

If/when a second Railway environment is wired to a staging branch with its
own database, this document changes. Until that infrastructure exists,
pretending with a `develop` branch only adds places for work to get lost.
