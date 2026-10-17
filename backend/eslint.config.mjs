import tseslint from "typescript-eslint";
import { nodeWorkspaceConfig } from "../eslint.base.mjs";

export default tseslint.config(
  {
    ignores: [
      "dist/",
      "node_modules/",
      "*.js",
      "*.d.ts",
      // Plain CommonJS worker-thread script (copied to dist as-is by build);
      // intentionally not part of the ESM/TS lint surface
      "src/workers/password-worker-thread.js",
    ],
  },
  nodeWorkspaceConfig(),
  // =========================================================================
  // Architecture boundary enforcement (external review P2, 2026-10-15)
  //
  // Core (application domain) must never import concrete infrastructure — it
  // depends only on ports. Infrastructure implements core ports; the dependency
  // arrow never points inward. This covers PostgreSQL, repository adapters, and
  // every other infrastructure module (cache, security, external clients, etc.).
  //
  // HTTP routes must never orchestrate repository/pool calls directly — that
  // belongs in application use cases wired in server/route-config.ts.
  //
  // Entries are applied in order; the file-specific allowlist entries below
  // deliberately carve out existing debt with a TODO + follow-up issue so the
  // rule is enforced everywhere else and the allowlist can shrink over time.
  // =========================================================================
  {
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/database/**"],
              message:
                "Core depends on ports, not PostgreSQL. Move SQL behind a port in core/ and an adapter in infrastructure/ (review P1).",
            },
            {
              group: ["**/infrastructure/adapters/repositories/**"],
              message:
                "Core must not import repository adapters. Inject a port; implement it in infrastructure/adapters/repositories (review P1).",
            },
            {
              group: ["**/infrastructure/**"],
              message:
                "Core must not import infrastructure. Depend on a port defined in core/; the concrete implementation lives in infrastructure/ and is wired at startup.",
            },
          ],
        },
      ],
    },
  },
  // (2026-10-17, review Arch-2): existing debt — core files still importing
  // infrastructure concretely. Temporary exceptions; remove each entry as the
  // file is ported to ports (see docs/instructions/current_issues.md item 8).
  // Remaining debt: exchange-account, wallet-proof, service-factory
  // (service-factory deferred to a later phase).
  {
    files: [
      "src/core/user/exchange-account.service.ts",
      "src/core/wallet/wallet-proof.service.ts",
      "src/core/service-factory.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  // (2026-10-16, review P3 Phase 1): service-factory.ts and
  // wallet-proof.service.ts were previously cleared of their P3 core
  // allowlist entries; they are now re-listed above as temporary Arch-2
  // exceptions pending the broader infra porting.
  {
    files: ["src/interfaces/http/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/database/**"],
              message:
                "Routes must not call PostgreSQL directly. Move data access into a use case; wire it in server/route-config.ts (review P1).",
            },
            {
              group: ["**/infrastructure/adapters/repositories/**"],
              message:
                "Routes must not import repository adapters. Call an injected use case; wire repositories in server/route-config.ts (review P1).",
            },
          ],
        },
      ],
    },
  }
  // Existing debt: HTTP routes still importing repository adapters / pool.
  // (2026-10-16, review P3 Phase 2): market-cache.ts, market-portfolio.routes.ts,
  // wallet/balance.ts and system/health.ts were cleared — all four now go
  // through injected ports wired in server/route-config.ts (setCredentialGateDeps /
  // setPortfolioScopeDeps / setBalanceWalletLookup / setHealthDb).
);
