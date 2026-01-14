/** @format */

// Jest setup file to configure environment variables for tests
process.env.JWT_SECRET = 'test-jwt-secret-for-testing-purposes-only-should-be-32-chars-minimum';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-for-testing-should-be-32-chars-minimum';
process.env.ENCRYPTION_MASTER_KEY = 'test-encryption-key-for-testing-32-chars-minimum';
process.env.NODE_ENV = 'test';
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '5432';
process.env.DB_NAME = 'trade_bot_test';
process.env.DB_USER = 'postgres';
process.env.DB_PASSWORD = 'postgres';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.CORS_ORIGIN = 'http://localhost:3000';
