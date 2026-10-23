import { expect, test, type Page } from '@playwright/test'
import type { PreparedContractRenewal, RenewalPipelineResponse, RenewalPipelineRow } from '../../src/services/contractRenewalService'

declare global {
  interface Window {
    renewalQuoteRequests: Array<Record<string, unknown>>
    renewalApprovalRequests: Array<Record<string, unknown>>
    renewalApprovalStatus: string
    renewalSubmissions: Array<Record<string, unknown>>
    renewalTransportCalls: Array<{ region: string; name: string; input: { idempotencyKey?: string }; timeout?: number }>
    releaseRenewalQuote?: () => void
  }
}

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
const addDays = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
const row: RenewalPipelineRow = {
  id: 'source', caseId: 'source', sourceContractId: 'source', schemaVersion: 2,
  student: { id: 'student-1', name: 'Học viên nối tiếp', phone: '0900000000', email: '' },
  contract: { id: 'source', packageId: 'package-1', packageName: 'PT 12 buổi', startDate: addDays(-30), endDate: addDays(10), status: 'active', totalSessions: 12, usedSessions: 11, totalPrice: 3000000, paidAmount: 3000000, discount: 0, branchId: 'branch-1', trainerId: '', trainerIds: [], nutritionPTIds: [], revision: 2 },
  risk: { category: 'critical', daysLeft: 10, sessionsLeft: 1 }, branchId: 'branch-1', branchName: 'Aura',
  assignedSalesId: '', assignedSalesName: '', stage: 'uncontacted', probability: .1, expectedValue: 3000000,
  priorityScore: 100, slaDueAt: today, slaStatus: 'due_today', nextActionAt: null, nextFollowUpAt: null,
  lastContactAt: null, note: '', quoteId: null, approvalId: null, approvalStatus: null, renewedContractId: null,
  lostReason: null, revision: 1, caseRevision: 1, active: true,
}
const options: RenewalPipelineResponse['options'] = { packages: [{ id: 'package-1', name: 'PT 12 buổi', price: 3000000, totalSessions: 12, durationMonths: 3, branchId: 'branch-1' }], branches: [], cashAccounts: [], assignees: [] }

async function mockRenewals(page: Page, fixture: PreparedContractRenewal = { row, options, scope: 'system' }, behavior: { quoteFailures?: number; holdQuote?: boolean } = {}) {
  await page.addInitScript(({ fixture, behavior }) => {
    Object.assign(window, { renewalFixture: fixture, renewalSubmissions: [], renewalQuoteRequests: [], renewalApprovalRequests: [], renewalApprovalStatus: 'pending', renewalMockBehavior: behavior })
  }, { fixture, behavior })
  // Mock the service boundary in the isolated Vite fixture, without creating
  // a Firebase session or touching production financial data.
  await page.route('**/src/services/contractRenewalService.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    let revision = window.renewalFixture.row.revision;
    let quoteId = null;
    let approvalId = null;
    export const createRenewalQuote = async (input) => {
      window.renewalQuoteRequests.push(input);
      if (window.renewalMockBehavior.holdQuote) await new Promise(resolve => { window.releaseRenewalQuote = resolve; });
      if (window.renewalMockBehavior.quoteFailures > 0) {
        window.renewalMockBehavior.quoteFailures--;
        throw new Error('Không thể tạo báo giá. Vui lòng thử lại.');
      }
      quoteId = 'quote-' + window.renewalQuoteRequests.length;
      approvalId = null;
      return { quoteId, revision: ++revision };
    };
    export const getContractRenewalCaseDetail = async () => ({
      case: { ...window.renewalFixture.row, revision: revision + (window.renewalApprovalStatus === 'approved' ? 1 : 0) },
      quote: quoteId ? { id: quoteId } : null,
      approval: approvalId ? { id: approvalId, status: window.renewalApprovalStatus } : null,
    });
    export const submitRenewalApproval = async (input) => {
      window.renewalApprovalRequests.push(input);
      approvalId = 'approval';
      return { approvalId, status: 'pending', revision: ++revision };
    };
    export const prepareContractRenewal = async () => window.renewalFixture;
    export const renewPtContract = async (input) => { window.renewalSubmissions.push(input); return { contractId: 'next', unchanged: false }; };
  ` }))
}

for (const width of [390, 1440]) test(`renewal activation choices and projected carry-over remain clear at ${width}px`, async ({ page }, testInfo) => {
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
  await page.screenshot({ path: `test-results/${testInfo.project.name}-handover-${width}.png`, fullPage: true })
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

for (const width of [390, 1440]) test(`full-price renewal creates its quote on Continue and enables confirmation at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 844 })
  await mockRenewals(page, {
    row: { ...row, contract: { ...row.contract, packageName: 'Gói 3 Tháng', totalSessions: 36, usedSessions: 33, totalPrice: 9600000, paidAmount: 9600000 }, risk: { ...row.risk, sessionsLeft: 3 } },
    options: { ...options, packages: [{ ...options.packages[0], name: 'Gói 3 Tháng', totalSessions: 36, price: 9600000 }], cashAccounts: [{ id: 'bank-1', name: 'Tài khoản nhận chuyển khoản', type: 'bank', branchId: 'branch-1' }] },
    scope: 'system',
  })
  await page.goto('/tests/e2e/fixtures/contract-renewal.html')
  const dialog = page.getByRole('dialog', { name: 'Tạo hợp đồng tiếp theo' })
  const next = dialog.getByRole('button', { name: 'Tiếp tục', exact: true })
  await next.click()
  await next.click()
  await expect(dialog.getByRole('heading', { name: 'Thu tiền & công nợ' })).toBeVisible()
  expect(await page.evaluate(() => window.renewalQuoteRequests)).toEqual([{ caseId: 'source', packageId: 'package-1', expectedRevision: 1, discount: 0, carryOverSessions: 3 }])
  await dialog.getByLabel('Thu ngay', { exact: true }).fill('9600000')
  await expect(dialog.getByLabel('Tài khoản quỹ')).toHaveValue('bank-1')
  await next.click()
  await dialog.getByLabel('Ghi chú giao dịch').fill('Đồng ý')
  await expect(dialog.getByText('Trong chính sách', { exact: true })).toBeVisible()
  const confirm = dialog.getByRole('button', { name: 'Xác nhận tái ký', exact: true })
  await expect(confirm).toBeEnabled()
  expect(await page.evaluate(() => window.renewalSubmissions)).toEqual([])
  await page.screenshot({ path: `test-results/${testInfo.project.name}-confirmation-${width}.png`, fullPage: true })
  await confirm.evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  await expect.poll(() => page.evaluate(() => window.renewalSubmissions.length)).toBe(1)
  expect(await page.evaluate(() => window.renewalSubmissions[0])).toMatchObject({ quoteId: 'quote-1', expectedCaseRevision: 2, initialPayment: 9600000, cashAccountId: 'bank-1', installments: [], note: 'Đồng ý' })
  await expect(confirm).toBeDisabled()
})

test('failed quote creation stays on pricing and can be retried without duplicate requests', async ({ page }) => {
  await mockRenewals(page, undefined, { quoteFailures: 1, holdQuote: true })
  await page.goto('/tests/e2e/fixtures/contract-renewal.html')
  const dialog = page.getByRole('dialog', { name: 'Tạo hợp đồng tiếp theo' })
  const next = dialog.getByRole('button', { name: 'Tiếp tục', exact: true })
  await next.click()
  await next.evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  await expect.poll(() => page.evaluate(() => window.renewalQuoteRequests.length)).toBe(1)
  await expect(dialog.getByLabel('Giảm giá')).toBeDisabled()
  await expect(dialog.getByRole('button', { name: /Quay lại/ })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: /Lộ trình/ })).toBeDisabled()
  await page.evaluate(() => window.releaseRenewalQuote?.())
  await expect(dialog.getByRole('alert')).toContainText('Không thể tạo báo giá')
  await expect(dialog.getByRole('heading', { name: 'Báo giá & phê duyệt' })).toBeVisible()
  await next.click()
  await expect.poll(() => page.evaluate(() => window.renewalQuoteRequests.length)).toBe(2)
  await page.evaluate(() => window.releaseRenewalQuote?.())
  await expect(dialog.getByRole('heading', { name: 'Thu tiền & công nợ' })).toBeVisible()
  expect(await page.evaluate(() => window.renewalQuoteRequests.map(input => input.expectedRevision))).toEqual([1, 1])
  expect(await page.evaluate(() => window.renewalSubmissions)).toEqual([])
})

test('an exception stays on pricing until the manager approval is refreshed on Continue', async ({ page }) => {
  await mockRenewals(page, { row: { ...row, risk: { ...row.risk, sessionsLeft: 4 } }, options, scope: 'system' })
  await page.goto('/tests/e2e/fixtures/contract-renewal.html')
  const dialog = page.getByRole('dialog', { name: 'Tạo hợp đồng tiếp theo' })
  const next = dialog.getByRole('button', { name: 'Tiếp tục', exact: true })
  await next.click()
  await next.click()
  await expect(dialog.getByRole('heading', { name: 'Báo giá & phê duyệt' })).toBeVisible()
  await expect(dialog.getByRole('alert')).toContainText('quản lý phê duyệt')
  await dialog.getByRole('button', { name: 'Gửi quản lý duyệt' }).click()
  await expect(dialog.getByRole('button', { name: 'Đang chờ duyệt' })).toBeVisible()
  await next.click()
  await expect(dialog.getByRole('alert')).toContainText('đang chờ')
  await expect(dialog.getByRole('heading', { name: 'Báo giá & phê duyệt' })).toBeVisible()
  await page.evaluate(() => { window.renewalApprovalStatus = 'approved' })
  await next.click()
  await expect(dialog.getByRole('heading', { name: 'Thu tiền & công nợ' })).toBeVisible()
  await next.click()
  await expect(dialog.getByRole('button', { name: 'Xác nhận tái ký', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Xác nhận tái ký', exact: true }).click()
  expect(await page.evaluate(() => window.renewalQuoteRequests.length)).toBe(1)
  expect(await page.evaluate(() => window.renewalApprovalRequests.length)).toBe(1)
  expect(await page.evaluate(() => window.renewalSubmissions[0])).toMatchObject({ quoteId: 'quote-1', approvalId: 'approval', expectedCaseRevision: 4 })
})

test('editing commercial terms replaces the invalidated quote before confirmation', async ({ page }) => {
  await mockRenewals(page)
  await page.goto('/tests/e2e/fixtures/contract-renewal.html')
  const dialog = page.getByRole('dialog', { name: 'Tạo hợp đồng tiếp theo' })
  const next = dialog.getByRole('button', { name: 'Tiếp tục', exact: true })
  await next.click()
  await dialog.getByRole('button', { name: 'Tạo báo giá', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Đã tạo', exact: true })).toBeVisible()
  await next.click()
  await dialog.getByRole('button', { name: /Lộ trình/ }).click()
  await dialog.getByRole('checkbox', { name: /Dự kiến chuyển/ }).uncheck()
  await next.click()
  await dialog.getByLabel('Giảm giá').fill('300000')
  await next.click()
  await expect(dialog.getByRole('heading', { name: 'Thu tiền & công nợ' })).toBeVisible()
  await next.click()
  await dialog.getByRole('button', { name: 'Xác nhận tái ký', exact: true }).click()
  expect(await page.evaluate(() => window.renewalQuoteRequests)).toEqual([
    { caseId: 'source', packageId: 'package-1', expectedRevision: 1, discount: 0, carryOverSessions: 1 },
    { caseId: 'source', packageId: 'package-1', expectedRevision: 2, discount: 300000, carryOverSessions: 0 },
  ])
  expect(await page.evaluate(() => window.renewalSubmissions[0])).toMatchObject({ quoteId: 'quote-2', expectedCaseRevision: 3, carryOver: false, discount: 300000 })
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

test('real renewal service routes confirmation only to Taiwan and preserves the retry identity after a lost response', async ({ page }) => {
  await page.addInitScript((fixture) => {
    Object.assign(window, { renewalFixture: fixture, renewalTransportCalls: [] })
  }, { row, options, scope: 'system' })
  // Keep the real service and wizard, mocking only Firebase transport. No
  // production identity, endpoint or financial data is used by this test.
  await page.route('**/src/lib/firebaseFunctions.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const firebaseFunctions = { region: 'asia-southeast1' };
    export const firebaseStudent360Functions = { region: 'asia-east1' };
    export const firebaseNutritionFunctions = firebaseFunctions;
    export const firebaseScheduleOptimizerFunctions = firebaseStudent360Functions;
    export const firebaseSchedulePublishFunctions = firebaseStudent360Functions;
    export const firebaseStudentManagementFunctions = firebaseStudent360Functions;
    export const firebaseAcademyFunctions = firebaseStudent360Functions;
    export const firebaseBusinessReportingFunctions = firebaseStudent360Functions;
    export const firebaseTelemetryFunctions = firebaseStudent360Functions;
    export const firebaseRegionalReadFunctions = firebaseFunctions;
  ` }))
  await page.route('**/src/services/readOnlyCallableService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const callReadOnlyFunction = async () => { throw new Error('Unexpected read'); };
    export const runReadOnlyWithFallback = async primary => primary();
  ` }))
  await page.route('**/node_modules/.vite/deps/firebase_functions.js*', route => route.fulfill({ contentType: 'application/javascript', body: `
    let failConfirmation = true;
    export const getFunctions = (_app, region) => ({ region });
    export const connectFunctionsEmulator = () => {};
    export const httpsCallable = (client, name, options) => async input => {
      window.renewalTransportCalls.push({ region: client.region, name, input, timeout: options?.timeout });
      if (name === 'createRenewalQuote') return { data: { quoteId: 'transport-quote', revision: 2 } };
      if (name === 'renewPtContractRegional') {
        if (failConfirmation) {
          failConfirmation = false;
          throw Object.assign(new Error('Response unavailable'), { code: 'functions/unavailable' });
        }
        return { data: { contractId: 'next', paymentEntryId: null, unchanged: true } };
      }
      throw new Error('Unexpected callable: ' + name);
    };
  ` }))
  await page.goto('/tests/e2e/fixtures/contract-renewal.html')
  const dialog = page.getByRole('dialog', { name: 'Tạo hợp đồng tiếp theo' })
  const next = dialog.getByRole('button', { name: 'Tiếp tục', exact: true })
  await next.click()
  await next.click()
  await next.click()
  const confirm = dialog.getByRole('button', { name: 'Xác nhận tái ký', exact: true })
  await confirm.click()
  await expect(dialog.getByRole('alert')).toContainText('Chưa xác nhận được kết quả tái ký')
  const firstCalls = await page.evaluate(() => window.renewalTransportCalls)
  expect(firstCalls.map(call => [call.region, call.name])).toEqual([
    ['asia-southeast1', 'createRenewalQuote'], ['asia-east1', 'renewPtContractRegional'],
  ])
  expect(firstCalls[1].timeout).toBe(120000)
  await confirm.click()
  await expect(confirm).toBeDisabled()
  const calls = await page.evaluate(() => window.renewalTransportCalls)
  expect(calls).toHaveLength(3)
  expect(calls[2].region).toBe('asia-east1')
  expect(calls[2].name).toBe('renewPtContractRegional')
  expect(calls[2].input.idempotencyKey).toBeTruthy()
  expect(calls[2].input).toEqual(calls[1].input)
})
