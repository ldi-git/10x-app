import { test, expect } from '@playwright/test'

// All tests in this file start signed in (storageState from setup.ts)

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('.header-nav')
  await page.click('button:has-text("Price Estimator")')
  await page.waitForSelector('.estimate-page')
})

// ---------------------------------------------------------------------------
// Address search
// ---------------------------------------------------------------------------

test('estimator shows address input and disabled Estimate button', async ({ page }) => {
  await expect(page.locator('input[placeholder="Enter address..."]')).toBeVisible()
  await expect(page.locator('.estimate-btn')).toBeDisabled()
})

test('typing fewer than 3 chars shows no suggestions', async ({ page }) => {
  await page.fill('input[placeholder="Enter address..."]', 'ab')
  await page.waitForTimeout(400) // past the 300ms debounce
  await expect(page.locator('.suggestions')).not.toBeVisible()
})

test('typing 3+ chars shows matching address suggestions', async ({ page }) => {
  await page.fill('input[placeholder="Enter address..."]', 'Birk')
  await expect(page.locator('.suggestions li')).toBeVisible({ timeout: 5000 })
})

test('address search is case-insensitive', async ({ page }) => {
  await page.fill('input[placeholder="Enter address..."]', 'birkerød')
  await expect(page.locator('.suggestions li')).toBeVisible({ timeout: 5000 })
})

test('selecting a suggestion fills the input and enables Estimate button', async ({ page }) => {
  await page.fill('input[placeholder="Enter address..."]', 'Birkerød')
  await page.locator('.suggestions li').first().waitFor({ timeout: 5000 })
  await page.locator('.suggestions li').first().click()

  // Input now shows the selected address
  await expect(page.locator('input[placeholder="Enter address..."]')).toHaveValue(/Birkerød/)
  // Estimate button is now enabled
  await expect(page.locator('.estimate-btn')).toBeEnabled()
})

test('clearing input below 3 chars hides suggestions', async ({ page }) => {
  await page.fill('input[placeholder="Enter address..."]', 'Birk')
  await expect(page.locator('.suggestions li')).toBeVisible({ timeout: 5000 })

  await page.fill('input[placeholder="Enter address..."]', 'Bi')
  await page.waitForTimeout(400)
  await expect(page.locator('.suggestions')).not.toBeVisible()
})

// ---------------------------------------------------------------------------
// Estimate golden path
// ---------------------------------------------------------------------------

async function selectAndEstimate(page: import('@playwright/test').Page) {
  await page.fill('input[placeholder="Enter address..."]', 'Birkerød')
  await page.locator('.suggestions li').first().waitFor({ timeout: 5000 })
  await page.locator('.suggestions li').first().click()

  const estimateResponse = page.waitForResponse('**/estimate**')
  await page.click('.estimate-btn')
  await estimateResponse
  await page.waitForSelector('.estimate-card')
}

test('running an estimate shows the result card', async ({ page }) => {
  await selectAndEstimate(page)
  await expect(page.locator('.estimate-card')).toBeVisible()
})

test('result card shows address, price, and basis', async ({ page }) => {
  await selectAndEstimate(page)
  await expect(page.locator('.estimate-address')).toContainText('Birkerød')
  await expect(page.locator('.estimate-price')).toContainText('kr')
  await expect(page.locator('.estimate-basis')).toContainText('sales')
})

test('estimated price is a positive formatted number', async ({ page }) => {
  await selectAndEstimate(page)
  const text = await page.locator('.estimate-price').textContent() ?? ''
  // Danish number format: "4.451.445 kr" — digits, possible dots/spaces, then kr
  expect(text.trim()).toMatch(/[\d.,\s]+kr/)
})

test('map renders for property with coordinates', async ({ page }) => {
  await selectAndEstimate(page)
  // Birkerød mock has lat/lng → PropertyMap renders a Leaflet container
  await expect(page.locator('.leaflet-container')).toBeVisible()
})

test('comparable sales table shows at least one row', async ({ page }) => {
  await selectAndEstimate(page)
  await expect(page.locator('.comp-table tbody tr').first()).toBeVisible()
})

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

test('history list shows the new entry after an estimate', async ({ page }) => {
  await selectAndEstimate(page)
  // EstimateHistory remounts after historyKey increment — wait for it to load
  await expect(page.locator('.history-row').first()).toBeVisible({ timeout: 6000 })
  await expect(page.locator('.history-address').first()).toContainText('Birkerød')
})
