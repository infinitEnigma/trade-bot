# Contributing to trade-bot

## Mandatory Pre-Commit Gates

**Every commit must pass all four gates from the repo root before `git commit`:**

| #   | Gate   | Command                | Requirement                                                                              |
| --- | ------ | ---------------------- | ---------------------------------------------------------------------------------------- |
| 1   | Format | `npm run format:check` | Prettier-clean (0 unformatted files)                                                     |
| 2   | Lint   | `npm run lint`         | ESLint **0 errors and 0 warnings** (`--max-warnings 0` in every workspace lint script)   |
| 3   | Build  | `npm run build`        | `tsc` + `vite` compile cleanly across all workspaces (backend, frontend, engine, shared) |
| 4   | Tests  | `npm test`             | All test suites pass                                                                     |

If a gate fails, fix it before committing — **never commit red**.

The gates are enforced locally and in review: there is no CI workflow yet, so
run all four before every push. Run the test gate as `CI=true npm test` (or from
a non-interactive shell) — Vitest starts in watch mode on a TTY. The backend
integration suite needs PostgreSQL and Redis reachable via `.env`.

### `any` Is Banned (`no-explicit-any: error`)

`@typescript-eslint/no-explicit-any` is set to `error` in the shared base config
(`eslint.base.mjs`) and the frontend config. Typing guidance:

- **Wire/DB/external payloads:** use `unknown` plus narrowing/type guards, e.g.
  `Partial<T>` candidate checks in the protocol guards.
- **Config blobs:** use `Record<string, unknown>` instead of `any`.
- **Repository rows:** use the shared contract interfaces (e.g. `BotInstanceRecord`,
  `Strategy` from `@trade-bot/shared`).
- **Tests:** build fixtures that satisfy the real contracts (`BotInstanceRecord`,
  `Strategy`, `StrategyConfig`, …); keep mocks consistent with production shapes
  (e.g. DB rows are `snake_case`, so ownership checks use `user_id`, `strategy_id`).

Exceptions must be narrow and justified: a scoped
`// eslint-disable-next-line <rule> -- <reason>` (never a broad/global disable),
or — only in real process entrypoints/shutdown paths — `no-process-exit`.

Quick fixes:

```sh
npm run format     # Prettier --write across the repo
npm run lint:fix   # ESLint --fix across workspaces
```

## Change Rules

1. **Update related documentation in the same commit.** If your change alters behavior, APIs, architecture, tooling, or scripts, update the README and any affected docs. Stale docs are treated as bugs.
2. **New features ship with tests.** Every new feature, endpoint, hook, or service must include tests:
   - Unit tests at minimum (Jest for backend/engine, Vitest for frontend).
   - Integration tests where external systems (PostgreSQL, Redis) are involved.
   - Bug fixes should include a regression test that fails without the fix.
3. **One logical change per commit.** Split unrelated reformatting from logic changes; use conventional commit prefixes: `feat:`, `fix:`, `chore:`, `docs:`, `style:`, `refactor:`, `test:`.
4. **Dependencies**: prefer minor/patch updates (`npm update <pkg> --workspaces`). Major bumps require a peer-constraint check against all workspaces and a dedicated PR with its own gates.
5. **Documentation layout**: the README answers _"what is the system today"_; `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md`, and `docs/PROJECT_REVIEW_GAP_ANALYSIS.md` own design, runbooks, and review history respectively. Do not add review/history language back into the READMEs. `docs/archived/` and `docs/instructions/` are untracked by design; durable docs live directly in `docs/`.

## Project Layout

| Workspace   | Purpose                                  | Test runner  |
| ----------- | ---------------------------------------- | ------------ |
| `backend/`  | Express API, auth, bots, market data     | Jest         |
| `engine/`   | Trading execution engine (Redis Streams) | Jest         |
| `frontend/` | React (Vite) trading dashboard           | Vitest       |
| `shared/`   | Protocol types & contracts               | (types only) |

## Workflow

1. Fork / branch: `git checkout -b feature/your-feature`
2. Make your change (code + tests + docs together)
3. Run the four gates (see table above)
4. Commit with a conventional prefix
5. Push and open a pull request
