/**
 * Automated Import Path Fixer for Backend Restructure
 *
 * This script systematically updates import paths after the domain-driven restructure.
 * It handles bulk import updates for moved services, utilities, and interfaces.
 *
 * Usage: node scripts/fix-imports.js
 */

const fs = require('fs');
const path = require('path');

// Import path mappings from old to new locations
const IMPORT_MAPPINGS = [
  // Infrastructure services
  {
    pattern: "from \"../services/redis\"",
    replacement: "from \"../infrastructure/cache/redis.service\""
  },
  {
    pattern: "from \"../services/cache-invalidation\"",
    replacement: "from \"../infrastructure/cache/cache-invalidation.service\""
  },
  {
    pattern: "from \"../services/credential-cache\"",
    replacement: "from \"../infrastructure/cache/credential-cache.service\""
  },
  {
    pattern: "from \"../services/encryption\"",
    replacement: "from \"../infrastructure/security/encryption.service\""
  },
  {
    pattern: "from \"../services/key-management\"",
    replacement: "from \"../infrastructure/security/key-management.service\""
  },
  {
    pattern: "from \"../services/database-security\"",
    replacement: "from \"../infrastructure/security/database-security.service\""
  },
  {
    pattern: "from \"../services/kodiak-connection\"",
    replacement: "from \"../infrastructure/external/kodiak-connection.service\""
  },
  {
    pattern: "from \"../services/kodiak-integration\"",
    replacement: "from \"../infrastructure/external/kodiak-integration.service\""
  },
  {
    pattern: "from \"../services/market-stream\"",
    replacement: "from \"../infrastructure/messaging/market-stream.service\""
  },

  // Core domain services
  {
    pattern: "from \"../services/auth\"",
    replacement: "from \"../core/auth/auth.service\""
  },
  {
    pattern: "from \"../services/role-management\"",
    replacement: "from \"../core/auth/role-management.service\""
  },
  {
    pattern: "from \"../services/user-profile\"",
    replacement: "from \"../core/user/user-profile.service\""
  },
  {
    pattern: "from \"../services/bot-status\"",
    replacement: "from \"../core/trading/bot-status.service\""
  },
  {
    pattern: "from \"../services/bot-performance\"",
    replacement: "from \"../core/trading/bot-performance.service\""
  },
  {
    pattern: "from \"../services/engine-manager\"",
    replacement: "from \"../core/trading/engine-manager.service\""
  },
  {
    pattern: "from \"../services/position-sync\"",
    replacement: "from \"../core/trading/position-sync.service\""
  },
  {
    pattern: "from \"../services/position-validator\"",
    replacement: "from \"../core/trading/position-validator.service\""
  },
  {
    pattern: "from \"../services/balance\"",
    replacement: "from \"../core/wallet/balance.service\""
  },
  {
    pattern: "from \"../services/wallet-qualification\"",
    replacement: "from \"../core/wallet/wallet-qualification.service\""
  },
  {
    pattern: "from \"../services/error-notification\"",
    replacement: "from \"../core/notifications/error-notification.service\""
  },

  // Shared utilities
  {
    pattern: "from \"../types/errors\"",
    replacement: "from \"../shared/types/errors\""
  },
  {
    pattern: "from \"../utils/context\"",
    replacement: "from \"../shared/utils/context\""
  },
  {
    pattern: "from \"../utils/orderly-signature\"",
    replacement: "from \"../shared/utils/orderly-signature\""
  },
  {
    pattern: "from \"../validation/",
    replacement: "from \"../shared/validation/"
  },

  // Workers
  {
    pattern: "from \"../services/password-worker\"",
    replacement: "from \"../workers/password-worker\""
  }
];

/**
 * Recursively find all TypeScript files
 */
function findTsFiles(dir, files = []) {
  const items = fs.readdirSync(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
      findTsFiles(fullPath, files);
    } else if (item.endsWith('.ts') && !item.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Apply import fixes to a single file
 */
function fixImportsInFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  for (const mapping of IMPORT_MAPPINGS) {
    if (content.includes(mapping.pattern)) {
      content = content.replace(new RegExp(mapping.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), mapping.replacement);
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✅ Fixed imports in: ${path.relative(process.cwd(), filePath)}`);
    return true;
  }

  return false;
}

/**
 * Main execution function
 */
function main() {
  console.log('🔧 Starting automated import path fixes...\n');

  const backendSrcDir = path.join(__dirname, '..', 'backend', 'src');
  const tsFiles = findTsFiles(backendSrcDir);

  console.log(`📁 Found ${tsFiles.length} TypeScript files to process\n`);

  let filesModified = 0;
  let totalReplacements = 0;

  for (const filePath of tsFiles) {
    const modified = fixImportsInFile(filePath);
    if (modified) {
      filesModified++;
      // Count replacements in this file
      let content = fs.readFileSync(filePath, 'utf8');
      for (const mapping of IMPORT_MAPPINGS) {
        const matches = content.match(new RegExp(mapping.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
        if (matches) {
          totalReplacements += matches.length;
        }
      }
    }
  }

  console.log(`\n🎉 Import fixes completed!`);
  console.log(`📊 Files modified: ${filesModified}`);
  console.log(`🔄 Total replacements: ${totalReplacements}`);
  console.log(`\n🔍 Run 'cd backend && npm run build' to verify fixes.`);
}

// Run the script
main();
