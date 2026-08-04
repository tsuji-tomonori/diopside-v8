import { defineConfig, devices } from '@playwright/test';

const localChromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './e2e',
  ...(localChromium ? { workers: 1 } : {}),
  outputDir: 'reports/playwright',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['line'], ['html', { outputFolder: 'reports/playwright-html', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(localChromium ? {
      launchOptions: {
        executablePath: localChromium,
        args: ['--no-sandbox', '--disable-gpu', '--disable-webgl'],
      },
    } : {}),
  },
  projects: [
    {
      name: 'モバイル',
      use: { ...devices['Pixel 7'], viewport: { width: 375, height: 812 } },
    },
    {
      name: 'デスクトップ',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173/diopside-v8/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
