---
phase: 3
slug: notification-domain-http-api
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-20
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun test (built-in) |
| **Config file** | none — bun test discovers `*.test.ts` automatically |
| **Quick run command** | `bun test src/domains/notification/ 2>&1` |
| **Full suite command** | `bun test 2>&1` |
| **Estimated runtime** | ~3 seconds (unit tests only) |

---

## Sampling Rate

- **After every task commit:** Run `bun test src/domains/notification/ 2>&1`
- **After every plan wave:** Run `bun test 2>&1`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | NOTIF-01, NOTIF-02 | unit | `bun test src/domains/notification/ 2>&1` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 2 | HTTP-01, HTTP-02, HTTP-03, DEMO-01 | integration | `grep -n "listen\|elysia" src/index.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/domains/notification/NotificationService.test.ts` — stubs for NOTIF-01

*Existing bun test infrastructure covers all phase requirements. No additional framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Console shows async sequence | DEMO-01 | Requires running app + live curl | Start server, POST /users, observe log sequence |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
