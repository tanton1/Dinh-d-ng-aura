import { expect, test, type Page } from '@playwright/test'

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
const addDays = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
const row = {
  id: 'source', caseId: 'source', sourceContractId: 'source', schemaVersion: 2,
  student: { id: 'student-1', name: 'Học viên nối tiếp', phone: '0900000000', email: '' },
  contract: { id: 'source', packageId: 'package-1', packageName: 'PT 12 buổi', startDate: addDays(-30), endDate: addDays(10), status: 'active', totalSessions: 12, usedSessions: 11, totalPrice: 3000000, paidAmount: 3000000, discount: 0, branchId: 'branch-1', trainerId: '', trainerIds: [], nutritionPTIds: [], revision: 2 },
  risk: { category: 'critical', daysLeft: 10, sessionsLeft: 1 }, branchId: 'branch-1', branchName: 'Aura',
  assignedSalesId: '', assignedSalesName: '', stage: 'uncontacted', probability: .1, expectedValue: 3000000,
  priorityScore: 100, slaDueAt: today, slaStatus: 'due_today', nextActionAt: null, nextFollowUpAt: null,
  lastContactAt: null, note: '', quoteId: null, approvalId: null, approvalStatus: null, renewedContractId: null,
  lostReason: null, revision: 1, caseRevision: 1, active: true,
}
const options = { packages: [{ id: 'package-1', name: 'PT 12 buổi', price: 3000000, totalSessions: 12, durationMonths: 3, branchId: 'branch-1' }], branches: [], cashAccounts: [], assignees: [] }

async function mockRenewals(page: Page) {
  await page.addInitScript((fixture) => { Object.assign(window, { renewalFixture: fixture, renewalSubmissions: [] }) }, { row, options, scope: 'system' })
  // Mock the service boundary in the isolated Vite fixture, without creating
  // a Firebase session or touching production financial data.
  await page.route('**/src/services/contractRenewalService.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    export const createRenewalQuote = async () => ({ quoteId: 'quote', revision: 2 });
    export const getContractRenewalCaseDetail = async () => ({ case: window.renewalFixture.row });
    export const submitRenewalApproval = async () => ({ approvalId: 'approval', status: 'approved', revision: 3 });
    export const prepareContractRenewal = async () => window.renewalFixture;
    export const renewPtContract = async (input) => { window.renewalSubmissions.push(input); return { contractId: 'next', unchanged: false }; };
  ` }))
}

for (const width of [390, 1440]) test(`renewal activation choices and projected carry-over remain clear at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  await mockRenewals(page)
  await page.goto('/tests/e2e/fixtures/contract-renewal.html')
  const dialog = page.getByRole('dialog', { name: 'Tạo hợp đồng tiếp theo' })
  await expect(dialog).toBeVisible()
  expect(await dialog.locator('.renewal-source-card').evaluate((card) => card.scrollHeight <= card.clientHeight + 1)).toBe(true)
  await expect(dialog.getByRole('radio', { name: /Nối tiếp tự động/ })).toBeChecked()
  const start = dialog.getByLabel('Ngày bắt đầu dự kiến')
  await expect(start).toHaveValue(addDays(11))
  await expect(start).toHaveAttribute('readonly', '')
  await expect(dialog.getByText('Dự kiến chuyển tối đa 1 buổi chưa dùng')).toBeVisible()
  await dialog.getByRole('radio', { name: /Bắt đầu ngày cố định/ }).check()
  await expect(start).not.toHaveAttribute('readonly')
  await start.fill(addDays(15))
  await expect(dialog.getByText(/Nếu hết buổi trước đó/)).toBeVisible()
  await page.screenshot({ path: `test-results/renewal-handover-${width}.png`, fullPage: true })
  await dialog.getByRole('button', { name: 'Tiếp tục', exact: true }).click()
  await dialog.getByRole('button', { name: 'Tạo báo giá', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Đã tạo', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Tiếp tục', exact: true }).click()
  await dialog.getByRole('button', { name: 'Tiếp tục', exact: true }).click()
  expect(await page.evaluate(() => (window as unknown as { renewalSubmissions: unknown[] }).renewalSubmissions.length)).toBe(0)
  await dialog.getByRole('button', { name: 'Xác nhận tái ký', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { renewalSubmissions: unknown[] }).renewalSubmissions.length)).toBe(1)
  const submitted = await page.evaluate(() => (window as unknown as { renewalSubmissions: unknown[] }).renewalSubmissions)
  expect(submitted[0]).toMatchObject({ activationMode: 'fixed_date', startDate: addDays(15), sourceContractId: 'source', carryOver: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('Student 360 suggests a linked continuation before opening an independent contract form', async ({ page }) => {
  await mockRenewals(page)
  await page.goto('/tests/e2e/fixtures/contract-renewal.html?workspace=1')
  await page.getByRole('button', { name: 'Tạo hợp đồng', exact: true }).click()
  const choice = page.getByRole('dialog', { name: 'Tạo hợp đồng nối tiếp' })
  await expect(choice).toBeVisible()
  await expect(choice.getByText(/Hợp đồng nguồn/)).toBeVisible()
  await expect(choice.getByRole('button', { name: 'Tiếp tục nối tiếp' })).toBeVisible()
  await choice.getByRole('button', { name: 'Tạo hợp đồng độc lập' }).click()
  await expect(page.getByRole('heading', { name: 'Tạo hợp đồng mới' })).toBeVisible()
})
