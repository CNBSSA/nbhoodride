# Git workflow — integrate on `develop`, promote to `main`

**Non-negotiable for all AI agents working on PG Ride.**

## The model

| Branch | Role |
|--------|------|
| **`develop`** | Integration branch. All feature/fix PRs **target `develop`**. Test here first. |
| **`main`** | Production. Railway deploys on merge to `main`. **Only promote from `develop` after testing and founder sign-off.** |
| `cursor/*`, `claude/*` | Short-lived branches. Cut from current **`develop`**, merged via PR into **`develop`**, then deleted. |

## Rules for AI agents

1. **Default PR base is `develop`, not `main`.**
   Cloud agents and humans open draft PRs with `base_branch: develop` unless the founder explicitly says otherwise.

2. **Branch from current `develop`.**
   ```bash
   git fetch origin develop && git checkout -b cursor/<topic>-a737 origin/develop
   ```

3. **Before opening a PR:** `npm run check`, `npm test`, and `npm run build` on the branch.

4. **Do not merge to `main` without founder approval.**
   Promotion is `develop` → `main` (PR or merge) only after testing on `develop` and explicit satisfaction.

5. **Keep PRs current with `develop`.**
   If `develop` moves while your PR is open, merge `origin/develop` into your branch and re-run the gates.

6. **Audits on `develop` for in-flight work; validate `main` matches what is deployed** when checking production.

Daily reliability agent: [DAILY_AUDIT_AGENT_INVOKE.md](./DAILY_AUDIT_AGENT_INVOKE.md) — **audit `develop`**, report **develop ↔ main parity**, recommend promote when aligned and tested.

## Promote `develop` → `main` (founder / release)

When integration testing on `develop` is complete:

```bash
git fetch origin develop main
# Open a PR: base main, head develop (or merge locally after review)
```

Use a clear title, e.g. **Promote develop to main — &lt;date or theme&gt;**, and note what was tested.

## Historical note

Some older agent PRs (e.g. #95–#101) merged directly to `main` while `docs/GIT_WORKFLOW.md` briefly described trunk-only `main`. **`develop` must be fast-forwarded or merged from `main` when it falls behind** so integration branch matches reality before new work lands.
