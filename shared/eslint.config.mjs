import tseslint from 'typescript-eslint'
import { nodeWorkspaceConfig } from '../eslint.base.mjs'

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', '*.js', '*.d.ts'] },
  nodeWorkspaceConfig(),
)

