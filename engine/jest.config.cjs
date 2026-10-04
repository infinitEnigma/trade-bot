module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: [
    "**/__tests__/**/*.+(ts|tsx|js)",
    "**/*.(test|spec).+(ts|tsx|js)",
  ],
  // `__tests__/helpers/` holds shared test utilities (e.g. the Phase-6 fake
  // exchange), not test suites — without this jest treats them as empty suites.
  testPathIgnorePatterns: ["/node_modules/", "/__tests__/helpers/"],
  transform: {
    "^.+\\.(ts|tsx)$": "ts-jest",
  },
  transformIgnorePatterns: ["/node_modules/(?!(shared|uuid|@noble|bs58)/)"],
};
