# Project Review & Gap Analysis

**How did we get here, and what remains?**

| Question                            | Document                           |
| ----------------------------------- | ---------------------------------- |
| What is the system?                 | [README](../README.md)             |
| How does it work?                   | [ARCHITECTURE.md](ARCHITECTURE.md) |
| How do we run and recover it?       | [OPERATIONS.md](OPERATIONS.md)     |
| How did we get here / what remains? | this document                      |

This document tracks external reviews of the repository, verifies each claim
against the code (not against the READMEs), and maintains the remediation
ledger for **what is still open**. Closed findings and superseded review
cycles live in the archived copies
[`docs/archived/PROJECT_REVIEW_GAP_ANALYSIS_2026-09-20_cycle.md`](archived/PROJECT_REVIEW_GAP_ANALYSIS_2026-09-20_cycle.md)
(N-series, L1–L30, M1) and
[`docs/archived/PROJECT_REVIEW_GAP_ANALYSIS_2026-10-07_cycle.md`](archived/PROJECT_REVIEW_GAP_ANALYSIS_2026-10-07_cycle.md)
(the 2026-10-01 / 10-04 / 10-05 review sections, §2 verification matrices,
resolved G1/N3/N4/N5/N7/R2/R3 narratives and the completed ledger rows).
Historical review material stays untracked under `docs/archived/`.

**Current focus: prove the whole system under hostile timing and failure.**
The architecture phase is effectively over — control plane, exchange
reconciliation, durable snapshots, durable ledger, per-fill partial
accounting, hard restart/redelivery, P0 crash-recovery (Gate 5) and the
frontend execution-integrity audit (9 integration tests, proven 2026-10-07)
have all landed and been proven live or deterministically (§1/§2). What
remains is **P1: finish Phase 6 failure injection + the live Redis-restart /
orphan / snapshot-corruption / startup-reconciliation gates, and the rare
end-to-end `snapFullyLong` trigger**; **P2: a handful of browser-level smoke
tests around `App` wiring, agent participation**; **deferred: `shared` split, general
frontend refactoring (incl. provider topology)**. See §4/§6.

---

## 1. Latest review — 2026-10-07 (execution integrity & crash-recovery)

Full text: [`docs/archived/reviews/2026-10-07_external_review_raw.md`](archived/reviews/2026-10-07_external_review_raw.md).
Verified claim-by-claim in **§2** below (rows 36–47).

**What the reviewer confirms (and we re-verified):** the 9-test frontend
execution-integrity matrix closed the previously open integration-behavior
concerns (§2c in the [archived cycle](archived/PROJECT_REVIEW_GAP_ANALYSIS_2026-10-07_cycle.md));
the P0 crash path is now productised end-to-end (`UNKNOWN` →
`needs_user_action` → Resume Bot → `POST /resume` → same botId →
`RUNNING/RUNNING`, proven live by Gate 5) with the
`desired_state='RUNNING'` + `UNKNOWN/ERROR` creation guard plus a DB-level
partial unique index backstop; the account-scoped position read (R2) and the
CI/process gap (R3) are closed; and the `strategy_id` collision test proves
the shim is **residue, not a defect**.

**The reviewer's open list** (adopted as §4/§6 scope):

| Priority | Item                                                                      |
| -------- | ------------------------------------------------------------------------- |
| 🟠 P1    | Finish Phase 6 failure-injection coverage                                 |
| 🟠 P1    | Live gates: Redis restart, exchange orphan, crash at more exact points, corrupted/missing snapshot, exchange unavailable during startup reconciliation |
| 🟠 P1    | Verify the remaining rare end-to-end `snapFullyLong` condition            |
| 🟡 P2    | 2–4 browser-level smoke tests around `App` wiring (login → start → RUNNING; crash → resume; refresh during transition; access-level drop) |
| 🟡 P2    | Remove the `strategy_id` compatibility shim once no caller passes strategy ids |
| 🟡 P2    | Finish bot-account-session migration/shim cleanup                         |
| 🟡 P2    | Clean the remaining `kodiak_status` residue                               |
| ⏸ Defer  | Split `@trade-bot/shared`; general frontend provider-topology refactoring |

The reviewer's area scores (overall **~8.7–9/10**) are recorded in the raw
text; the standing note is that **frontend is no longer a weak spot in known
correctness defects** — it was weak because it had not been adversarially
tested, and now it has been.

---
## 2. Verification of the 2026-10-07 review against the code

Every claim re-checked at `daf661f` (2026-10-07). Rows 1–35 (the 2026-10-01 /
10-04 / 10-05 verifications) moved to the
[archived cycle document](archived/PROJECT_REVIEW_GAP_ANALYSIS_2026-10-07_cycle.md)
with the material they verified.

| #   | Review claim                                                                                                            | Verdict                   | Evidence                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 36  | 9 focused integration tests cover the 10 audit targets; suite at 30 files / 223 tests, all green                        | ✅ Confirmed              | `frontend/src/test/integration/` = exactly 9 files (reconnect, logout, ordering, shared-cache, strategy-id, downgrade, delete-transition, session-expiry, refresh-remount); README records 223/30 (2026-10-07 run) |
| 37  | Tests use real lifecycle hooks + real `WebSocketClient` singleton + fake socket + mocked REST, without rendering `App`   | ✅ Confirmed              | Integration files import `useBotLifecycle`/`useBotState`/`useAuth` and the singleton client directly; no `render(<App>)` anywhere in the suite                                 |
| 38  | WS reconnect test proves convergence (refetch heals, invalidation keeps RUNNING), not just "socket reconnects"          | ✅ Confirmed              | `ws-reconnect.test.tsx`; scenario record in the archived §2c matrix                                                                                                            |
| 39  | REST wins over stale WS while a fresher WS event still applies; unknown bot ids never leak into tracked rows            | ✅ Confirmed              | `ws-ordering.test.tsx` (archived §2c scenario 3)                                                                                                                               |
| 40  | Shared Query cache: one network fetch, all observers updated, one `bot.stateChanged` propagates                         | ✅ Confirmed              | `ws-shared-cache.test.tsx` (archived §2c scenario 4)                                                                                                                           |
| 41  | `VERIFIED → REGISTERED` downgrade runs both cleanup paths, socket → `null`, no reconnect loop                            | ✅ Confirmed              | `ws-downgrade.test.tsx` (archived §2c scenario 6)                                                                                                                              |
| 42  | P0 crash path productised: `UNKNOWN` → `needs_user_action` → `POST /resume` → same botId → `RUNNING`; Gate 5 proved it live | ✅ Confirmed              | `backend/src/interfaces/http/bots/management.ts` (resume route); `OPERATIONS.md` §5 runbook table; gate-5 record in §5 history (report `.git/gatelogs/live/gate5-resume-report.md`) |
| 43  | Creation guard covers `desired_state='RUNNING'` + `UNKNOWN/ERROR`, with a DB partial unique index backstop               | ✅ Confirmed              | `lifecycle-reconciliation.service.ts:11` (desired=RUNNING + ERROR/UNKNOWN → audit marker, no auto-start); migration `018_bot_one_live_per_strategy.sql`                        |
| 44  | `getPosition(exchangeAccountId, symbol)` + `UNIQUE(exchange_account_id, symbol)`; old `ORDER BY updated_at DESC` heuristic gone | ✅ Confirmed (closed 2026-10-05, re-verified) | R2 record (archived cycle); `IPositionRepository` in `shared/src/types/repositories.ts`; regression test pins `not.toContain("ORDER BY ep.updated_at DESC")`           |
| 45  | CI: format → lint → build → `CI=true npm test` on push/PR with Postgres 14 + Redis; `main` has required PR/review        | ✅ Confirmed (closed 2026-10-05, re-verified) | `.github/workflows/ci.yml` (four gates, service containers); R3 record (archived cycle)                                                                                   |
| 46  | Phase 6: shared scripted fake + 12-case matrix exist, but the *program* is not closed — deterministic injection ≠ real process/Redis/venue failure | ✅ Confirmed              | `engine/src/application/__tests__/helpers/fake-exchange.ts` + `failure-injection-matrix.test.ts` exist; §4 Phase 6 row below is the open program                                |
| 47  | `strategy_id` collision is tested and therefore residue, not a bug; `kodiak_status` dropped from the live view by `021` (history in `002`/`012`) | ✅ Confirmed              | `ws-strategy-id.test.tsx` proves session-resolve + bot-id WS patch; R1 closed in §3 (2026-10-08); `021_drop_kodiak_status.sql` (§4 row)                |

**Notes on staleness (as always):** the review's suite numbers
(backend 2,554 / frontend 211 / engine 297) were the *CI-validation* point of
2026-10-05; current recorded totals are backend **2,559**, frontend **223**,
engine **310** (README). The area-score table is opinion, kept in the raw
text only.

---

## 3. Findings (open only)

Closed findings — the N-series resolution notes, G1/N3/N4/N5/N7, R2, R3, and
every `#### L…` narrative (L1–L30) plus the M1 emergency-stop record — live in
the [2026-09-20 cycle](archived/PROJECT_REVIEW_GAP_ANALYSIS_2026-09-20_cycle.md)
and [2026-10-07 cycle](archived/PROJECT_REVIEW_GAP_ANALYSIS_2026-10-07_cycle.md)
archives. Only findings with an open remainder are listed here.

### N6 — 🟠 P1 (residual): `snapFullyLong` end-to-end trigger unproven

The accounting finding itself is **settled**: executed-price exit pricing,
fee-inclusive realised PnL (`8495254`, 2026-10-02), `reduce_only` exits and
venue position reconciliation (2026-10-02), per-fill `PARTIALLY_FILLED`
accounting (2026-10-04), fee sourcing from the venue-reported tier
(`ExchangeClient.getFeeRates?()`), live Gate 3 (round trip exact) and Gate 4
runs 2 + 3 (delta-only booking, restart/redelivery) all **PASS**, C2
below-minimum detector confirmed live (`21706`, `min_base_amount` 0.005).
Full narrative in the archived cycle documents.

**What remains:** the **end-to-end `snapFullyLong` firing live** — it needs
`depth < orderQuantity < depth + 0.005`, a sub-0.005 window a grid level
rarely lands in (0.01 and 0.008 lots both filled whole). Carried in §4 row 5.

### R1 — 🟡 P2: frontend bot/strategy identity residue

The bot-ID mapping is fixed (`id: bot.id`), and the targeted test proves the
important case: a legacy strategy id resolves to its hosting session via
`runs[]`, and a WS event carrying the bot id patches the right row
(`frontend/src/test/integration/ws-strategy-id.test.tsx`, archived §2c
scenario 5). Not a bug today — the 2026-10-07 review re-confirms this as
**residue, not a defect**. ✅ closed 2026-10-08: the `strategy_id === id`
comparison is gone everywhere; the strategy-keyed lookup
(`getSessionForStrategy` in `useBotLifecycle.ts`) is runs-only
(`runs[].strategy_id`), the deprecated optional `strategy_id?` fields are
type-level tombstones (@deprecated, never read), and the API boundary
sends only the session id.

---

## 4. Remediation ledger (open items only)

Sequencing rationale and all **closed** rows (phases 0–5, the account-scoped
API row, row D's landing, the frontend execution-integrity audit, ledger
L1–L30, M1) are in the archived cycle documents. What remains:

| Phase | Priority | Item | Status |
| ----- | -------- | ---- | ------ |
| 6     | 🟠 P1    | **Failure-injection harness** (reviewer's PR 4). The deterministic half: a shared scripted fake exchange with a service-level fault matrix (accept-then-drop, timeout, unreachable, progressive partials + redelivery, partial + restart, cancel/fill race, lost cancel, stale historical id, unreachable startup, startup fill segment). The **live half** (the 2026-10-07 review's emphasis — deterministic injection ≠ real process/Redis/venue failure): **1)** Redis restart under load, **2)** exchange-side orphan orders, **3)** engine crash at additional exact points (beyond Gate 2/5's SIGKILL), **4)** restart with corrupted/missing snapshot, **5)** exchange unavailable during startup reconciliation. Plan: `docs/instructions/phase6-failure-injection-plan.md`. | ✅ **Live half COMPLETE 2026-10-08** — all five gates PASS on Lighter testnet: **A** Redis restart (`ga-report.md`, streams 77=77 / 31777→31790 heartbeats, reconnect DB 1); **B** orphan (`gb-report.md`, reconcile reports, no double-placement); **C** crash-at-point c1/c2/c3 (`gc1/2/3-report.md` + genuine-C2 rerun `g6c2-rerun-report.md`: 6 rows / 6 unique `fill_id`s, `g6c2b-fill.log` + `g6c2b-ledger.txt`); **D** corrupt+missing snapshot (`gd-report.md`, recovery path); **E** unreachable-at-startup rerun (`g6e-rerun-report.md`: exact `Lighter sidecar unreachable` + `Failed to process command` 12:28:42Z, `g6e-unreachable.log`; first `ge` attempt superseded). Follow-ups closed: heartbeat-converge after stack kill (`g6hb-heartbeat-report.md`, residual in `ga-report.md` closed), filename off-by-one headers on `gc1/2/3`. Residuals: `snapFullyLong` watcher armed (10 h, re-armed 12:0x after stack restart); `/tmp` per-run evidence migrated into `phase6/`. |
| 5 remainder | 🟠 P1 | **End-to-end `snapFullyLong` trigger** (N6's last unproven condition): needs `depth < orderQuantity < depth + 0.005` live. Everything else in Phase 5 is done and proven (Gate 3, Gate 4 runs 2–3, C2 detector). | ⬜ open — rare window; needs a live run where a grid level lands in the sub-0.005 remainder gap |
| 6b    | 🟡 P2    | **Browser-level smoke tests around `App` wiring** (2026-10-07 review). The hook-level suite deliberately never renders `App` (provider topology, `ProtectedRoute`, `FullProviders`, `ConditionalWebSocketInitializer`, `AnimatedRoutes`); 2–4 browser E2E tests would prove the wiring connects the proven mechanisms: **(1)** login → dashboard → socket connect → start bot → RUNNING; **(2)** RUNNING → engine gone → UNKNOWN → "Action required" → Resume → RUNNING; **(3)** STARTING → refresh → converges; **(4)** access-level drop → socket disconnect → protected-route behavior. | ⬜ open (new 2026-10-07) |
| –     | 🟡 P2    | **Frontend identity residue (R1).** Remove the `bot.id === id \|\| strategy_id === id` compatibility fallback once no caller passes a strategy id (§3 R1; `ws-strategy-id.test.tsx` pins the behavior meanwhile). | ✅ done 2026-10-08 — no `strategy_id === id` comparison remains; the strategy-keyed lookup is runs-only (`getSessionForStrategy` resolves via `runs[].strategy_id`), `ws-strategy-id.test.tsx` updated to the runs-only contract |
| D remainder | 🟡 P2 | **Bot-account-session migration/shim cleanup.** D1–D4 landed (`6ce8c02`..`6b91a63`, accepted 2026-10-06); the `strategy_id` shim-drop migration documented in the `019_bot_account_sessions.sql` header remains, plus any leftover pre-D row cleanup. | ✅ done 2026-10-08 (`022_drop_bot_strategy_id_shim.sql` applied — its pre-D guard counted 0 offending rows, then dropped the column + `002` indexes; `BotRow`/fixtures cleaned) |
| –     | 🟡 P2    | **`kodiak_status` residue.** Drop the unconsumed `kodiak_status` column from the `user_trading_summary` view (migrations `002`/`012` still emit it; no code consumer). | ✅ done 2026-10-08 (`021_drop_kodiak_status.sql` redefines the view without the column; `002`/`012` kept as history) |
| –     | 🟡 P2    | **Transient signer `21104`.** A nonce-drift refusal from the Lighter sidecar was treated as fatal instead of retryable (observed live 2026-10-01). | ✅ done 2026-10-08 — the narrow `isNonceDrift()` classifier (`exchanges/lighter/refusals.ts`, code `21104` + `invalid nonce` wording) maps a nonce-drift refusal to `CommandError(retryable: true)` on **create and cancel**: never fatal, never UNREACHABLE (the reconciler must not freeze on a reached sidecar), never a size refusal (`21706` stays with `isSizeRefusal`); the slot re-arms on the next tick and a refused command stays pending for redelivery; negatives (`21706`/`21733`/unreachable/margin) pinned; engine 316/316, `tsc` + eslint clean |
| E     | 🟡 P2    | **Agent participation.** Read-only API keys per exchange account, grants scoped to one account, proposals inert until approved, engine as the only executor. Described in the exchange plan §E. | ⬜ open |
| –     | 🟡 P2 (defer) | **Split `shared` package.** `@trade-bot/shared` is a god package (protocol types, domain models, API contracts, error classes, logging types). Split by domain once the trading-path work is fully closed. | ⬜ deliberately deferred |
| F     | ⏸ Defer  | **Provider topology** (frontend). `App.tsx` still branches on `isAuthenticated` with separate `MinimalProviders`/`FullProviders` trees. Audit target, not a defect: the lifecycle cleanup is tested. Target shape (later): `Router → ThemeProvider → QueryClientProvider → auth state → WS lifecycle → Routes`. | ⬜ deferred |

---

## 5. History — recent passes (full table in the archived cycle)

| Pass                                         | Repository state                                    |
| -------------------------------------------- | --------------------------------------------------- |
| 2026-10-05 (live Gate 5 — P0 resume)         | Lighter testnet @ `83d4f87` — `.git/gatelogs/live/gate5-resume-report.md` |
| 2026-10-05 (live Gate-4 §9 run 3)            | Lighter testnet @ `f2e08ef` — `.git/gatelogs/live/gate4-run3-report.md` |
| 2026-10-05 (external review, two passes)     | `main` @ 369 commits — pass 1 contaminated/withdrawn, pass 2 correction adopted |
| 2026-10-06 (live-testing pass + D1–D4 acceptance) | `main` @ `f0c3728`..`d10d91d` — ghost session closed, Lighter level-stall closed, engine de-brand, sessions accepted, suites green (2,559 / 212 / 310) |
| 2026-10-07 (frontend execution-integrity proven) | `main` @ `daf661f` — 9 integration tests, 30 files / 223 tests green |
| 2026-10-07 (external review + doc rotation)  | `main` @ `daf661f` — this rotation: review verified (§2 rows 36–47), closed cycles moved to `docs/archived/` |
| 2026-10-08 (Phase 6 live half complete)      | Lighter testnet @ `dce2f5e` — Gates A/B/C/D/E all PASS (`phase6/ga,gb,gc1-3,gd,ge` + reruns `g6c2-rerun,g6e-rerun`, heartbeat `g6hb-heartbeat-report.md`) |

Earlier passes (2026-09-20 … 2026-10-04 reviews, live Gates 0–4, phases 0–5)
are in `docs/archived/PROJECT_REVIEW_GAP_ANALYSIS_2026-09-20_cycle.md` and
`docs/archived/PROJECT_REVIEW_GAP_ANALYSIS_2026-10-07_cycle.md`; the oldest
rounds (2026-01 … 2026-09-14 ratings) in `docs/archived/PROJECT_REVIEW.md`.

---

## 6. Still open

| Priority | Item | Where |
| -------- | ---- | ----- |
| 🟠 P1    | **`snapFullyLong` end-to-end trigger** — the only unproven part of an otherwise fully landed and live-proven accounting stack. | §3 N6, §4 |
| 🟡 P2    | **2–4 browser smoke tests around `App` wiring** (new 2026-10-07 — the one layer the hook-level suite deliberately skips). | §4 |
| 🟡 P2    | **Agent participation** (plan §E). | §4 |
| ⏸ Defer  | **`shared` split; provider topology / general frontend refactoring.** | §4 |

> **Closed since the last rotation** (details in the archived cycle): P0
> crash-recovery (Gate 5), R2 account-scoped position read, R3 CI gate +
> protected `main`, the frontend execution-integrity audit (9 tests), the
> 2026-10-01/04/05 review cycles and all their verified claims.
> **Phase 6 live half closed 2026-10-08** (§4 row 6 — all five gates PASS;
> reports in `.git/gatelogs/live/phase6/`).

### Security advisories

| Advisory | Severity | Status | Notes |
| -------- | -------- | ------ | ----- |
| [`GHSA-4p3w-j4w9-5jqw`](https://github.com/advisories/GHSA-4p3w-j4w9-5jqw) — *moment path traversal via crafted non-string locale name* ([Dependabot #97](https://github.com/infinitEnigma/trade-bot/security/dependabot/97)) | Moderate | ✅ **Closed 2026-10-05** | Transitive via `backend → winston-daily-rotate-file → file-stream-rotator → moment`. `file-stream-rotator@0.6.1` declares `moment: ^2.29.1`, so a plain `npm audit fix` moved it to the patched **2.31.0** — no `overrides` needed, lockfile-only diff (3 lines). `npm audit` moderate count is now **0**. |
| [`GHSA-vfj7-8cjw-p6xm`](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) — *braces stack exhaustion via deeply nested patterns* (CVE-2026-93687) | High | ⚠️ **Open — no upstream fix exists** | The advisory reports **"Patched versions: None"** (`<=3.0.3` affected, and `3.0.3` is the newest release). Reachable only through `ts-node-dev → chokidar → braces` — the `npm run dev` hot-reload tool. `npm ls braces --omit=dev` is empty, so it is **absent from the production tree** and `npm audit --omit=dev` reports **0**. Two attempts to override `chokidar ^4` (which drops `braces` entirely) were abandoned: npm 12 silently refused to apply them, and forcing an out-of-range transitive dep onto the unmaintained `ts-node-dev@2.0.0` would risk the dev workflow for zero production gain. Revisit when `ts-node-dev` is replaced or `braces` ships a patch. |

### How to keep this document honest

1. Update §4 (ledger status) in the same commit as the code change it records —
   stale docs are treated as bugs (`CONTRIBUTING.md`).
2. Add the verification row to §2 when a review claim is re-checked, and record
   the result even when it contradicts the review.
3. When a finding closes, move its narrative to the newest archived cycle
   document instead of deleting it, and leave only a one-line pointer here. The
   archives now are
   [`…_2026-09-20_cycle.md`](archived/PROJECT_REVIEW_GAP_ANALYSIS_2026-09-20_cycle.md)
   and
   [`…_2026-10-07_cycle.md`](archived/PROJECT_REVIEW_GAP_ANALYSIS_2026-10-07_cycle.md).
4. Keep the README free of review history: it answers "what is the system
   today", this document answers "how did we get here / what remains".
5. When this document grows past ~300 lines of mostly-closed material again,
   rotate: copy it to `docs/archived/…_cycle.md` and rebuild from the open
   items (this is the 2026-10-07 rotation; the previous one produced the
   2026-09-20 cycle).

