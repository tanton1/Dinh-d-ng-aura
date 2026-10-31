import { expect, test } from '@playwright/test'

async function openCreate(page: import('@playwright/test').Page) {
  await page.goto('/tests/finance-history-ui/index.html?workspace=student&create=true')
  await page.getByRole('button', { name: 'Tạo hợp đồng', exact: true }).click()
  await page.getByRole('button', { name: 'Tạo hợp đồng độc lập', exact: true }).click()
  const form = page.locator('.student360-contract-form')
  await form.getByLabel('Ngày bắt đầu', { exact: true }).fill('2027-01-01')
  await form.getByLabel('Ngày kết thúc', { exact: true }).fill('2027-04-01')
  return form
}

test('new contract collects upfront and sends only the unequal remaining debt, preserving custom amounts after a price change', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 844 })
  const form = await openCreate(page)
  expect(await page.evaluate(() => (window as any).financeState.cashCalls.length)).toBe(0)
  await form.getByLabel('Số tiền trả trước', { exact: true }).fill('300000')
  await expect(form.getByLabel('Quỹ nhận tiền', { exact: true })).toHaveValue('cash-a')
  await form.getByLabel('Số kỳ trả góp', { exact: true }).selectOption('3')
  await form.getByRole('button', { name: 'Chia đều', exact: true }).click()
  await form.getByLabel('Số tiền kỳ 1', { exact: true }).fill('200000')
  await form.getByLabel('Số tiền kỳ 2', { exact: true }).fill('200000')
  await form.getByLabel('Số tiền kỳ 3', { exact: true }).fill('500000')
  await form.getByLabel('Giảm giá', { exact: true }).fill('100000')
  await expect(form.getByLabel('Số tiền kỳ 1', { exact: true })).toHaveValue('200000')
  await expect(form.getByText(/Vượt 100.000đ/)).toBeVisible()
  await form.getByRole('button', { name: 'Lưu hợp đồng', exact: true }).click()
  expect(await page.evaluate(() => (window as any).financeState.contractCreateCalls.length)).toBe(0)
  await form.getByLabel('Số tiền kỳ 3', { exact: true }).fill('400000')
  await expect(form.locator('.contract-payment-plan__error')).toHaveCount(0)
  await page.screenshot({ path: `test-results/${testInfo.project.name}-contract-payment-plan.png`, fullPage: true })
  expect(await form.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  for (const input of await form.locator('input[type="date"]').all()) expect(await input.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  await form.getByRole('button', { name: 'Lưu hợp đồng', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  await expect(form).toHaveCount(0)
  const calls = await page.evaluate(() => (window as any).financeState.contractCreateCalls)
  expect(calls).toHaveLength(1)
  expect(calls[0].initialPayment).toEqual({ amount: 300000, cashAccountId: 'cash-a', paymentMethod: 'transfer' })
  expect(calls[0].contract.installments.map((item: any) => item.amount)).toEqual([200000, 200000, 400000])
  await expect(page.getByText(/Đã tạo phiếu thu PT-TEST-001/)).toBeVisible()
})

test('upfront payment survives a lost response and reload without a second contract or changed collection', async ({ page }) => {
  const form = await openCreate(page)
  await form.getByLabel('Số tiền trả trước', { exact: true }).fill('300000')
  await expect(form.getByLabel('Quỹ nhận tiền', { exact: true })).toHaveValue('cash-a')
  await page.evaluate(() => { (window as any).financeState.contractCreateFailure = 'commit-lost' })
  await form.getByRole('button', { name: 'Lưu hợp đồng', exact: true }).click()
  await expect(form.getByLabel('Số tiền trả trước', { exact: true })).toBeDisabled()
  const original = await page.evaluate(() => (window as any).financeState.contractCreateCalls[0])
  await page.reload()
  await page.getByRole('button', { name: 'Kiểm tra hợp đồng đã gửi', exact: true }).click()
  await expect(form.getByLabel('Số tiền trả trước', { exact: true })).toHaveValue('300000')
  await expect(form.getByLabel('Số tiền trả trước', { exact: true })).toBeDisabled()
  await form.getByRole('button', { name: 'Kiểm tra / tạo lại hợp đồng', exact: true }).click()
  await expect(form).toHaveCount(0)
  const state = await page.evaluate(() => ({ calls: (window as any).financeState.contractCreateCalls, created: (window as any).financeState.createdContracts }))
  expect(state.calls).toEqual([original])
  expect(state.created).toHaveLength(1)
})

test('fully paid creation has no installments and a cash read failure can be retried before saving', async ({ page }) => {
  const form = await openCreate(page)
  await page.evaluate(() => { (window as any).financeState.cashFailure = 'unavailable' })
  await form.getByLabel('Số tiền trả trước', { exact: true }).fill('1200000')
  await form.getByRole('button', { name: 'Tải lại quỹ', exact: true }).click()
  await expect(form.getByLabel('Quỹ nhận tiền', { exact: true })).toHaveValue('cash-a')
  await expect(form.locator('.contract-payment-plan > header')).toContainText('Còn phải thu 0đ')
  await expect(form.locator('.contract-payment-plan__row')).toHaveCount(0)
  await form.getByRole('button', { name: 'Lưu hợp đồng', exact: true }).click()
  await expect(form).toHaveCount(0)
  const command = await page.evaluate(() => (window as any).financeState.contractCreateCalls[0])
  expect(command.initialPayment.amount).toBe(1200000)
  expect(command.contract.installments).toEqual([])
})

test('payment plan action edits only unpaid periods without resending contract or trainer terms', async ({ page }) => {
  await page.goto('/tests/finance-history-ui/index.html?workspace=student&editPlan=true')
  await page.getByRole('button', { name: 'Chỉnh lịch thanh toán', exact: true }).click()
  const form = page.locator('.student360-contract-form')
  await expect(form.getByRole('heading', { name: 'Chỉnh lịch thanh toán', exact: true })).toBeVisible()
  await expect(form.getByLabel('Gói tập', { exact: true })).toHaveCount(0)
  await expect(form.getByLabel('Số tiền kỳ 1', { exact: true })).toBeDisabled()
  await expect(form.getByRole('button', { name: 'Xóa kỳ 1', exact: true })).toHaveCount(0)
  await form.getByLabel('Số tiền kỳ 2', { exact: true }).fill('400000')
  await form.getByRole('button', { name: 'Thêm kỳ thanh toán', exact: true }).click()
  await expect(form.getByLabel('Số tiền kỳ 3', { exact: true })).toHaveValue('500000')
  await form.getByRole('button', { name: 'Lưu lịch thanh toán', exact: true }).click()
  await expect(form).toHaveCount(0)
  const command = await page.evaluate(() => (window as any).financeState.contractPlanEdits[0])
  expect(command.action).toBe('edit_payment_plan')
  expect(command.contract).toBeUndefined()
  expect(command.installments.map((item: any) => [item.amount, item.status])).toEqual([[300000, 'paid'], [400000, 'pending'], [500000, 'pending']])
})

test('lost create response freezes the original draft and retries stable ID without a second contract', async ({ page }) => {
  await page.goto('/tests/finance-history-ui/index.html?workspace=student&create=true')
  await page.getByRole('button', { name: 'Tạo hợp đồng', exact: true }).click()
  await page.getByRole('button', { name: 'Tạo hợp đồng độc lập', exact: true }).click()
  const form = page.locator('.student360-contract-form')
  await form.getByLabel('Ngày bắt đầu', { exact: true }).fill('2027-01-01')
  await form.getByLabel('Ngày kết thúc', { exact: true }).fill('2027-04-01')
  await form.getByRole('textbox', { name: 'Ghi chú', exact: true }).fill('Thỏa thuận gốc')
  await page.evaluate(() => { (window as any).financeState.contractCreateFailure = 'commit-lost' })
  await form.getByRole('button', { name: 'Lưu hợp đồng', exact: true }).click()
  await expect(form.getByText('Yêu cầu tạo hợp đồng chưa rõ kết quả. Thông tin gốc được giữ nguyên khi kiểm tra lại.')).toBeVisible()
  await expect(form.getByRole('textbox', { name: 'Ghi chú', exact: true })).toBeDisabled()
  await form.getByRole('button', { name: 'Hủy', exact: true }).click()
  await page.getByRole('button', { name: 'Tạo hợp đồng', exact: true }).click()
  await expect(form.getByRole('textbox', { name: 'Ghi chú', exact: true })).toHaveValue('Thỏa thuận gốc')
  await form.getByRole('button', { name: 'Kiểm tra / tạo lại hợp đồng', exact: true }).click()
  await expect(form).toHaveCount(0)
  const state = await page.evaluate(() => { const s = (window as any).financeState; return { calls: s.contractCreateCalls, created: s.createdContracts } })
  expect(state.created).toHaveLength(1)
  expect(state.calls).toHaveLength(2)
  expect(state.calls[0]).toEqual(state.calls[1])
  expect(state.calls[0].contractId).toBeTruthy()
  await page.getByRole('button', { name: 'Tạo hợp đồng', exact: true }).click()
  await page.getByRole('button', { name: 'Tạo hợp đồng độc lập', exact: true }).click()
  await form.getByRole('button', { name: 'Lưu hợp đồng', exact: true }).click()
  await expect(form).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).financeState.contractCreateCalls[2].contractId)).not.toBe(state.calls[0].contractId)
})

test('student contract opens admin OFF for the selected contract and resets on account changes', async ({ page }) => {
  await page.route('**/src/services/sessionOperationsService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    window.adminOffContractIds = [];
    export const getStudentOffContext = async contractId => { window.adminOffContractIds.push(contractId); return { contractId, contractRevision: 1, studentName: 'Test learner A', packageName: 'Test package A', startDate: '2026-10-01', endDate: '2026-12-31', maxOffEndDate: '2026-12-31', now: '2026-10-23T00:00:00Z', today: '2026-10-23', policy: { maxDays: 14, cutoffHour: 9, offLimit: 2, offUsed: 0 }, request: null }; };
    export const saveStudentOff = async () => ({});
  ` }));
  await page.goto('/tests/finance-history-ui/index.html?workspace=student');
  await page.getByRole('button', { name: 'Tạo OFF', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Tạo OFF', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Test learner A');
  const ids = await page.evaluate(() => (window as any).adminOffContractIds as string[]);
  expect(ids.length).toBeGreaterThan(0);
  expect(ids.every(id => id === 'contract-a')).toBe(true);
  await page.getByRole('button', { name: 'Change account' }).evaluate((el: HTMLButtonElement) => el.click());
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
