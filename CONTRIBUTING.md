# Contributing to trade-bot

## Mandatory Pre-Commit Gates

**Every commit must pass all four gates from the repo root before `git commit`:**

| #   | Gate   | Command                | Requirement                                                                              |
| --- | ------ | ---------------------- | ---------------------------------------------------------------------------------------- |
| 1   | Format | `npm run format:check` | Prettier-clean (0 unformatted files)                                                     |
| 2   | Lint   | `npm run lint`         | ESLint **0 errors** (warnings allowed, tracked)                                          |
| 3   | Build  | `npm run build`        | `tsc` + `vite` compile cleanly across all workspaces (backend, frontend, engine, shared) |
| 4   | Tests  | `npm test`             | All test suites pass                                                                     |

If a gate fails, fix it before committing — **never commit red**.

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
