import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // Tests share local Supabase state — run sequentially to avoid conflicts
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    // Runs first: signs in and saves browser storage state to e2e/.auth/user.json
    {
      name: 'setup',
      testMatch: /setup\.ts/,
    },
    // All other tests start already signed in
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
  // Playwright starts the Vite dev server automatically.
  // Prerequisites (run these in separate terminals before `npm run test:e2e`):
  //   supabase start
  //   supabase functions serve  (picks up supabase/functions/.env with MOCK_GEO_SIF=true)
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
})
