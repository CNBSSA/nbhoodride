# Daily audit reports (optional paper trail)

Agents normally post the markdown report to your ops channel. To keep history in-repo, save one file per run:

```text
docs/audits/YYYY-MM-DD.md
```

Use the **Required report format** in [DAILY_AUDIT_PROMPT.md](../DAILY_AUDIT_PROMPT.md), including:

- develop ↔ main parity and promote readiness
- **Phase 3b E / F** (solo schedule + coworker `PG-XXXXXX`) — PASS / FAIL / CODE-ONLY

Do not commit secrets, PII, or production credentials in audit files.
