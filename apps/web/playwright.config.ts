import { defineConfig, devices } from '@playwright/test';

/**
 * Browser journeys.
 *
 * Deliberately few. Playwright tests are the slowest and most fragile thing in the suite,
 * so they cover the journeys that only make sense in a browser: keyboard operation of the
 * queue, the demonstration notice being present on every page, and accessibility of a
 * fully rendered page. Anything that can be asserted about ordering or state lives in
 * incident-view-model.spec.ts, which runs in milliseconds.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // A test marked .only that reaches main would silently reduce coverage to one test.
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 2 : undefined,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // The contact view is opened on a phone, from a text message, so it is tested at
    // that width rather than assumed to be fine because the desktop layout passes.
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],

  webServer: {
    command: 'pnpm build && pnpm start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  },
});
