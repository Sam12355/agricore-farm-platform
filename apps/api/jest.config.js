/**
 * Three projects rather than one suite.
 *
 * Unit tests cover the domain and application layers and run in a couple of seconds, so
 * they are the ones you leave in watch mode. Integration wires real modules with
 * in-memory adapters. End-to-end boots the whole Nest application in-process and drives
 * it over HTTP with supertest.
 *
 * None of the three needs Postgres, Redis, Mongo or AWS. That is on purpose: a test
 * suite that needs infrastructure is a test suite people stop running.
 */

/** @type {import('jest').Config} */
const common = {
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  rootDir: '.',
  clearMocks: true,
  restoreMocks: true,
};

module.exports = {
  projects: [
    {
      ...common,
      displayName: 'unit',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
    },
    {
      ...common,
      displayName: 'integration',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/integration/**/*.spec.ts'],
    },
    {
      ...common,
      displayName: 'e2e',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/e2e/**/*.spec.ts'],
    },
  ],
  // Applies to every project. Jest rejects testTimeout inside a project entry.
  testTimeout: 30000,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/main.ts',
    '!src/seed/**',
    '!src/scripts/**',
  ],
};
