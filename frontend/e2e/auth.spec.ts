import { test, expect } from '@playwright/test'
import { TEST_EMAIL, TEST_PASSWORD, AUTH_TEST_EMAIL, AUTH_TEST_PASSWORD } from './constants'

// These tests exercise the unauthenticated UI — override the default storageState
test.use({ storageState: { cookies: [], origins: [] } })

test('unauthenticated user sees sign-in form', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.auth-card')).toBeVisible()
  await expect(page.locator('input[type="email"]')).toBeVisible()
  await expect(page.locator('input[type="password"]')).toBeVisible()
})

test('sign in with valid credentials shows navigation', async ({ page }) => {
  await page.goto('/')
  await page.fill('input[type="email"]', AUTH_TEST_EMAIL)
  await page.fill('input[type="password"]', AUTH_TEST_PASSWORD)
  await page.click('button[type="submit"]')
  await expect(page.locator('.header-nav')).toBeVisible()
  await expect(page.locator('button:has-text("Price Estimator")')).toBeVisible()
})

test('sign in with wrong password shows error message', async ({ page }) => {
  await page.goto('/')
  await page.fill('input[type="email"]', TEST_EMAIL)
  await page.fill('input[type="password"]', 'definitely-wrong')
  await page.click('button[type="submit"]')
  await expect(page.locator('.error')).toBeVisible()
  // App must not navigate away on bad credentials
  await expect(page.locator('.auth-card')).toBeVisible()
})

test('sign out returns to auth screen', async ({ page }) => {
  // Sign in via UI first using the dedicated auth-test user so that signing
  // out here does not revoke the session stored in e2e/.auth/user.json
  await page.goto('/')
  await page.fill('input[type="email"]', AUTH_TEST_EMAIL)
  await page.fill('input[type="password"]', AUTH_TEST_PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForSelector('.header-nav')

  await page.click('button.sign-out')
  await expect(page.locator('.auth-card')).toBeVisible()
  await expect(page.locator('.header-nav')).not.toBeVisible()
})
