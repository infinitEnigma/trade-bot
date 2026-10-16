# UI/UX plan — findings & dispositions

**Status: tracked** (promoted from `docs/instructions/research-ui-ux-review.md`,
Phase 0 of `docs/instructions/ui-ux-implementation-plan.md`). Date: 2026-10-08.

This is the **no-code design audit** (plan §2, tasks 0.1–0.3): every route
walked against the D1–D4 / resume / multi-account / PnL-split reality; every
finding verified against source with file:line evidence. Decisions **D1–D6**
live in the implementation plan §1 (mental model, `?exchangeAccountId=` URL
scope, balance objects, fake-engine E2E harness, deferred provider topology,
E2E outside required gates).

**Severity:** 🔴 tells a financial/product **lie** (user believes something
false) · 🟠 real gap/dead-end · 🟡 polish/inconsistency · ⚪ honest note · ✅
already correct.

**Status column:** all findings start ⬜ open; a finding closes only when its
mapped plan phase lands (Phase column).

**Phase 0.5 update (2026-10-08):** the pre-smoke "Honesty Pass"
(`docs/instructions/ui-ux-pre-smoke-plan.md`) closed 22 findings early —
**B4, D2, E2, E3, E4, E5, E6, E7, E10, F1, F2, F3, F5, F7, F8, H1, H2** plus
partials **B5** (Dashboard CTA — balance-card semantics stay Phase 4) and
**E1** (the `requireVerified` gate is now live via HD1 — the silent-redirect
reason param stays Phase 6). These are marked ✅ with their closure task below.
Non-goals of that pass (balance semantics B1/B2/B3/B6, account scoping A1–A5,
redirect reason params, layout conventions H3, C1/C2 lifecycle presentation)
remain open for their phases.

---

## A. Account scoping → Phase 2

| ID | Sev | Finding | Evidence |
| -- | --- | ------- | -------- |
| A1 | ✅ | Dashboard redesign (10-12, `d8f7a0c`) scopes all feature pages to `?exchangeAccountId=` from a composition shell; Strategies/Analytics/Settings respect the URL scope | `d8f7a0c`; dashboard refactor `stages 1-4` |
| A2 | ✅ | Account selector repositioned in dashboard composition shell (stages 1-4); balance cards, portfolio chart and trades retitle consistently with account selection | `d8f7a0c`; `f069534` |
| A3 | ✅ | Account selection is now URL-persisted via `?exchangeAccountId=` (D2 decision implemented in `d8f7a0c`); refresh/share preserves the selection | `d8f7a0c`; `f069534` |
| A4 | ✅ | Bot/strategy cards now filtered by `?exchangeAccountId=`; master-detail workspace (`a37c74`) renders account-scoped sessions and strategies | `d8f7a0c`; `a37c74`; `16b21ff` |
| A5 | ✅ | Balance scope now composed from URL `?exchangeAccountId=` in the composition shell; module singleton replaced with scoped composition. Navigation-history dependency removed. | `d8f7a0c`; `f069534`; `dc8f7a5` |

## B. Balance semantics → Phase 4 (4a backend, 4b frontend)

| ID | Sev | Finding | Evidence |
| -- | --- | ------- | -------- |
| B1 | ✅ | Four Dashboard cards split into distinct objects: `walletBalance` (chain), `accountBalance` (venue total), `availableForTrading` (hangar), `totalAssets` (realised+unrealised) — no more 1:1 number mapping | `dc8f7a5` (Phase 4a); `f069534` |
| B2 | ✅ | Both cards now draw from the same account model; "Available / For trading" uses `availableForTrading` (hangar), `Wallet` uses `accountBalance` — no more contradictory numbers | `dc8f7a5` (Phase 4a) |
| B3 | ✅ | All balance cards now carry `observedAt` freshness and `source` tag; `timestamp` no longer displayed (research-balance Q5 resolution) | `dc8f7a5` (Phase 4a) |
| B4 | 🔴 ✅ | Balance fetch is VERIFIED-only, yet Strategies gates its four cards open for REGISTERED ⇒ a REGISTERED user sees **four `$0.00` cards** (Wallet/Account/Available/Total) implying zero funds instead of "not connected" | `useBalance.ts:52`, `Strategies.tsx:298-300` (`\|\| 0` at 310/323/336/349) · closed by Phase 0.5 task 2.4 (REGISTERED gets an honest note; card semantics stay Phase 4) |

| B5 | 🟠 ✅ | REGISTERED dashboard falls into "No Portfolio Data Available — …contact support" — an error-flavoured dead-end for the normal pre-verification state (BASIC gets a proper Connect card; REGISTERED does not) | `Dashboard.tsx:561-570` · closed by Phase 0.5 task 2.5 (proper CTA card; balance-card semantics stay Phase 4) |
| B6 | ✅ | Wallet card now shows chain `walletBalance` from `GET /api/balance/current`; account card shows venue `accountBalance`. The wallet-vs-account distinction is now explicit in the UI | `dc8f7a5` (Phase 4a); `b393dc1` |

## C. Lifecycle & action-required states → Phases 1 (proof), 3 (design)

| ID | Sev | Finding | Evidence |
| -- | --- | ------- | -------- |
| C1 | ✅ | Dashboard redesign (stages 1-4) now shows bot lifecycle at a glance: `Bot Engine: <status>` badge with account-scoped run state + `needs-user-action` flag; /strategies still provides the master-detail bot list | `d8f7a0c` (stages 1-4); `c4b8ac2` |
| C2 | ✅ | UNKNOWN base copy now shows the plain-language reason in all cases; `needs_user_action` only escalates the action-required banner | `c4b8ac2` (Phase 1); `16b21ff` |
| C3 | ✅ | Master-detail workspace (`a37c74`) renders all lifecycle states on refresh: STARTING/STOPPING mid-transition, UNKNOWN→RUNNING converge, action-required banner drive the Resume flow | `a37c74` (Phase 3); `e1c667f` (F4, no-chart-dispose-on-error); `3e1bf3a` (F5, cleanup-incomplete banner) |
| C4 | ⚪ | The Resume flow itself (banner → `needs_user_action_reason` → Resume, same botId, no duplicate) is implemented, tested (`BotControls.test.tsx:232,250`) and Gate-5 proven — this plan changes presentation only | plan §11 non-goals |

## D. PnL & portfolio presentation → Phase 5

| ID | Sev | Finding | Evidence |
| -- | --- | ------- | -------- |
| D1 | 🟠 | Dashboard computes `pnl/pnlPercent/dailyVolume = 0 // TODO` — verified **dead code** (`portfolio.` is never read beyond a truthiness gate). Net effect: the workhorse page presents **no PnL metric at all**; realised PnL appears only implicitly inside the equity-curve derivation, unrealised only per-row in positions. The `017` realised/unrealised split is shown nowhere as a split | `Dashboard.tsx:377-397`; `dashboardService.ts:55-80`; trades table `897-951` has no PnL column |
| D2 | 🔴 ✅ | Portfolio chart fabricates a data point when there is no data: `value: totalBalance \|\| 10000` — a user with no balance can be shown a **$10,000 equity curve** | `Dashboard.tsx:400-407` · closed by Phase 0.5 task 1.4 (empty state, no fabricated point) |

## E. Tier gates & onboarding funnel → Phase 6

| ID | Sev | Finding | Evidence |
| -- | --- | ------- | -------- |
| E1 | 🟠 🔶 | `ProtectedRoute` bounces silently (`requireRegistered`/`requireRole` → bare `/dashboard`) with no reason surfaced; `requireVerified` is defined but **no route ever uses it** (dead gate) | `App.tsx:47-81`; grep: only definition site · **partial**: `requireVerified` now live on `/strategies` (Phase 0.5 HD1/task 1.1, `requireRegistered` prop removed); silent-redirect reason param → Phase 6 |
| E2 | 🟠 ✅ | The tier matrix disagrees with itself on who may use `/strategies`: **route** allows REGISTERED (`requireRegistered`), **nav** shows it only to VERIFIED, **Profile** tells the user it "Requires VERIFIED". Three surfaces, two answers | `App.tsx:206`, `SmartNavigation.tsx:84`, `Profile.tsx:300-311` · closed by Phase 0.5 HD1/task 1.1 (route now `requireVerified`; all three surfaces agree on VERIFIED) |
| E3 | 🔴 ✅ | Profile save is **fake**: `handleSave` persists nothing yet toasts "Profile updated successfully!"; validation state is hardcoded all-valid so the inputs never actually validate | `Profile.tsx:42-48,83-94` · closed by Phase 0.5 task 1.9 (real `updateProfile` + error surfacing + `ValidatedInput`) |
| E4 | 🟠 ✅ | Onboarding CTAs are inert: "Check Qualification →", "Go to Settings →", "Go to Dashboard →" buttons have **no onClick**; landing page offers no register path at all (hero + "Get Started" + nav all → `/login`; `/register` reachable only via the login page) | `UserProgressCard.tsx:226,248,270`; `LandingPage.tsx:11-13,147` · closed by Phase 0.5 tasks 1.10/1.11 (CTAs wired; landing register path) |
| E5 | 🟡 ✅ | Landing promises vs reality (HD4): removed "10K+ Active Traders", "99.9% Uptime", "AI-Powered … machine learning", dead `href="#"`, © → current; kept generic defensible value props. **2026-10-09 (admin decision):** the stats bar is restored with **honest, code-verifiable** figures — 24/7 *automated execution* (always-on engine), *2* connected exchanges (Kodiak/Orderly + Lighter), *3* strategy types (Grid/Trend/Arbitrage) — no fabricated social-proof claims. Admin is final authority on informational blocks; docs guide. | `LandingPage.tsx:219-244`; test `LandingPage.test.tsx` asserts banned claims absent + honest stats present |
| E6 | 🟡 ✅ | AppHeader "Billing" links to `/billing` — **no such route and no wildcard** ⇒ clicking it renders header + blank content | `AppHeader.tsx:107-113`; `App.tsx:189-281` (no `path="*"`) · closed by Phase 0.5 task 1.7 (Billing link removed) |
| E7 | 🟡 ✅ | Kodiak brand residue in user-facing copy (product is multi-venue; backend de-branded 2026-10-06): progress step "Kodiak trading account", "Add your Kodiak API credentials", Strategies "Connect Kodiak Account" | `UserProgressCard.tsx:54,245`; `Strategies.tsx:186,360-364` · closed by Phase 0.5 tasks 1.6/1.10 (all Kodiak copy de-branded) |

| E8 | 🟡 ✅ | AppHeader fabricates status: "Last login: Just now" is a literal; the logo/avatar status dots are always green regardless of WS/connection state | `AppHeader.tsx:32,63,81` · closed by Phase 0.5 task 1.7 (real WS status; status dots reflect connection) |
| E9 | 🟠 | No presentation exists for an **external** level drop mid-session (e.g. account deactivated → recomputed level on refresh): WS teardown is tested, but the user sees no explanation — research §2.4 | grep: downgrade presentation only for explicit wallet-unlink; `ws-downgrade.test.tsx` covers mechanics |
| E10 | 🟡 ✅ | `getNextStepLabel` tells REGISTERED users the next step is "**Wallet Verification**" — contradicting the prompt directly below it ("Next: Connect Trading Account"); REGISTERED already has the wallet | `UserProgressCard.tsx:289-290` vs `235-250` · closed by Phase 0.5 task 1.10 (REGISTERED next-step label corrected) |

## F. Fabricated/static content & dead affordances → mixed (see Phase)

| ID | Sev | Finding | Evidence |
| -- | --- | ------- | -------- |
| F1 | 🔴 ✅ | **Analytics renders invented metrics as fact**: `mockAnalytics` (total return 12.5%, win rate 68.5%, 1,247 trades, Sharpe 1.8, "DeFi/NFT/Gaming sectors") is displayed for every qualified user even though a real `useAnalytics` fetch gates the section; the comment says "replace with real data in production". `totalReturn` is even rendered twice with different units ("+12.5%" and "$12.5") | `Analytics.tsx:62-88,168-360` (mock rendered at 184+, 256+, 331+; real `data` only gates visibility at 168) · closed by Phase 0.5 task 1.5 (mock deleted; only real `data.metrics` rendered; sector section removed) |
| F2 | 🟡 ✅ | Dead buttons with no `onClick`: Dashboard "Refresh", "New Strategy", "Filter", "Sort" | `Dashboard.tsx:474,478,682,685` · closed by Phase 0.5 tasks 1.2/1.3 (Refresh/New Strategy wired; Filter/Sort deleted) |
| F3 | 🟠 ✅ | Dashboard "System Status" block is **hardcoded literals** shown to every user: API Connection "Connected", Bot Engine "Idle" (wrong whenever bots run), Last Sync "Just now" — real sources exist (`GET /engine/status`, `/health`) | `Dashboard.tsx:628-652` · closed by Phase 0.5 task 2.3 (Bot Engine from real status query; Last Sync from positions `dataUpdatedAt`; API Connection from live WS status) |
| F5 | 🟡 ✅ | `LoadingStates` config is **dead** (zero consumers repo-wide) and its copy is fictional — e.g. stop shows "Closing positions" (BOT_STOP does not close positions), "Checking NFT ownership" | `loading-config.ts:1-56`; grep: no importers · closed by Phase 0.5 task 1.7 (dead config deleted) |
| F7 | 🟡 ✅ | Strategies engine-offline banner tells end users to run `npm run prod:engine` — operator instructions leaking into user UI (the banner itself is honest and stays) | `Strategies.tsx:376-386` · closed by Phase 0.5 task 1.7 (neutral copy; operator docs referenced) |
| F8 | ⚪ ✅ | Three unreachable Kodiak-branded error branches guarded by a never-set state (`kodiakError` is `useState(null)` with the setter discarded) — dead code + brand residue, delete or wire up | `Strategies.tsx:38,170-199,354-372` · closed by Phase 0.5 task 1.6 (branches + never-set state deleted) |
| F6 | ⚪ | Admin: `overview` tab uses **real** health/metrics/services queries with error states; users/system/security/bots/settings tabs are honestly labelled "Coming Soon" — acceptable, recorded for completeness | `AdminDashboard.tsx:32-49,396-496` |

## G. Loading / empty / error states → Phase 7

| ID | Sev | Finding | Evidence |
| -- | --- | ------- | -------- |
| G1 | 🟠 ✅ | Strategies ran a 5-minute interval `cleanup()` that `removeQueries` for `strategies` + `bot-instances` **regardless of visibility** — active components refetch through a loading state ⇒ periodic flicker on an open page; the `bot-instances` `removeQueries`/`cancelQueries` also violated the single-owner cache (commit `448712c`), tearing data from under mounted `useBotState` observers and blanking the route | `Strategies.tsx:52-83` (interval at 76) · **closed 2026-10-09** — cleanup now touches only the page-owned `["strategies"]` key (no `bot-instances` `remove`/`cancel`, no `window.gc()`); the single-owner `useBotLifecycle` exclusively owns `["bot-instances"]`. Same principle as `448712c`; also covered by the new top-level `ErrorBoundary` |
| G2 | ✅ | Balance error channel (L15) works as designed on both balance surfaces: failure → "Balance unavailable" + server reason, never $0/stale | `Dashboard.tsx:448-466`, `Strategies.tsx:288-296`, `useBalance.ts:33-39` |
| G3 | ✅ | Empty states exist and are decent: no-strategies CTA, "No recent trades", BASIC connect-wallet card; Analytics has proper loading + error + retry | `Strategies.tsx` empty branch, `Dashboard.tsx:543-560,889-894`, `Analytics.tsx:141-165` |

## H. Layout & routing consistency → Phases 5–6

| ID | Sev | Finding | Evidence |
| -- | --- | ------- | -------- |
| H1 | 🟠 ✅ | `/analytics` renders a **second full `<AppHeader>`** while `App.tsx:137` already renders one for the route — two stacked headers | `Analytics.tsx:117`, `App.tsx:137` · closed by Phase 0.5 task 1.5 (local header removed) |
| H2 | 🟡 ✅ | Analytics bypasses the `PageLayout`/`Container` conventions (raw `container` div) and its AccessDenied "← Back to Dashboard" uses `window.history.back()` — the label can be false | `Analytics.tsx:24-60,114-115` · closed by Phase 0.5 task 1.5 (`navigate("/dashboard")`; label now true) |
| H3 | ⚪ | Strategies renders a page masthead under the global header (Dashboard does not) — cosmetic inconsistency, decide a convention in the Phase 5/6 design pass | `Strategies.tsx:201-235` |

## X. Live-test findings (2026-10-09 two-account smoke) → see `docs/instructions/ui-ux-live-test-findings.md`

| ID | Sev | Finding | Evidence |
| -- | --- | ------- | -------- |
| X1 | 🟡 ✅ | StrategyForm symbol picker is **venue-blind with duplicate labels**: a flat union of both venues' symbols, prefix-stripped, so Kodiak's `PERP_ETH_USDC` and Lighter's `ETH` both display as "ETH" — a user reasonably picks "ETH" and gets the Kodiak symbol, which then **fails at start** on a Lighter account (`VenueSymbolError`, the L20 gate doing its job but as a reject, not a guide). | `StrategyForm.tsx:49-61,306-320`; live: `logs/error-2026-10-09.log` (req `req_3a7cd55ef6afb706`); the working guard: `venue-symbols.ts:96`, `bot-lifecycle.service.ts:301-308` · **closed 2026-10-09** — picker now groups by venue via `<optgroup label>` + a hint; `frontend` format/lint/tsc green |
| X2 | 🟠 ✅ | Make the symbol picker *venue-aware* — validate the strategy's symbol against the account actually selected at start (turn the start-time reject into a guide). The `assertSymbolSupported` start gate remains the authoritative backstop. | `StrategyForm.tsx` (picker) + `venue-symbols.ts` (catalog source) · **closed 2026-10-09 (option a — venue check at start):** `GET /api/market/venue-symbols` (auth, fail-open) + `marketApi.getVenueSymbols` + `BotControls` inline warning/disable when the strategy symbol isn't on the selected venue; backend route + frontend API tests added; format/lint/tsc green. Eventual target (platform-canonical symbol + shared market-map) noted in `ui-ux-live-test-findings.md` §1.1, not built |
| X3 | 🟠 ✅ | The **Strategies chart was venue-blind**: the whole fetch chain (`Strategies.tsx → CandlestickChart → useChartData → marketApi.getTvHistory → GET /api/market/tv/history`) only speaks Kodiak/Orderly (`/v1/tv/history`), but strategies store *venue* symbols (`"ETH"` for Lighter, 26 rows) — bare symbols **400** there; the one legacy `PERP_BTC_USDC` strategy masked it (only that chart worked). | code trace + live probe (`PERP_ETH_USDC` → 200, `ETH`/`BTC` → 400) · **closed 2026-10-09 — venue dispatch:** `/tv/history?exchange=&environment=` (absent → Kodiak path byte-identical; `lighter` → new public candles reader `lighter/market-data.ts`: directory-resolved `market_id`, 1:1 resolution map, `t` ms→s, Redis key `tv:history:lighter:{env}:…`); frontend threads `venue` through `CandlestickChart/useChartData` (query + dedupe keys include venue; Orderly WS **skipped** for Lighter → poll-only ~60 s); Strategies dropdown now = full venue catalogs (X2 endpoint, `<optgroup>` per venue, encoded option values) with default = first strategy's symbol resolved by catalog membership (ties → first ACTIVE account's venue); shared `venue-client`/`market-directory` extracted from `portfolio.ts`. Reader (9) + route (6) + picker helper (12) + API tests; backend + frontend format/lint/tsc + tests green. **Deferred:** Lighter realtime WS ticks; platform-canonical symbol layer stays the eventual target (X2 §1.1 note) |
| X4 | 🟠 ✅ | **Any wallet with the JWT could drive the bots** — `start`/`stop`/`resume`/`runs` required only a valid session token, never proof the caller holds the linked wallet's key, and an account could be bound to a wallet that isn't the venue owner. | live trace of `management.ts` route chains (no proof step) + venue-owner lookups (Kodiak `GET /v1/public/account?account_id=` → `data.address`; Lighter `GET /api/v1/account?by=index&value=` → `accounts[0].l1_address`, both public) · **closed — wallet-owner proof + venue-verified binding (Option E):** `wallet-proof.service.ts` issues a server-built challenge (action + UUID nonce + issued/expires + "no transaction" note) at Redis `wallet:challenge:{userId}:{nonce}`, TTL **300 s**, **single-use** (DELed on first consume, no proof-reuse cache — D4); `consumeProof` verifies the signature over the *stored* message and requires the address ∈ linked EVM wallets; `requireWalletProof(action)` middleware gates the four routes after Joi (proof absent → 403 `PROOF_REQUIRED`; Redis outage → 503 fail-closed). **D1:** start/stop/resume/runs gated, **emergency-stop exempt**. **D3:** `WALLET_PROOF_REQUIRED` default **on** (`false` = harness/e2e). **D2 binding:** connect/verify resolves the venue owner, rejects when it ∉ the user's linked wallets (400 `VENUE_OWNER_NOT_LINKED`), persists `meta.walletBinding`; the start/stop/resume/runs gate then requires `proofAddress === meta.walletBinding.address`, **binding absent → 403** (fail-closed). `scripts/backfill-wallet-bindings.ts` (idempotent, run before the enforcement deploy). Frontend: `useWalletProof` (wagmi v3), `BotControls` threads the proof + "Requires a wallet signature" hint, `ConnectExchangeAccount` binds `account:bind`. 3 stale 403s reworded to "connect and verify an exchange account" (funnel is account-driven per `user-level.service.ts:26`). Backend (wallet-proof 16, venue-owner 14, controller +9, exchange-account +3) + frontend (useWalletProof 6, wallet/trading payloads, BotControls +4) green; tsc/eslint/prettier/build green. **Honest limits:** proof = *presence of the linked wallet's key*; binding = *venue-asserted ownership* cached at connect/verify, **not** re-checked per start; wallet *session* heartbeat out of scope. |

Note (X-adjacent, no action): the `Bot marked UNKNOWN via heartbeat inventory
reconciliation` line in the same session is **expected crash-recovery** (engine
restarted 08:45:45; a bot from the prior day surfaces as "Action required →
Resume"), not a defect. User-level model (BASIC→REGISTERED→VERIFIED) confirmed
matches `user-level.service.ts:25`. Full write-up + coverage read in the
companion doc.

## Already correct (do not regress)

- **P1** Balance failure → explicit "unavailable + reason" (L15) — the model to extend (G2).
- **P2** `UserProgressCard` structure: 4 steps, % progress, "Next:" label, per-level prompt text (CTAs now wired — E4 — ✅).
- **P3** BASIC users get a real Connect-your-wallet widget on the Dashboard (`WalletConnectDialog`, `Dashboard.tsx:614-626`).
- **P4** Engine-offline banner is factual about consequences ("starting requires the engine"; fails fast 503) — minus the npm leak (F7).
- **P5** Post-create start prompt explains that a strategy is created inactive and starting = bot + account + size (`Strategies.tsx:495-538`).
- **P6** Admin overview is genuinely wired (3 real queries, 30–60 s refresh, error states).
- **P7** SmartNavigation hides analytics/admin by `available:` (role/level), so most users never see those links — the silent-redirect issue (E1) matters mainly for direct URLs.
- **P8** `/strategies` chart is a page-level market panel (`StrategyChartPanel`, F5, 2026-10-14): it mounts in the empty state — a brand-new account used to see **no chart at all** because the chart lived inside `StrategyWorkspace`, which only renders when a strategy is selected — and the create/edit form is a right-hand drawer whose scrim is click-through from `lg` up, so the chart stays visible *while configuring a grid*. The form publishes its watched `symbol/gridSize/gridRange` (`useWatch`) and the chart draws the band those fields would build (`shared/components/charts/gridPreview.ts`, geometry mirrored from the engine's `buildLevels` minus tick quantization — preview-only, documented as such). A draft naming a market other than the charted one is withheld with a one-line explanation rather than drawn misattributed.

---

## Route checklist (plan task 0.1) — the nine routes at a glance

| Route | Which account? | Balance semantics | Lifecycle surface | Mid-transition / refresh | Tier behaviour |
| ----- | -------------- | ----------------- | ----------------- | ------------------------ | -------------- |
| `/` Landing | — | — | — | — | Marketing claims vs reality (E5); no register path (E4) |
| `/login` | — | — | — | — | Clean; auth errors handled in context |
| `/register` | — | — | — | — | Clean; drops user on bare `/dashboard` — no "what's next" handoff |
| `/dashboard` | Newest ACTIVE, via buried selector (A2), not URL (A3), pins balance singleton (A5) | 4 cards = ≤2 distinct numbers (B1), "Wallet" = exchange total (B6), no freshness (B3), no PnL metric (D1), fabricated chart point (D2 ✅ fixed 0.5), static System Status (F3 ✅ fixed 0.5) | **None** (C1) | Skeletons + L15 error (✅); REGISTERED dead-end (B5 ✅ fixed 0.5) | Progress card ✅ CTAs wired (E4 ✅); tier logic real (E1 partial); "New Strategy" VERIFIED-only (F2 ✅) |
| `/strategies` | **Unscoped** (A1, A4) | Same 4 cards (B1) + "Available funds" lie (B2) + $0 for REGISTERED (B4 ✅ fixed 0.5 — honest note) | Bot cards + BotControls (Resume/needs-action ✅ presentation pending Phase 3) | Balance states ✅; 5-min cache purge flicker (G1 ✅ fixed 2026-10-09) | **Requires VERIFIED** (E2 ✅ fixed 0.5 via HD1); Kodiak branches gone (F8 ✅); banner neutral (F7 ✅) |
| `/settings` | Account **management** only (fine) | — | — | Query + components own their states | — |
| `/analytics` | **Unscoped** (A1) | — | — | Loading/error/retry ✅ | **Real metrics only** (F1 ✅ fixed 0.5); single header (H1 ✅); AccessDenied via `navigate` (H2 ✅) |
| `/profile` | — | — | — | — | **Real save + validation** (E3 ✅ fixed 0.5); tier matrix consistent (E2 ✅) |
| `/admin` | — | — | Bots tab = "Coming Soon" (F6 ⚪) | Real overview queries ✅ (P6) | Role-gated; silent redirect on direct URL (E1) |

Cross-cutting: no `/billing`, no wildcard ⇒ blank page (E6); AppHeader fake
status (E8); no downgrade presentation (E9).

---

## Open questions for the design pass (post-audit)

1. **Tier matrix** (E2/E10) — ✅ **decided (HD1, 2026-10-08):** `/strategies` requires VERIFIED. Route, nav and Profile now agree; the C1 bot-lifecycle panel is Phase 3.
2. **F1 disposition** — ✅ **decided (HD2, 2026-10-08):** wire-or-remove rule applied — `totalReturn` (computed) wired, non-derivable metrics and the sector section removed; no invented numbers.
3. **B1/B6 shape** (Phase 4a decides): which objects are first-class on the
   dashboard strip — wallet (chain) / exchange-account / derived total — and
   which collapse to a detail view.
4. **Dashboard vs Analytics boundary** (D1/H1): the equity curve and any
   realised/unrealised PnL presentation — dashboard strip or Analytics?
5. **C1**: should the dashboard gain a bot-lifecycle panel (plan 5.2 says
   "audit decides") — recommendation: yes, at least a needs-action callout,
   since the parked state is otherwise discoverable only by visiting
   `/strategies`.
6. Dead affordances (F2, E4): ✅ **done 2026-10-08** — Dashboard dead buttons wired/removed (F2) and onboarding CTAs made functional (E4) in Phase 0.5.

## Phasing map (findings → plan phases)

| Plan phase | Findings closed |
| ---------- | --------------- |
| 0.5 — pre-smoke honesty pass | **B4, B5, D2, E1*(partial), E2, E3, E4, E5, E6, E7, E8, E10, F1, F2, F3, F5, F7, F8, H1, H2** (see `ui-ux-pre-smoke-plan.md`) |
| 1 — smoke tests | proves C3 mechanically (scenario 3); guards everything below |
| 2 — account selector | A1–A5 |
| 3 — lifecycle states | C1 (panel groundwork), C2, C4 presentation |
| 4 — balance | B1, B2, B3, B6 (B4/B5 already closed in 0.5) |
| 5 — dashboard split | D1 (D2 closed in 0.5), F1 remainder if any, H1 (closed 0.5) |
| 6 — onboarding | E1 remainder (reason params), E9 (E2/E3/E4/E10 closed 0.5), H2 (closed 0.5) |
| 7 — loading/empty/error | G1 (+ extend G2 pattern per 7.x) |

Note: **Phase 0.5** (the pre-smoke "Honesty Pass", re-sequenced 2026-10-08) is
now implemented and green on the touched files — it closed 22 findings early
without touching providers/WS/lifecycle mechanics. The findings above that
still list a phase are the ones 0.5 explicitly left for it.

Ledger: `docs/PROJECT_REVIEW_GAP_ANALYSIS.md` §4 carries the program row;
`docs/instructions/current_issues.md` tracks execution. This document is the
source of truth for finding statuses.

