import { expect, test, type Page } from '@playwright/test'
const calls = (page: Page) => page.evaluate(() => (window as any).costState.gpsCalls.length)

for (const action of ['Complete delivery', 'Change GPS account', 'Disable GPS', 'Stop GPS']) test(`GPS lifecycle: ${action} stops queued and late work`, async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-25T06:00:00Z') })
  await page.goto('/tests/data-cost-ui/index.html?view=gps')
  await page.evaluate(() => { (window as any).costState.gpsDelayed = true })
  await page.getByRole('button', { name: 'Start GPS', exact: true }).click()
  await page.evaluate(() => (window as any).gpsEmit())
  await expect.poll(() => calls(page)).toBe(1)
  await page.clock.runFor(16000)
  await page.evaluate(() => (window as any).gpsEmit(100))
  expect(await calls(page)).toBe(1)
  await page.getByRole('button', { name: action, exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).gpsWatchCount())).toBe(0)
  await page.evaluate(() => (window as any).costState.gpsPending.splice(0).forEach((finish: () => void) => finish()))
  await page.clock.runFor(120000)
  expect(await calls(page)).toBe(1)
  await expect(page.getByLabel('GPS state')).toHaveText('idle')
})

test('authoritative terminal or access errors stop the active watch', async ({ page }) => {
  await page.goto('/tests/data-cost-ui/index.html?view=gps')
  await page.evaluate(() => { (window as any).costState.gpsError = 'functions/failed-precondition' })
  await page.getByRole('button', { name: 'Start GPS', exact: true }).click()
  await page.evaluate(() => (window as any).gpsEmit())
  await expect(page.getByLabel('GPS state')).toHaveText('error')
  expect(await page.evaluate(() => (window as any).gpsWatchCount())).toBe(0)
})
