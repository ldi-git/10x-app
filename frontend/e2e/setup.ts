import { test as setup } from '@playwright/test'
import fs from 'node:fs'
import { TEST_EMAIL, TEST_PASSWORD, AUTH_TEST_EMAIL, AUTH_TEST_PASSWORD } from './constants'

const AUTH_FILE = 'e2e/.auth/user.json'

async function ensureUser(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
) {
  // Navigate first so localStorage is accessible, then clear any existing session
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/')
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')

  try {
    await page.waitForSelector('.header-nav', { timeout: 4000 })
  } catch {
    // Account doesn't exist yet — switch to sign-up and retry
    await page.click('button.link-btn')
    await page.click('button[type="submit"]')
    await page.waitForSelector('.header-nav', { timeout: 6000 })
  }
}

// Signs in as the two test users (creating them if needed) and persists the
// primary user's browser storage state so all chromium tests start authenticated.
setup('authenticate test users', async ({ page }) => {
  fs.mkdirSync('e2e/.auth', { recursive: true })

  // Create the auth-flow test user first (used by auth.spec.ts sign-in/sign-out)
  await ensureUser(page, AUTH_TEST_EMAIL, AUTH_TEST_PASSWORD)

  // Sign in as the primary test user and save storage state
  await ensureUser(page, TEST_EMAIL, TEST_PASSWORD)
  await page.context().storageState({ path: AUTH_FILE })
})
