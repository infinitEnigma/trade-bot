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
  nodeWorkspaceConfig()
);
