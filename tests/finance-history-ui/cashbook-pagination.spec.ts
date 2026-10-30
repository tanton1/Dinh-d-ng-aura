import { expect, test, type Page } from '@playwright/test'

const asOf = '2026-10-26T00:00:00.000Z'
const tabs = { receipts: 'Phiếu thu', vouchers: 'Phiếu chi', cash: 'Biến động quỹ' }
const lists = { receipts: '.receipt-voucher-list', vouchers: '.expense-voucher-list', cash: '.cashbook-list' }
type Kind = keyof typeof tabs
function row(index: number, kind: Kind = 'receipts') {
  return { id: `row-${index}`, ledgerEntryId: `ledger-${index}`, listIdentity: `receipt_voucher:ledger-${index}`,
    voucherNumber: `TEST-${index}`, referenceCode: `TEST-${index}`, documentType: kind === 'vouchers' ? 'expense_voucher' : 'receipt_voucher',
    status: 'posted', derived: false, totalAmount: 100_000, amount: 100_000, revision: 1,
    payerName: 'Synthetic payer', payeeName: 'Synthetic payee', purposeLabel: 'Synthetic expense',
    accountId: 'cash-a', effectiveAt: asOf, journalLines: [] }
}
function batch(kind: Kind, start: number, count: number, nextCursor: string | null, extra = {}) {
  return { [kind === 'cash' ? 'transactions' : 'vouchers']: Array.from({ length: count }, (_, offset) => row(start + offset, kind)),
    paginationVersion: 1, hasMore: Boolean(nextCursor), nextCursor, scanLimited: false, asOf, ...extra }
}
const calls = (page: Page) => page.evaluate(() => (window as any).financeState.bookCalls)
async function queue(page: Page, kind: Kind, pages: any[]) {
  await page.evaluate(({ kind, pages }) => { (window as any).financeState.bookPages[kind] = pages }, { kind, pages })
}
async function boot(page: Page) {
  await page.goto('/tests/finance-history-ui/index.html?workspace=cashbook')
  await expect(page.locator('.receipt-voucher-list article')).toHaveCount(1)
  await page.getByRole('button', { name: 'Sổ S2e-HKD', exact: true }).click()
  await expect(page.getByRole('article', { name: 'Mẫu S2e-HKD - Sổ chi tiết tiền' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Lập phiếu thu', exact: true })).toBeEnabled()
}
async function open(page: Page, kind: Kind = 'receipts') {
  await page.getByRole('button', { name: tabs[kind], exact: true }).click()
  await expect(page.getByText('25 chứng từ đã tải.', { exact: true })).toBeVisible()
}

for (const kind of Object.keys(tabs) as Kind[]) {
  test(`${kind}: 25-row pages append only on request and stop at the exact end`, async ({ page }, testInfo) => {
    await boot(page)
    await queue(page, kind, [batch(kind, 0, 25, 'next-25'), batch(kind, 25, 25, 'next-50'), batch(kind, 50, 1, null)])
    await open(page, kind)
    await expect(page.locator(`${lists[kind]} article`)).toHaveCount(25)
    if (kind === 'receipts') {
      await page.getByRole('button', { name: 'Tải thêm', exact: true }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: `tmp/cashbook-pagination-validation/load-more-${testInfo.project.name}.png` })
    }
    await page.clock.install()
    await page.clock.fastForward(300_000)
    expect(await calls(page)).toHaveLength(3)
    await page.getByRole('button', { name: 'Tải thêm', exact: true }).click()
    await expect(page.locator(`${lists[kind]} article`)).toHaveCount(50)
    await page.getByRole('button', { name: 'Tải thêm', exact: true }).click()
    await expect(page.locator(`${lists[kind]} article`)).toHaveCount(51)
    await expect(page.getByRole('button', { name: 'Tải thêm', exact: true })).toHaveCount(0)
    const reads = await calls(page)
    expect(reads.map((read: any) => read.name)).toEqual(['receipts', 's2e', kind, kind, kind])
    expect(reads.slice(2).map((read: any) => [read.input.pageSize, read.input.cursor])).toEqual([[25, undefined], [25, 'next-25'], [25, 'next-50']])
    expect(await page.evaluate(() => (window as any).financeState.cashCalls.length)).toBe(1)
  })
}

test('double click has one append; a transient failure preserves rows and retries the same cursor', async ({ page }) => {
  await boot(page)
  await queue(page, 'receipts', [batch('receipts', 0, 25, 'next'), batch('receipts', 25, 25, null), batch('receipts', 25, 25, null)])
  await open(page)
  await page.evaluate(() => { (window as any).financeState.bookDefer = ['receipts'] })
  await page.getByRole('button', { name: 'Tải thêm', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  await expect.poll(() => calls(page)).toHaveLength(4)
  await expect(page.locator('.receipt-voucher-list article')).toHaveCount(25)
  await page.evaluate(() => (window as any).financeState.bookPending[0].reject('unavailable'))
  await page.getByRole('button', { name: 'Thử tải thêm', exact: true }).click()
  await expect.poll(() => calls(page)).toHaveLength(5)
  await page.evaluate(() => (window as any).financeState.bookPending[1].resolve())
  await expect(page.locator('.receipt-voucher-list article')).toHaveCount(50)
  expect((await calls(page)).slice(3).map((read: any) => read.input.cursor)).toEqual(['next', 'next'])
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('a sparse intermediate page is not reported as an empty book', async ({ page }) => {
  await boot(page)
  await queue(page, 'receipts', [batch('receipts', 0, 0, 'scan-next', { scanLimited: true }), batch('receipts', 700, 1, null)])
  await page.getByRole('button', { name: 'Phiếu thu', exact: true }).click()
  await expect(page.getByText('Chưa có chứng từ phù hợp trong phần đã tải. Tiếp tục tải thêm.', { exact: true })).toBeVisible()
  await expect(page.getByText('Chưa có phiếu thu trong quỹ đã chọn.', { exact: false })).toHaveCount(0)
  await page.getByRole('button', { name: 'Tải thêm', exact: true }).click()
  await expect(page.locator('.receipt-voucher-list')).toContainText('TEST-700')
  await expect(page.getByRole('button', { name: 'Tải thêm', exact: true })).toHaveCount(0)
})

test('overlapping receipt identities retain the original and never duplicate a legacy view', async ({ page }) => {
  await boot(page)
  const overlap = { ...row(24), id: 'derived-24', derived: true, voucherNumber: 'OLD-DERIVED' }
  const second = batch('receipts', 25, 1, null)
  second.vouchers = [overlap, row(25)]
  await queue(page, 'receipts', [batch('receipts', 0, 25, 'next'), second])
  await open(page)
  await page.getByRole('button', { name: 'Tải thêm', exact: true }).click()
  await expect(page.locator('.receipt-voucher-list article')).toHaveCount(26)
  await expect(page.locator('.receipt-voucher-list')).not.toContainText('OLD-DERIVED')
})

test('A to B to A rejects a late append and its permission error', async ({ page }) => {
  await boot(page)
  await queue(page, 'receipts', [batch('receipts', 0, 25, 'next'), batch('receipts', 25, 25, null), batch('receipts', 100, 1, null), batch('receipts', 200, 1, null)])
  await open(page)
  await page.evaluate(() => { (window as any).financeState.bookDefer = ['receipts'] })
  await page.getByRole('button', { name: 'Tải thêm', exact: true }).click()
  await expect.poll(() => calls(page)).toHaveLength(4)
  await page.getByRole('combobox', { name: 'Lọc theo tài khoản quỹ' }).selectOption('cash-a')
  await expect.poll(() => calls(page)).toHaveLength(5)
  await page.getByRole('combobox', { name: 'Lọc theo tài khoản quỹ' }).selectOption('')
  await expect.poll(() => calls(page)).toHaveLength(6)
  await page.evaluate(() => { const s = (window as any).financeState; s.bookPending[2].resolve(); s.bookPending[0].reject('permission-denied'); s.bookPending[1].resolve() })
  await expect(page.locator('.receipt-voucher-list article')).toHaveCount(1)
  await expect(page.locator('.receipt-voucher-list')).toContainText('TEST-200')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('current append denial clears rows, balances and private form drafts', async ({ page }) => {
  await boot(page)
  await queue(page, 'receipts', [batch('receipts', 0, 25, 'next')])
  await open(page)
  await page.getByRole('button', { name: 'Lập phiếu thu', exact: true }).click()
  await page.getByLabel('Người nộp tiền', { exact: true }).fill('Private append draft')
  await page.evaluate(() => { (window as any).financeState.bookFailures.receipts = 'permission-denied' })
  await page.getByRole('button', { name: 'Tải thêm', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Quyền xem sổ quỹ đã thay đổi')
  await expect(page.locator('.cashbook-summary')).toHaveCount(0)
  await expect(page.locator('.receipt-voucher-list')).toHaveCount(0)
  await page.getByRole('button', { name: 'Kiểm tra lại quyền', exact: true }).click()
  await expect(page.locator('.receipt-voucher-list article')).toHaveCount(1)
  await page.getByRole('button', { name: 'Lập phiếu thu', exact: true }).click()
  await expect(page.getByLabel('Người nộp tiền', { exact: true })).toHaveValue('')
})

test('changing owner fences a pending append', async ({ page }) => {
  await boot(page)
  await queue(page, 'receipts', [batch('receipts', 0, 25, 'next'), batch('receipts', 25, 25, null)])
  await open(page)
  await page.evaluate(() => { (window as any).financeState.bookDefer = ['receipts'] })
  await page.getByRole('button', { name: 'Tải thêm', exact: true }).click()
  await expect.poll(() => calls(page)).toHaveLength(4)
  await page.evaluate(() => { (window as any).financeState.bookDefer = [] })
  await page.getByRole('button', { name: 'Change account', exact: true }).click()
  await expect(page.locator('.receipt-voucher-list')).toContainText('admin-b')
  await page.evaluate(() => (window as any).financeState.bookPending[0].reject('permission-denied'))
  await expect(page.locator('.receipt-voucher-list article')).toHaveCount(1)
  await expect(page.locator('.cashbook-panel')).not.toContainText(/TEST-\d+/)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('an expired continuation keeps loaded rows and requires an explicit fresh read', async ({ page }) => {
  await boot(page)
  await queue(page, 'receipts', [batch('receipts', 0, 25, 'expired'), batch('receipts', 25, 1, null), batch('receipts', 900, 1, null)])
  await open(page)
  await page.evaluate(() => { (window as any).financeState.bookDefer = ['receipts'] })
  await page.getByRole('button', { name: 'Tải thêm', exact: true }).click()
  await expect.poll(() => calls(page)).toHaveLength(4)
  await page.evaluate(() => { const s = (window as any).financeState; s.bookDefer = []; s.bookPending[0].reject('failed-precondition', 'cashbook-cursor-expired') })
  await expect(page.locator('.receipt-voucher-list article')).toHaveCount(25)
  await page.getByRole('button', { name: 'Tải lại danh sách', exact: true }).click()
  await expect(page.locator('.receipt-voucher-list article')).toHaveCount(1)
  await expect(page.locator('.receipt-voucher-list')).toContainText('TEST-900')
  expect((await calls(page)).at(-1).input.cursor).toBeUndefined()
})

test('saving a receipt refreshes the snapshot once and fences an in-flight append', async ({ page }) => {
  await boot(page)
  await queue(page, 'receipts', [batch('receipts', 0, 25, 'next'), batch('receipts', 25, 25, null), batch('receipts', 500, 1, null, { asOf: '2026-10-26T00:01:00.000Z' })])
  await open(page)
  await page.evaluate(() => { (window as any).financeState.bookDefer = ['receipts'] })
  await page.getByRole('button', { name: 'Tải thêm', exact: true }).click()
  await expect.poll(() => calls(page)).toHaveLength(4)
  await page.getByRole('button', { name: 'Lập phiếu thu', exact: true }).click()
  await page.getByRole('combobox', { name: 'Loại khoản thu', exact: true }).selectOption('other')
  await page.getByLabel('Người nộp tiền', { exact: true }).fill('Synthetic payer')
  await page.getByLabel('Nội dung thu', { exact: true }).fill('Synthetic pagination fixture')
  await page.getByLabel('Số tiền', { exact: true }).fill('100000')
  await page.evaluate(() => { (window as any).financeState.bookDefer = [] })
  await page.getByRole('button', { name: 'Ghi sổ phiếu thu', exact: true }).click()
  await expect(page.locator('.receipt-voucher-list')).toContainText('TEST-500')
  await page.evaluate(() => (window as any).financeState.bookPending[0].resolve())
  await expect(page.locator('.receipt-voucher-list article')).toHaveCount(1)
  expect((await calls(page)).map((read: any) => read.name)).toEqual(['receipts', 's2e', 'receipts', 'receipts', 'catalog', 'receipts'])
  expect(await page.evaluate(() => (window as any).financeState.cashCalls.length)).toBe(2)
})

for (const [name, patch] of [
  ['changed snapshot', { asOf: '2026-10-26T00:01:00.000Z' }],
  ['repeated cursor', { hasMore: true, nextCursor: 'next' }],
  ['old protocol', { paginationVersion: 0 }],
] as const) {
  test(`${name} cannot append inconsistent rows or keep requesting the same page`, async ({ page }) => {
    await boot(page)
    await queue(page, 'receipts', [batch('receipts', 0, 25, 'next'), batch('receipts', 25, 25, null, patch)])
    await open(page)
    await page.getByRole('button', { name: 'Tải thêm', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Trang sổ quỹ không còn đồng nhất')
    await expect(page.locator('.receipt-voucher-list article')).toHaveCount(25)
    await expect(page.getByRole('button', { name: 'Tải lại danh sách', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Tải thêm', exact: true })).toHaveCount(0)
    expect(await calls(page)).toHaveLength(4)
  })
}
