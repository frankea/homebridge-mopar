const baseProjectConfig = {
  testEnvironment: 'node',
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};

module.exports = {
  collectCoverageFrom: ['src/**/*.js', '!src/**/*.test.js'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json-summary'],
  coverageThreshold: {
    global: {
      branches: 40,
      functions: 55,
      lines: 60,
      statements: 60,
    },
  },
  projects: [
    {
      ...baseProjectConfig,
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/*.test.js'],
      testPathIgnorePatterns: ['<rootDir>/src/integration.test.js'],
      setupFilesAfterEnv: ['<rootDir>/test/setup/unit.js'],
      testTimeout: 15000,
    },
    {
      ...baseProjectConfig,
      displayName: 'integration',
      testMatch: ['<rootDir>/src/integration.test.js'],
      setupFilesAfterEnv: ['<rootDir>/test/setup/integration.js'],
      testTimeout: 45000,
    },
    {
      ...baseProjectConfig,
      displayName: 'e2e',
      testMatch: ['<rootDir>/test/e2e/**/*.test.js'],
      setupFilesAfterEnv: ['<rootDir>/test/setup/e2e.js'],
      testTimeout: 60000,
    },
  ],
};
