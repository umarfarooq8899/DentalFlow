/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  testTimeout: 120000,
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
};
