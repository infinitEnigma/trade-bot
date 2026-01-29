/** @format */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',  
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: [
    '**/__tests__/**/*.+(ts|tsx|js)',
    '**/*.(test|spec).+(ts|tsx|js)'
  ],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(shared|uuid)/)',
  ],
  collectCoverageFrom: [
    'src/**/*.(ts|tsx)',
    '!src/**/*.d.ts',
  ],
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^shared/(.*)$': '<rootDir>/../shared/dist/$1',
  },
  testTimeout: 15000, // Increased timeout for worker thread operations and database operations
  maxWorkers: 1, // Use single worker to prevent resource contention in tests
  forceExit: true, // Force exit after tests complete to prevent hanging
  detectOpenHandles: true, // Detect open handles that might prevent test completion
  verbose: true, // Show detailed test output
  testSequencer: '<rootDir>/test-sequencer.js', // Custom sequencer for better test ordering
};
