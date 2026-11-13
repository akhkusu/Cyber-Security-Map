import { defineConfig, devices } from '@playwright/test';

const appBase = process.env.APP_BASE_PATH || '/';

export default defineConfig({
  testDir: './e2e',
  testMatch: appBase === '/' ? undefined : '**/pages.spec.ts',
  testIgnore: appBase === '/' ? '**/pages.spec.ts' : undefined,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:4174${appBase}` },
  webServer: {
    command: process.env.PAGES_TEST_DIRECTORY
      ? 'python3 -m http.server 4174 --bind 127.0.0.1 --directory "$PAGES_TEST_DIRECTORY"'
      : 'npm run preview -- --port 4174 --strictPort',
    url: `http://127.0.0.1:4174${appBase}`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
