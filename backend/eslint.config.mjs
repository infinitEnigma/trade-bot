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
  // Core (application domain) must never import concrete PostgreSQL or
  // repository adapters — it depends only on ports. Infrastructure implements
  // core ports; the dependency arrow never points inward.
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
          ],
        },
      ],
    },
  },
  // (2026-10-16, review P3 Phase 1): the former core allowlist entries
  // (service-factory.ts, wallet-proof.service.ts) were cleared — both now go
  // through the DI container / setWalletProofDeps. Core has NO exceptions.
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
  },
  // Existing debt: HTTP routes still importing repository adapters / pool.
  {
    files: [
      "src/interfaces/http/bots/engine.ts",
      "src/interfaces/http/bots/management.ts",
      "src/interfaces/http/wallet/balance.ts",
      "src/interfaces/http/trading/market-portfolio.routes.ts",
      "src/interfaces/http/trading/market-cache.ts",
      "src/interfaces/http/system/health.ts",
      "src/interfaces/http/auth/index.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  }
);
