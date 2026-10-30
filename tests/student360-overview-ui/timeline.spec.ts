import { expect, test, type Page } from '@playwright/test'

const requests = (page: Page, count: number) => expect.poll(() => page.evaluate(() => (window as any).timelinePending.length)).toBe(count)
async function respond(page: Page, index: number, title: string, hasMore = false) {
  await page.evaluate(({ index, title, hasMore }) => (window as any).timelinePending[index].resolve({ rows: [{ id: title, title, description: title,
    type: 'contract', group: 'contract', metadata: {}, occurredAt: '2026-10-20T12:00:00Z', sortKey: 100 }], nextCursor: hasMore ? 99 : null, hasMore }), { index, title, hasMore })
}
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await page.goto('/tests/student360-overview-ui/index.html')
  await expect.poll(() => page.evaluate(() => (window as any).student360.pending.length)).toBe(1)
  await page.evaluate(() => (window as any).student360.resolve(0))
  await page.getByRole('button', { name: 'Nhật ký', exact: true }).click()
  await requests(page, 1)
})

test('changing a filter starts its request immediately and ignores the old response', async ({ page }) => {
  await page.getByRole('button', { name: 'Dinh dưỡng', exact: true }).click()
  await requests(page, 2)
  expect(await page.evaluate(() => (window as any).timelinePending[1].input.types)).toEqual(['nutrition'])
  await respond(page, 1, 'Current nutrition')
  await respond(page, 0, 'Retired contract')
  await expect(page.getByText('Current nutrition').first()).toBeVisible()
  await expect(page.getByText('Retired contract')).toHaveCount(0)
})

test('old errors cannot clear a newer filter loader or show in its results', async ({ page }) => {
  await page.getByRole('button', { name: 'Dinh dưỡng', exact: true }).click()
  await requests(page, 2)
  await page.evaluate(() => (window as any).timelinePending[0].reject(new Error('Retired failure')))
  await expect(page.getByText('Đang tải hoạt động…')).toBeVisible()
  await expect(page.getByText('Retired failure')).toHaveCount(0)
  await respond(page, 1, 'Current response')
  await expect(page.getByText('Current response').first()).toBeVisible()
})

test('append retains its time anchor and cannot cross filter scopes', async ({ page }) => {
  await respond(page, 0, 'First page', true)
  await page.getByRole('button', { name: 'Tải thêm hoạt động' }).click()
  await requests(page, 2)
  const inputs = await page.evaluate(() => (window as any).timelinePending.map((request: any) => request.input))
  expect(inputs[1].fromMillis).toBe(inputs[0].fromMillis)
  expect(inputs[1].cursor).toBe(99)
  await page.getByRole('button', { name: 'Dinh dưỡng', exact: true }).click()
  await requests(page, 3)
  await respond(page, 2, 'Nutrition page')
  await respond(page, 1, 'Old continuation')
  await expect(page.getByText('Old continuation')).toHaveCount(0)
  await expect(page.getByText('First page')).toHaveCount(0)
  await expect(page.getByText('Nutrition page').first()).toBeVisible()
})
