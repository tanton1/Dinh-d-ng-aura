import { expect, test, type Page } from '@playwright/test'

const calls = (page: Page) => page.evaluate(() => (window as any).financeState.bookCalls)
const account = (page: Page) => page.getByRole('combobox', { name: 'Lọc theo tài khoản quỹ', exact: true })
const asOf = '2026-10-31T02:30:00.000Z'
const receipt = (index: number) => ({ id: `receipt-${index}`, voucherNumber: `PT-20261031-00${index}`, documentType: 'receipt_voucher',
  status: 'posted', totalAmount: 1250000 * index, payerName: ['Nguyễn An', 'Trần Minh', 'Lê Hà'][index - 1], accountId: 'cash-a',
  effectiveAt: asOf, description: 'Thanh toán gói tập cá nhân, kỳ tháng 10', paymentMethod: 'bank_transfer',
  amountInWords: 'Một triệu hai trăm năm mươi nghìn đồng', ledgerEntryId: `ledger-${index}`, journalEntryId: `journal-${index}`, cashTransactionId: `cash-${index}`,
  journalLines: [{ side: 'debit', accountCode: '1121', accountName: 'Tiền gửi ngân hàng', debit: 1250000 * index, credit: 0 },
    { side: 'credit', accountCode: '131', accountName: 'Phải thu khách hàng', debit: 0, credit: 1250000 * index }] })
const batch = (rows: any[]) => ({ vouchers: rows, paginationVersion: 1, hasMore: false, nextCursor: null, scanLimited: false, asOf })
async function boot(page: Page) {
  await page.goto('/tests/finance-history-ui/index.html?workspace=cashbook')
  await expect(page.locator('.receipt-voucher-list article')).toHaveCount(1)
}

test('receipt-first workspace keeps all three actions on one row and S2e last without hidden reads', async ({ page }, testInfo) => {
  await boot(page)
  await expect(page.locator('.cashbook-ledger-tabs button')).toHaveText(['Phiếu thu', 'Phiếu chi', 'Biến động quỹ', 'Sổ S2e-HKD'])
  await expect(page.getByRole('button', { name: 'Phiếu thu', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect((await calls(page)).map((row: any) => row.name)).toEqual(['receipts'])
  await expect(page.locator('.s2e-module')).toHaveCount(0)
  await page.clock.install()
  await page.clock.fastForward(60_000)
  expect((await calls(page)).map((row: any) => row.name)).toEqual(['receipts'])
  const actions = page.locator('.cashbook-create-actions button')
  await expect(actions).toHaveText(['Mở quỹ', 'Lập thu', 'Lập chi'])
  const boxes = await actions.evaluateAll(buttons => buttons.map(button => {
    const { x, y, width, height } = button.getBoundingClientRect(); return { x, y, width, height }
  }))
  expect(new Set(boxes.map(box => box.y)).size).toBe(1)
  expect(boxes.every(box => box.height >= 36 && box.height <= 40 && box.width >= 70)).toBe(true)
  expect(await page.locator('.cashbook-workspace').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)

  await page.evaluate(pages => {
    const state = (window as any).financeState
    state.cashAccounts[0].name = 'Quỹ trung tâm'
    state.cashAccounts[0].balance = 18750000
    state.bookPages.receipts = [pages]
  }, batch([receipt(1), receipt(2), receipt(3)]))
  await page.getByRole('button', { name: 'Tải lại', exact: true }).click()
  await expect(page.locator('.receipt-voucher-list article')).toHaveCount(3)
  await page.locator('.cashbook-workspace').screenshot({ path: `tmp/cashbook-compact/${testInfo.project.name}-receipts.png` })
  await page.getByRole('button', { name: 'Xem / In', exact: true }).first().click()
  const detail = page.getByRole('dialog', { name: 'Phiếu thu PT-20261031-001', exact: true })
  await expect(detail).toContainText('Nguyễn An')
  await expect(detail).toContainText('1.250.000đ')
  await expect(detail).toContainText('31/10/2026')
  await expect(detail).toContainText('Phải thu khách hàng')
  await expect(detail).toContainText('Chuyển khoản')
  await expect(detail).toContainText('ledger-1')
  await page.evaluate(() => { (window as any).printCount = 0; window.print = () => { (window as any).printCount++ } })
  await detail.getByRole('button', { name: 'In phiếu', exact: true }).click()
  expect(await page.evaluate(() => (window as any).printCount)).toBe(1)
  await page.locator('.receipt-voucher-document').screenshot({ path: `tmp/cashbook-compact/${testInfo.project.name}-receipt-detail.png` })
  await detail.getByRole('button', { name: 'Đóng', exact: true }).click()
  await page.getByRole('button', { name: 'Lập phiếu thu', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Ghi sổ phiếu thu', exact: true })).toBeVisible()
  await page.locator('.manual-receipt-form').screenshot({ path: `tmp/cashbook-compact/${testInfo.project.name}-receipt-form.png` })
  await page.getByRole('button', { name: 'Đóng', exact: true }).click()
  await page.setViewportSize({ width: 320, height: 740 })
  const narrowActions = await actions.evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().y))
  expect(new Set(narrowActions).size).toBe(1)
  expect(await page.locator('.cashbook-workspace').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
})

test('expense account filter resets pages and ignores late A to B to A results', async ({ page }) => {
  await boot(page)
  await account(page).selectOption('cash-a')
  await expect.poll(async () => (await calls(page)).length).toBe(2)
  await page.evaluate(pages => {
    const state = (window as any).financeState
    state.bookDefer = ['vouchers']
    state.bookPages.vouchers = pages
  }, [batch([{ ...receipt(1), documentType: 'expense_voucher', voucherNumber: 'OLD-A', payeeName: 'Old A' }]),
    batch([{ ...receipt(2), documentType: 'expense_voucher', voucherNumber: 'OLD-ALL', payeeName: 'Old all' }]),
    batch([{ ...receipt(3), documentType: 'expense_voucher', voucherNumber: 'CURRENT-A', payeeName: 'Current A' }])])
  await page.getByRole('button', { name: 'Phiếu chi', exact: true }).click()
  await expect.poll(async () => (await calls(page)).length).toBe(3)
  await account(page).selectOption('')
  await expect.poll(async () => (await calls(page)).length).toBe(4)
  await account(page).selectOption('cash-a')
  await expect.poll(async () => (await calls(page)).length).toBe(5)
  await page.evaluate(() => { const s = (window as any).financeState; s.bookPending[0].reject('permission-denied'); s.bookPending[1].resolve() })
  await expect(page.locator('.expense-voucher-list article')).toHaveCount(0)
  await page.evaluate(() => (window as any).financeState.bookPending[2].resolve())
  await expect(page.locator('.expense-voucher-list')).toContainText('CURRENT-A')
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect((await calls(page)).slice(2).map((row: any) => [row.name, row.input.accountId, row.input.cursor])).toEqual([
    ['vouchers', 'cash-a', undefined], ['vouchers', undefined, undefined], ['vouchers', 'cash-a', undefined],
  ])
  expect(await page.evaluate(() => (window as any).financeState.cashCalls.length)).toBe(1)
})

test('S2e uses the shared account scope with dates and print controls only when opened', async ({ page }) => {
  await boot(page)
  await account(page).selectOption('cash-a')
  await page.getByRole('button', { name: 'Sổ S2e-HKD', exact: true }).click()
  await expect(page.getByRole('article', { name: 'Mẫu S2e-HKD - Sổ chi tiết tiền' })).toBeVisible()
  await expect(page.locator('.cashbook-workspace select')).toHaveCount(1)
  await expect(page.getByLabel('Từ ngày', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'In / Lưu PDF', exact: true })).toBeEnabled()
  expect((await calls(page)).at(-1).input.accountId).toBe('cash-a')
  await page.getByRole('button', { name: 'Phiếu thu', exact: true }).click()
  await expect(page.locator('.s2e-module')).toHaveCount(0)
  expect((await calls(page)).map((row: any) => row.name)).toEqual(['receipts', 'receipts', 's2e', 'receipts'])
})
