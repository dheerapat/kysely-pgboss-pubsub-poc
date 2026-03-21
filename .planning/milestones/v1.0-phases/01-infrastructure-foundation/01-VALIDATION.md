---
phase: 1
slug: infrastructure-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-20
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (built-in, no install needed) |
| **Config file** | none — Bun auto-discovers `*.test.ts` |
| **Quick run command** | `bun tsc --noEmit` |
| **Full suite command** | `bun test 2>&1` |
| **Estimated runtime** | ~3 seconds (type check); ~10s (with integration) |

---

## Sampling Rate

- **After every task commit:** Run `bun tsc --noEmit`
- **After every plan wave:** Run `bun test 2>&1`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | INFRA-01, INFRA-02 | type+unit | `bun tsc --noEmit` | ❌ W0 | ⬜ pending |
| 1-02-01 | 02 | 1 | INFRA-04, INFRA-05 | type | `bun tsc --noEmit` | ❌ W0 | ⬜ pending |
| 1-03-01 | 03 | 2 | INFRA-03, INFRA-06 | type+integration | `bun tsc --noEmit` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/` directory structure created
- [ ] `src/domains/shared/` and `src/infrastructure/db/` and `src/infrastructure/events/` directories exist

*Existing `bun tsc --noEmit` infrastructure covers type validation. No test framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PgBoss starts without error | INFRA-03 | Requires live PostgreSQL | `docker compose up -d && bun run src/index.ts` — observe "pg-boss started" log |
| `isInstalled()` returns true | INFRA-03 | Requires live PostgreSQL | Same as above, check console output |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
