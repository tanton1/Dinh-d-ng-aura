import { expect, test, type Page } from '@playwright/test'

async function open(page: Page, options: Record<string, unknown> = {}, observer: 'controlled' | 'native' | 'missing' = 'controlled') {
  await page.addInitScript(({ options, observer }) => {
    ;(window as any).actionOptions = options
    if (observer === 'missing') { (window as any).IntersectionObserver = undefined; return }
    if (observer === 'native') return
    const watchers = new Set<any>()
    ;(window as any).IntersectionObserver = class {
      callback: any
      constructor(callback: any) { this.callback = callback }
      observe() { watchers.add(this) }
      disconnect() { watchers.delete(this) }
    }
    ;(window as any).revealActions = () => { for (const watcher of [...watchers]) watcher.callback([{ isIntersecting: true }]) }
  }, { options, observer })
  await page.goto('/tests/action-center-ui/index.html')
  await expect(page.getByRole('heading', { name: 'Tác vụ vận hành' })).toBeAttached()
}
const calls = (page: Page) => page.evaluate(() => (window as any).actionFixture.calls)
const reveal = (page: Page) => page.evaluate(() => (window as any).revealActions())
const panel = (page: Page) => page.getByRole('region', { name: 'Tác vụ vận hành' })
const finish = (page: Page, kind: string) => page.evaluate((kind) => {
  const fixture = (window as any).actionFixture
  const pending = fixture.pending.filter((item: any) => item.kind === kind)
  fixture.pending = fixture.pending.filter((item: any) => item.kind !== kind)
  pending.forEach((item: any) => item.finish())
}, kind)

test('offscreen action center reads nothing; visibility starts one page and authoritative totals once under StrictMode', async ({ page }) => {
  await open(page)
  expect(await calls(page)).toEqual([])
  await reveal(page)
  await expect(panel(page).getByText('9 việc')).toHaveCount(1)
  expect((await calls(page)).map((item: any) => item.kind)).toEqual(['list', 'summary'])
  await reveal(page)
  expect((await calls(page)).map((item: any) => item.kind)).toEqual(['list', 'summary'])
})

test('load more reads only one cursor page, deduplicates rows and keeps canonical totals', async ({ page }) => {
  await open(page)
  await reveal(page)
  await panel(page).getByRole('button', { name: 'Xem thêm tác vụ' }).click()
  await expect(panel(page).locator('article')).toHaveCount(8)
  expect((await calls(page)).map((item: any) => item.kind)).toEqual(['list', 'summary', 'list'])
  expect((await calls(page)).at(-1).input).toEqual({ pageSize: 5, cursor: 'page-2' })
  await expect(panel(page).getByText('9 việc')).toHaveCount(1)
})

test('explicit refresh activates the panel and duplicate clicks do not fan out reads', async ({ page }) => {
  await open(page, { defer: ['list', 'summary'] })
  await panel(page).getByRole('button', { name: 'Làm mới Action Center' }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); button.click() })
  await expect.poll(async () => (await calls(page)).length).toBe(2)
  await expect(panel(page).getByRole('button', { name: 'Làm mới Action Center' })).toBeDisabled()
  await finish(page, 'list'); await finish(page, 'summary')
  await expect(panel(page).getByText('9 việc')).toHaveCount(1)
  expect((await calls(page)).map((item: any) => item.kind)).toEqual(['list', 'summary'])
})

test('unmount and account switch ignore the previous account response and pending errors', async ({ page }) => {
  await open(page, { defer: ['list', 'summary'] })
  await reveal(page)
  await expect.poll(async () => (await calls(page)).length).toBe(2)
  await page.getByRole('button', { name: 'Account B' }).click()
  await page.evaluate(() => { (window as any).actionFixture.defer = [] })
  await reveal(page)
  await expect(panel(page).getByText('account-b Action 1', { exact: true })).toHaveCount(1)
  await page.evaluate(() => { const pending = (window as any).actionFixture.pending; pending.find((item: any) => item.kind === 'list').reject(new Error('old request')); pending.find((item: any) => item.kind === 'summary').finish() })
  await expect(panel(page).getByText('account-a Action 1', { exact: true })).toHaveCount(0)
  await expect(panel(page).getByRole('alert')).toHaveCount(0)
})

test('mutation reloads canonical list and all counters; a completion after unmount cannot trigger reads', async ({ page }) => {
  await open(page)
  await reveal(page)
  const first = panel(page).locator('article').first()
  await first.getByRole('button', { name: 'Nhận việc' }).click()
  await expect(first.getByRole('button', { name: 'Tạm hoãn 1 ngày' })).toBeVisible()
  expect((await calls(page)).map((item: any) => item.kind)).toEqual(['list', 'summary', 'claim', 'list', 'summary'])
  await first.getByRole('button', { name: 'Tạm hoãn 1 ngày' }).click()
  await expect(panel(page).getByText('8 việc')).toHaveCount(1)
  expect((await calls(page)).map((item: any) => item.kind)).toEqual(['list', 'summary', 'claim', 'list', 'summary', 'snooze', 'list', 'summary'])
  await page.evaluate(() => { (window as any).actionFixture.defer = ['claim'] })
  await panel(page).locator('article').first().getByRole('button', { name: 'Nhận việc' }).click()
  await page.getByRole('button', { name: 'Hide panel' }).click()
  const before = (await calls(page)).length
  await finish(page, 'claim')
  expect((await calls(page)).length).toBe(before)
})

test('a pending load-more page cannot append into a replacement account panel', async ({ page }) => {
  await open(page)
  await reveal(page)
  await expect(panel(page).locator('article')).toHaveCount(5)
  await page.evaluate(() => { (window as any).actionFixture.defer = ['list'] })
  await panel(page).getByRole('button', { name: 'Xem thêm tác vụ' }).click()
  await expect.poll(async () => (await calls(page)).length).toBe(3)
  await page.getByRole('button', { name: 'Account B' }).click()
  await page.evaluate(() => { (window as any).actionFixture.defer = [] })
  await reveal(page)
  await expect(panel(page).getByText('account-b Action 1', { exact: true })).toHaveCount(1)
  await finish(page, 'list')
  await expect(panel(page).locator('article')).toHaveCount(5)
  await expect(panel(page).getByText('account-a Action 6', { exact: true })).toHaveCount(0)
})

test('failed reads show unknown totals and a retry, never an empty-queue claim', async ({ page }) => {
  await open(page, { defer: ['list'] })
  await reveal(page)
  await expect.poll(async () => (await calls(page)).length).toBe(2)
  await page.evaluate(() => (window as any).actionFixture.pending[0].reject(new Error('read failed')))
  await expect(panel(page).getByRole('alert')).toHaveCount(1)
  await expect(panel(page).getByText('— việc')).toHaveCount(1)
  await expect(panel(page).getByText('Không có tác vụ đang mở')).toHaveCount(0)
  await page.evaluate(() => { (window as any).actionFixture.defer = [] })
  await panel(page).getByRole('button', { name: 'Làm mới Action Center' }).click()
  await expect(panel(page).getByText('9 việc')).toHaveCount(1)
  expect((await calls(page)).map((item: any) => item.kind)).toEqual(['list', 'summary', 'list', 'summary'])
})

test('native viewport and missing observer fallback both load without a separate permission click', async ({ page }) => {
  await open(page, {}, 'native')
  expect(await calls(page)).toEqual([])
  await panel(page).scrollIntoViewIfNeeded()
  await expect(panel(page).getByText('9 việc')).toBeVisible()
  expect((await calls(page)).length).toBe(2)
})

test('missing IntersectionObserver loads the panel with one pair of reads', async ({ page }) => {
  await open(page, {}, 'missing')
  await expect(panel(page).getByText('9 việc')).toHaveCount(1)
  expect((await calls(page)).map((item: any) => item.kind)).toEqual(['list', 'summary'])
})
