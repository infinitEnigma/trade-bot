import tseslint from 'typescript-eslint'
import js from '@eslint/js'
import { nodeWorkspaceConfig, nodeWorkspaceRules } from '../eslint.base.mjs'

// Flat config for the engine workspace.
// (Replaces the legacy engine/.eslintrc.js, which ESLint 9 never loaded —
// that misnamed file is deleted. Kept rules identical to the other Node
// workspaces, with console allowed for engine logging.)
export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', '*.js', '*.d.ts'] },
  {
    ...nodeWorkspaceConfig(),
    rules: {
      ...nodeWorkspaceRules,
      // Allow console in engine for logging
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.js'],
    ...js.configs.recommended,
  },
)
