import { expect, test, type Page } from '@playwright/test'

async function open(page: Page, query = '') {
  await page.addInitScript(() => { (window as any).availabilitySlots = ['T2-8', 'T3-8', 'T4-8', 'T5-8', 'T6-8'] })
  await page.clock.install({ time: new Date('2026-11-22T02:00:00Z') })
  await page.goto(`/tests/workspace-sync-ui/index.html?screen=availability${query}`)
  await page.clock.runFor(250)
  await expect(page.getByRole('button', { name: 'T2 8 giờ, đã chọn', exact: true })).toBeVisible()
}
const requestedWeeks = (page: Page) => page.evaluate(() => (window as any).workspaceCalls.map((call: any) => call.input.availabilityWeekId))

test('learners choose only between this week and next week', async ({ page }) => {
  await open(page)
  await expect(page.locator('.student-availability-week-switch button')).toHaveText(['Tuần này', 'Tuần sau'])
  expect(await requestedWeeks(page)).toEqual(['2026-11-23'])
})

test('a link to the week after next opens next week instead', async ({ page }) => {
  await open(page, '#/student-availability?week=2026-11-30')
  expect(await requestedWeeks(page)).toEqual(['2026-11-23'])
})
