const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({ testDir: './tests', testMatch: '**/*.spec.cjs', timeout: 90_000, workers: 1, reporter: 'list' });
