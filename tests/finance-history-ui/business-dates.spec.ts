import { expect, test, type Page } from '@playwright/test'

const samples = [
  { at: '2026-10-31T23:59:59+07:00', date: '2026-10-31', start: '2026-10-01', end: '2026-11-01' },
  { at: '2026-11-01T00:00:00+07:00', date: '2026-11-01', start: '2026-11-01', end: '2026-11-02' },
  { at: '2026-11-01T06:59:59+07:00', date: '2026-11-01', start: '2026-11-01', end: '2026-11-02' },
  { at: '2026-11-01T07:00:00+07:00', date: '2026-11-01', start: '2026-11-01', end: '2026-11-02' },
  { at: '2027-01-01T00:00:00+07:00', date: '2027-01-01', start: '2027-01-01', end: '2027-01-02' },
]
const mutations = (page: Page) => page.evaluate(() => (window as any).financeState.bookMutations)
async function boot(page: Page, at: string) {
  await page.clock.setFixedTime(new Date(at))
  await page.goto('/tests/finance-history-ui/index.html?workspace=cashbook')
  await expect(page.locator('.receipt-voucher-list article')).toHaveCount(1)
}
async function fillReceipt(page: Page) {
  await page.getByRole('combobox', { name: 'Loại khoản thu', exact: true }).selectOption('other')
  await page.getByLabel('Người nộp tiền', { exact: true }).fill('Synthetic date fixture')
  await page.getByLabel('Nội dung thu', { exact: true }).fill('Business date boundary')
  await page.getByLabel('Số tiền', { exact: true }).fill('100000')
}

for (const timezoneId of ['Asia/Ho_Chi_Minh', 'UTC', 'America/Los_Angeles']) test.describe(timezoneId, () => {
  test.use({ timezoneId })
  for (const sample of samples) test(`cashbook defaults and receipt booking at ${sample.at}`, async ({ page }) => {
    await boot(page, sample.at)
    await page.getByRole('button', { name: 'Sổ S2e-HKD', exact: true }).click()
    await expect(page.getByLabel('Từ ngày', { exact: true })).toHaveValue(sample.start)
    await expect(page.getByLabel('Đến ngày', { exact: true })).toHaveValue(sample.date)
    await expect.poll(() => page.evaluate(() => (window as any).financeState.bookCalls.find((x: any) => x.name === 's2e')?.input)).toEqual({
      periodStart: `${sample.start}T00:00:00+07:00`, periodEnd: `${sample.end}T00:00:00+07:00`,
    })
    await expect(page.locator('.s2e-document-title')).toContainText(sample.date.split('-').reverse().join('/'))
    await page.getByRole('button', { name: 'Lập phiếu chi', exact: true }).click()
    await expect(page.getByLabel('Ngày hạch toán', { exact: true })).toHaveValue(sample.date)
    await page.getByRole('button', { name: 'Đóng', exact: true }).click()
    await page.getByRole('button', { name: 'Lập phiếu thu', exact: true }).click()
    await expect(page.getByLabel('Ngày hạch toán', { exact: true })).toHaveValue(sample.date)
    await fillReceipt(page)
    await page.getByRole('button', { name: 'Ghi sổ phiếu thu', exact: true }).click()
    await expect.poll(() => mutations(page)).toHaveLength(1)
    expect((await mutations(page))[0]).toMatchObject({ name: 'receipt', input: { effectiveAt: `${sample.date}T05:00:00.000Z`, amount: 100000 } })
  })

  test('new contract dates and payment plan use the current Vietnam day', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-01T01:00:00+07:00'))
    await page.goto('/tests/finance-history-ui/index.html?workspace=student&create=true')
    await page.getByRole('button', { name: 'Tạo hợp đồng', exact: true }).click()
    await page.getByRole('button', { name: 'Tạo hợp đồng độc lập', exact: true }).click()
    const form = page.locator('.student360-contract-form')
    await expect(form.getByLabel('Ngày bắt đầu', { exact: true })).toHaveValue('2026-11-01')
    await expect(form.getByLabel('Ngày kết thúc', { exact: true })).toHaveValue('2027-02-01')
    await form.getByRole('button', { name: 'Lưu hợp đồng', exact: true }).click()
    await expect(form).toHaveCount(0)
    const calls = await page.evaluate(() => (window as any).financeState.contractCreateCalls)
    expect(calls).toHaveLength(1)
    expect(calls[0].contract).toMatchObject({ startDate: '2026-11-01', endDate: '2027-02-01' })
    expect(calls[0].contract.installments.every((item: any) => item.date >= '2026-11-01' && item.date <= '2027-02-01')).toBe(true)
  })

  test('editing an early-morning expense keeps its displayed business date when saved', async ({ page }) => {
    await boot(page, '2026-11-01T12:00:00+07:00')
    await page.evaluate(() => {
      (window as any).financeState.bookPages.vouchers = [{ vouchers: [{
        id: 'draft-date', voucherNumber: 'PC-DATE', status: 'draft', revision: 1,
        accountId: 'cash-a', purposeCode: 'expense', purposeLabel: 'Synthetic expense',
        payeeName: 'Date fixture', description: 'Business date', amountBeforeTax: 100000,
        vatAmount: 0, totalAmount: 100000, effectiveAt: '2026-10-31T18:00:00.000Z',
        payeeAddress: '', invoiceNumber: '', originalDocumentCount: 0, attachmentUrls: [],
      }], paginationVersion: 1, hasMore: false, nextCursor: null, scanLimited: false, asOf: '2026-11-01T05:00:00Z' }]
    })
    await page.getByRole('button', { name: 'Phiếu chi', exact: true }).click()
    await expect(page.locator('.expense-voucher-list')).toContainText('01/11/2026')
    await page.getByRole('button', { name: 'Sửa', exact: true }).click()
    await expect(page.getByLabel('Ngày hạch toán', { exact: true })).toHaveValue('2026-11-01')
    for (let step = 0; step < 3; step++) await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click()
    await page.getByRole('button', { name: 'Lưu nháp', exact: true }).click()
    await expect.poll(() => mutations(page)).toHaveLength(1)
    expect((await mutations(page))[0]).toMatchObject({ name: 'expense', input: { voucherId: 'draft-date', effectiveAt: '2026-11-01T05:00:00.000Z' } })
  })

  test('opening after midnight refreshes defaults while an explicitly chosen date is preserved', async ({ page }) => {
    await boot(page, '2026-10-31T23:59:59+07:00')
    await page.clock.setFixedTime(new Date('2026-11-01T00:00:00+07:00'))
    await page.getByRole('button', { name: 'Lập phiếu thu', exact: true }).click()
    await expect(page.getByLabel('Ngày hạch toán', { exact: true })).toHaveValue('2026-11-01')
    await page.getByLabel('Ngày hạch toán', { exact: true }).fill('2026-10-20')
    await fillReceipt(page)
    await page.clock.setFixedTime(new Date('2026-11-02T00:00:00+07:00'))
    await page.getByRole('button', { name: 'Ghi sổ phiếu thu', exact: true }).click()
    await expect.poll(() => mutations(page)).toHaveLength(1)
    expect((await mutations(page))[0].input.effectiveAt).toBe('2026-10-20T05:00:00.000Z')
  })
})
