/** Two projects: fast unit tests (no database) and integration tests (real Nest app + Postgres). */
const transform = { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: false, transpilation: true }] };
const common = { rootDir: '.', moduleFileExtensions: ['ts', 'js', 'json'], transform, testEnvironment: 'node' };
module.exports = {
  testTimeout: 60000,
  projects: [
    { ...common, displayName: 'unit', testMatch: ['<rootDir>/test/unit/**/*.spec.ts'] },
    {
      ...common,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/integration/**/*.spec.ts'],
      setupFiles: ['<rootDir>/test/setup-env.ts'],
    },
  ],
};
