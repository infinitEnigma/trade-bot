// debug-test.js
const logger = require('../backend/src/core/logging/logger.service').default;

console.log('logger:', logger);
console.log('logger.info:', typeof logger.info);
console.log('logger.info === console.log:', logger.info === console.log);

const getSchemaValidationMiddleware = require('../backend/src/shared/validation/schema-validation-middleware').getSchemaValidationMiddleware;
console.log('getSchemaValidationMiddleware:', getSchemaValidationMiddleware);

console.log('Importing migrate module...');
const migrateModule = require('../backend/src/database/migrate');
console.log('migrate module imported:', migrateModule);