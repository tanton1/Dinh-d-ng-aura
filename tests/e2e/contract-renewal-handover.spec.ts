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
    renewalQueueFixture: any
    unmountRenewalQueue: () => void
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

test('renewal accepts custom installment amounts after upfront collection and keeps them when the upfront amount changes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockRenewals(page, { row, scope: 'system', options: { ...options, cashAccounts: [{ id: 'bank-1', name: 'Quỹ chi nhánh', branchId: 'branch-1', type: 'bank' }] } })
  await page.goto('/tests/e2e/fixtures/contract-renewal.html')
  const dialog = page.getByRole('dialog', { name: 'Tạo hợp đồng tiếp theo' })
  const next = dialog.getByRole('button', { name: 'Tiếp tục', exact: true })
  await next.click(); await next.click()
  await dialog.getByLabel('Số tiền trả trước', { exact: true }).fill('1000000')
  await dialog.getByLabel('Số kỳ trả góp', { exact: true }).selectOption('2')
  await dialog.getByRole('button', { name: 'Chia đều', exact: true }).click()
  await dialog.getByLabel('Số tiền kỳ 1', { exact: true }).fill('500000')
  await dialog.getByLabel('Số tiền kỳ 2', { exact: true }).fill('1500000')
  await dialog.getByLabel('Số tiền trả trước', { exact: true }).fill('1200000')
  await expect(dialog.getByLabel('Số tiền kỳ 1', { exact: true })).toHaveValue('500000')
  await expect(dialog.getByText(/Vượt 200.000đ/)).toBeVisible()
  await next.click()
  await expect(dialog.getByRole('heading', { name: 'Thu tiền & công nợ', exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.renewalSubmissions)).toEqual([])
  await dialog.getByLabel('Số tiền kỳ 2', { exact: true }).fill('1300000')
  await page.screenshot({ path: `test-results/${testInfo.project.name}-renewal-custom-payments.png`, fullPage: true })
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  await next.click()
  await dialog.getByRole('button', { name: 'Xác nhận tái ký', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.renewalSubmissions.length)).toBe(1)
  const command = await page.evaluate(() => window.renewalSubmissions[0])
  expect(command.initialPayment).toBe(1200000)
  expect((command.installments as any[]).map(item => item.amount)).toEqual([500000, 1300000])
})

async function mockRenewals(page: Page, fixture: PreparedContractRenewal = { row, options, scope: 'system' }, behavior: { quoteFailures?: number; holdQuote?: boolean; confirmationFailures?: number; committedAfterFailure?: boolean; reconciliationFails?: boolean } = {}) {
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
    export const getContractRenewalCaseDetail = async () => {
      if (window.renewalMockBehavior.reconciliationFails) throw new Error('Không thể đọc kết quả giao dịch.');
      return ({
      case: { ...window.renewalFixture.row, renewedContractId: window.renewalMockBehavior.committedAfterFailure ? 'already-created' : null, revision: revision + (window.renewalApprovalStatus === 'approved' ? 1 : 0) },
      quote: quoteId ? { id: quoteId } : null,
      approval: approvalId ? { id: approvalId, status: window.renewalApprovalStatus } : null,
    }); };
    export const submitRenewalApproval = async (input) => {
      window.renewalApprovalRequests.push(input);
      approvalId = 'approval';
      return { approvalId, status: 'pending', revision: ++revision };
    };
    export const prepareContractRenewal = async () => window.renewalFixture;
    export const renewPtContract = async (input) => {
      window.renewalSubmissions.push(input);
      if (window.renewalMockBehavior.confirmationFailures > 0) {
        window.renewalMockBehavior.confirmationFailures--;
        throw Object.assign(new Error('Chưa xác nhận được kết quả tái ký.'), { code: 'functions/unavailable' });
      }
      return { contractId: 'next', unchanged: false };
    };
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
  await dialog.getByLabel('Số tiền trả trước', { exact: true }).fill('9600000')
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
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await mockRenewals(page)
  // The isolated workspace now fences asynchronous responses by its auth
  // context. Supply a demo owner without opening a real Firebase session.
  await page.route('**/src/contexts/AuthContext.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const useAuth = () => ({
      user: { uid: 'renewal-demo-admin' }, profile: { uid: 'renewal-demo-admin', role: 'admin', authzVersion: 1 },
      authzReady: true, backendMode: 'demo', hasCapability: () => true,
    });
  ` }))
  await page.goto('/tests/e2e/fixtures/contract-renewal.html?workspace=1')
  await page.getByRole('button', { name: 'Tạo hợp đồng', exact: true }).click()
  const choice = page.getByRole('dialog', { name: 'Tạo hợp đồng nối tiếp' })
  await expect(choice).toBeVisible()
  await expect(choice.getByText(/Hợp đồng nguồn/)).toBeVisible()
  await expect(choice.getByRole('button', { name: 'Tiếp tục nối tiếp' })).toBeVisible()
  await choice.getByRole('button', { name: 'Tạo hợp đồng độc lập' }).click()
  await expect(page.getByRole('heading', { name: 'Tạo hợp đồng mới' })).toBeVisible()
  expect(pageErrors).toEqual([])
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
  await page.route('**/src/services/secondaryReadService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const callSecondaryRead = async name => {
      if (name !== 'getContractRenewalCaseDetail') throw new Error('Unexpected read');
      return { case: window.renewalFixture.row };
    };
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
  await dialog.getByRole('button', { name: 'Kiểm tra & tiếp tục', exact: true }).click()
  await expect(dialog.getByText('Đã xác nhận hợp đồng tái ký. Khoản thu không được gửi lại.')).toBeVisible()
  const calls = await page.evaluate(() => window.renewalTransportCalls)
  expect(calls).toHaveLength(3)
  expect(calls[2].region).toBe('asia-east1')
  expect(calls[2].name).toBe('renewPtContractRegional')
  expect(calls[2].input.idempotencyKey).toBeTruthy()
  expect(calls[2].input).toEqual(calls[1].input)
})

test('lost renewal acknowledgement restores the exact command after reload and checks committed result without another payment', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockRenewals(page, undefined, { confirmationFailures: 1, committedAfterFailure: true })
  await page.goto('/tests/e2e/fixtures/contract-renewal.html')
  const dialog = page.getByRole('dialog', { name: 'Tạo hợp đồng tiếp theo' })
  const next = dialog.getByRole('button', { name: 'Tiếp tục', exact: true })
  await next.click(); await next.click(); await next.click()
  await expect(dialog.getByText('Hợp đồng mới: chờ kích hoạt', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Xác nhận tái ký', exact: true }).click()
  const original = await page.evaluate(() => window.renewalSubmissions[0])
  await expect(dialog.getByRole('heading', { name: 'Đang đối chiếu giao dịch đã gửi' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Lộ trình', exact: true })).toBeDisabled()
  await page.reload()
  await expect(dialog.getByText(String(original.idempotencyKey), { exact: true })).toBeVisible()
  await expect(dialog.getByLabel('Ghi chú giao dịch')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Kiểm tra & tiếp tục', exact: true }).click()
  await expect(dialog.getByText('Đã xác nhận hợp đồng tái ký. Khoản thu không được gửi lại.')).toBeVisible()
  expect(await page.evaluate(() => window.renewalSubmissions)).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('failed reconciliation keeps the original command and never sends another renewal', async ({ page }) => {
  await mockRenewals(page, undefined, { confirmationFailures: 1, reconciliationFails: true })
  await page.goto('/tests/e2e/fixtures/contract-renewal.html')
  const dialog = page.getByRole('dialog', { name: 'Tạo hợp đồng tiếp theo' })
  const next = dialog.getByRole('button', { name: 'Tiếp tục', exact: true })
  await next.click(); await next.click(); await next.click()
  await dialog.getByRole('button', { name: 'Xác nhận tái ký', exact: true }).click()
  await dialog.getByRole('button', { name: 'Kiểm tra & tiếp tục', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Không thể đọc kết quả giao dịch')
  expect(await page.evaluate(() => window.renewalSubmissions.length)).toBe(1)
  await expect(dialog.getByRole('button', { name: 'Thanh toán', exact: true })).toBeDisabled()
})

const secondQueueRow: RenewalPipelineRow = {
  ...row, id: 'source-two', caseId: 'source-two', sourceContractId: 'source-two',
  student: { ...row.student, id: 'student-two', name: 'Học viên thứ hai' },
}
const queueResponse: RenewalPipelineResponse = {
  schemaVersion: 2, generatedAt: new Date().toISOString(), today, rows: [row, secondQueueRow],
  hasMore: true, nextCursor: 'page-two', optionsMode: 'filters',
  optionsScopeKey: 'renewal-options-v1:scope-one', optionsReused: false, pageReset: false,
  stats: { total: 3, pipelineValue: 9000000, weightedPipelineValue: 900000, pendingApprovals: 0,
    stageCounts: { uncontacted: 3, contacted: 0, interested: 0, quote_sent: 0, follow_up: 0, won: 0, lost: 0 },
    riskCounts: { expired: 0, exhausted: 0, critical: 3, upcoming: 0, early: 0 },
    slaCounts: { overdue: 0, due_today: 3, upcoming: 0, done: 0 },
    segmentCounts: { expiring_30d: 3, exhausted_active: 0, expired_last_30d: 0, in_care: 0 },
  },
  options: { packages: [], cashAccounts: [], branches: [{ id: 'branch-1', name: 'Aura' }], assignees: [{ id: 'sales-one', name: 'Sales hiện tại', branchIds: ['branch-1'] }] },
  packages: [], scope: 'branch', audience: 'sales', actorUid: 'staff-one', truncated: false,
  permissions: { canRecordActivity: true, canCreateQuote: true, canRenewContract: true, canViewFinancials: true, canViewAnalytics: true, canAssign: true, canApprove: false },
}

async function mockRenewalQueue(page: Page, behavior: { holdLists?: string[]; holdPrepare?: string[]; prepareError?: string; canRenew?: boolean; holdCalendar?: boolean } = {}) {
  // Never allow the local fixture to contact a real backend or third-party app.
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await page.addInitScript(({ response, behavior }) => {
    window.renewalQueueFixture = {
      base: response, behavior, listCalls: [], prepareCalls: [], listPending: {}, preparePending: {},
      listResponses: {}, prepareVersion: 1, mutations: [], calendarCalls: [], calendarPending: {},
    }
    if (behavior.canRenew === false) window.renewalQueueFixture.base.permissions.canRenewContract = false
  }, { response: queueResponse, behavior })
  await page.route('**/src/services/contractRenewalService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    const state = window.renewalQueueFixture;
    export const listContractRenewalCases = async input => {
      const index = state.listCalls.push(input) - 1;
      const key = input.search || input.cursor || 'initial';
      const response = structuredClone(state.listResponses[key] || state.base);
      if (input.cursor && !state.listResponses[key]) { response.rows = []; response.hasMore = false; response.nextCursor = null; }
      if (input.optionsMode === 'reuse' && !state.listResponses[key]) {
        response.optionsMode = 'reuse'; response.optionsReused = true;
        response.options = { packages: [], cashAccounts: [], branches: [], assignees: [] };
      }
      if (state.behavior.holdLists?.includes(key)) return new Promise((resolve, reject) => { state.listPending[index] = { resolve: value => resolve(value || response), reject }; });
      return response;
    };
    export const listRenewalMessageTemplates = async () => ({ templates: [] });
    export const prepareContractRenewal = async sourceContractId => {
      const index = state.prepareCalls.push(sourceContractId) - 1;
      if (state.behavior.prepareError) throw new Error(state.behavior.prepareError);
      const version = state.prepareVersion;
      const response = { row: structuredClone(state.base.rows.find(row => row.sourceContractId === sourceContractId)), scope: 'system', options: {
        packages: [{ id: 'package-1', name: 'Gói mới v' + version, totalSessions: 24 + version, price: 4200000 + version * 100000, durationMonths: 3, branchId: 'branch-1' }],
        cashAccounts: [{ id: 'cash-v' + version, name: 'Quỹ mới v' + version, type: 'bank', branchId: 'branch-1' }], branches: [], assignees: [],
      }};
      if (state.behavior.holdPrepare?.includes(sourceContractId)) return new Promise((resolve, reject) => { state.preparePending[index] = { resolve: () => resolve(response), reject }; });
      return response;
    };
    export const getContractRenewalCaseDetail = async caseId => ({ case: state.base.rows.find(row => row.caseId === caseId), activities: [], contractHistory: [], upcomingSessions: [], quote: null, approval: null });
    export const createRenewalQuote = async input => { state.mutations.push(input); return { quoteId: 'queue-quote', revision: 2 }; };
    export const renewPtContract = async input => { state.mutations.push(input); return { contractId: 'next', unchanged: false }; };
    export const submitRenewalApproval = async () => ({ approvalId: 'approval', status: 'pending' });
    export const listRenewalCalendar = async input => {
      const index = state.calendarCalls.push(input) - 1;
      if (state.behavior.holdCalendar) return new Promise(resolve => { state.calendarPending[index] = { resolve }; });
      return { items: [] };
    };
    export const getRenewalAnalytics = async () => ({ assignees: [], lostReasons: {}, stageCounts: {} });
    export const refreshContractRenewalQueue = async () => ({ contractsScanned: 0, plannedWrites: 0 });
    export const assignContractRenewalCase = async () => ({});
    export const decideRenewalApproval = async () => ({});
    export const recordContractRenewalActivity = async input => { state.mutations.push(input); return {}; };
    export const transferRenewalCases = async () => ({ transferred: 1 });
  ` }))
  await page.goto('/tests/e2e/fixtures/contract-renewal-queue.html')
  await expect(page.getByRole('button', { name: 'Tái ký', exact: true }).first()).toBeVisible({ timeout: 15000 }).catch(async error => {
    if (behavior.canRenew !== false) throw error
    await expect(page.getByRole('button', { name: 'Chăm sóc', exact: true }).first()).toBeVisible()
  })
}

const queueSearch = (page: Page) => page.getByPlaceholder('Tìm tên, SĐT, email, gói tập…')
const renewQueueRow = (page: Page, index = 0) => page.locator('.renewal-table tbody tr').nth(index).getByRole('button', { name: 'Tái ký', exact: true })

test('queue reuses dictionaries only on load-more and opens fresh full-price/full-account options', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockRenewalQueue(page)
  await queueSearch(page).fill('student')
  await expect.poll(() => page.evaluate(() => window.renewalQueueFixture.listCalls.length)).toBe(2)
  await page.getByRole('button', { name: 'Tải thêm hồ sơ' }).click()
  await expect.poll(() => page.evaluate(() => window.renewalQueueFixture.listCalls.length)).toBe(3)
  const calls = await page.evaluate(() => window.renewalQueueFixture.listCalls)
  expect(calls.every((input: any) => input.pageSize === 30)).toBe(true)
  expect(calls.map((input: any) => input.optionsMode)).toEqual(['filters', 'filters', 'reuse'])
  expect(calls[2].cursor).toBe('page-two')
  expect(calls[2].optionsScopeKey).toBe(queueResponse.optionsScopeKey)
  await renewQueueRow(page).click()
  const dialog = page.getByRole('dialog', { name: 'Tạo hợp đồng tiếp theo' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('combobox', { name: 'Gói tập', exact: true })).toHaveValue('package-1')
  await expect(dialog.getByRole('combobox', { name: 'Gói tập', exact: true }).locator('option:checked')).toContainText('Gói mới v1 · 25 buổi · 4.300.000đ')
  await expect(dialog).toContainText(/toàn hệ thống/i)
  await dialog.getByRole('button', { name: 'Tiếp tục', exact: true }).click()
  await expect(dialog.getByLabel('Giá niêm yết')).toHaveValue('4.300.000đ')
  await dialog.getByRole('button', { name: 'Tiếp tục', exact: true }).click()
  await dialog.getByLabel('Số tiền trả trước', { exact: true }).fill('100000')
  await expect(dialog.getByRole('combobox', { name: 'Tài khoản quỹ', exact: true })).toHaveValue('cash-v1')
  await expect(dialog.getByRole('combobox', { name: 'Tài khoản quỹ', exact: true }).locator('option:checked')).toHaveText('Quỹ mới v1')
  await dialog.getByRole('button', { name: 'Đóng', exact: true }).click()
  await page.evaluate(() => { window.renewalQueueFixture.prepareVersion = 2 })
  await renewQueueRow(page).click()
  await expect(dialog.getByRole('combobox', { name: 'Gói tập', exact: true }).locator('option:checked')).toContainText('Gói mới v2 · 26 buổi · 4.400.000đ')
  expect(await page.evaluate(() => window.renewalQueueFixture.prepareCalls)).toEqual(['source', 'source'])
})

test('a late list page cannot replace the open wizard options or prepared scope', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockRenewalQueue(page, { holdLists: ['page-two'] })
  await page.getByRole('button', { name: 'Tải thêm hồ sơ' }).click()
  await expect.poll(() => page.evaluate(() => Object.keys(window.renewalQueueFixture.listPending).length)).toBe(1)
  await renewQueueRow(page).click()
  const dialog = page.getByRole('dialog', { name: 'Tạo hợp đồng tiếp theo' })
  await expect(dialog.getByRole('combobox', { name: 'Gói tập', exact: true }).locator('option:checked')).toContainText('Gói mới v1')
  await page.evaluate(() => {
    const state = window.renewalQueueFixture
    state.listPending[1].resolve({ ...state.base, rows: [], hasMore: false, nextCursor: null,
      optionsMode: 'reuse', optionsReused: true,
      options: { ...state.base.options, packages: [{ id: 'package-1', name: 'Stale zero package', totalSessions: 0, price: 0, durationMonths: 0, branchId: 'branch-1' }], cashAccounts: [] } })
  })
  await expect(page.getByRole('button', { name: 'Tải thêm hồ sơ' })).toHaveCount(0)
  await expect(dialog.getByRole('combobox', { name: 'Gói tập', exact: true }).locator('option:checked')).toContainText('Gói mới v1 · 25 buổi · 4.300.000đ')
  await expect(dialog).toContainText(/toàn hệ thống/i)
  await dialog.getByRole('button', { name: 'Tiếp tục', exact: true }).click()
  await dialog.getByRole('button', { name: 'Tiếp tục', exact: true }).click()
  await dialog.getByLabel('Số tiền trả trước', { exact: true }).fill('100000')
  await expect(dialog.getByRole('combobox', { name: 'Tài khoản quỹ', exact: true })).toHaveValue('cash-v1')
})

test('out-of-order prepares never replace the newer wizard or reopen one after close', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockRenewalQueue(page, { holdPrepare: ['source'] })
  await renewQueueRow(page, 0).click()
  await expect.poll(() => page.evaluate(() => Object.keys(window.renewalQueueFixture.preparePending).length)).toBe(1)
  await renewQueueRow(page, 1).click()
  const dialog = page.getByRole('dialog', { name: 'Tạo hợp đồng tiếp theo' })
  await expect(dialog).toContainText('Học viên thứ hai')
  await page.evaluate(() => window.renewalQueueFixture.preparePending[0].resolve())
  await page.waitForTimeout(100)
  await expect(dialog).toContainText('Học viên thứ hai')
  await dialog.getByRole('button', { name: 'Đóng', exact: true }).click()
  await renewQueueRow(page, 0).click()
  await expect.poll(() => page.evaluate(() => Object.keys(window.renewalQueueFixture.preparePending).length)).toBe(2)
  await renewQueueRow(page, 1).click()
  await expect(dialog).toContainText('Học viên thứ hai')
  await dialog.getByRole('button', { name: 'Đóng', exact: true }).click()
  await page.evaluate(() => window.renewalQueueFixture.preparePending[2].resolve())
  await page.waitForTimeout(100)
  await expect(dialog).toHaveCount(0)
})

test('stale list searches and pages cannot overwrite a newer filter result', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockRenewalQueue(page, { holdLists: ['old', 'page-two'] })
  await page.getByRole('button', { name: 'Tải thêm hồ sơ' }).click()
  await expect.poll(() => page.evaluate(() => Object.keys(window.renewalQueueFixture.listPending).length)).toBe(1)
  await queueSearch(page).fill('old')
  await expect.poll(() => page.evaluate(() => window.renewalQueueFixture.listCalls.length)).toBe(3)
  await page.evaluate(() => {
    const state = window.renewalQueueFixture
    state.listResponses.new = { ...state.base, hasMore: false, nextCursor: null,
      rows: [{ ...state.base.rows[1], student: { ...state.base.rows[1].student, name: 'Kết quả mới nhất' } }] }
  })
  await queueSearch(page).fill('new')
  await expect(page.locator('.renewal-table tbody')).toContainText('Kết quả mới nhất')
  await page.evaluate(() => {
    window.renewalQueueFixture.listPending[1].resolve()
    window.renewalQueueFixture.listPending[2].resolve()
  })
  await page.waitForTimeout(100)
  await expect(page.locator('.renewal-table tbody tr')).toHaveCount(1)
  await expect(page.locator('.renewal-table tbody')).toContainText('Kết quả mới nhất')
  await expect(page.getByRole('button', { name: 'Tải thêm hồ sơ' })).toHaveCount(0)
})

test('closing the inspector or unmounting invalidates an outstanding prepare without showing stale errors', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockRenewalQueue(page, { holdPrepare: ['source'] })
  await page.locator('.renewal-table tbody tr').first().click()
  const inspector = page.getByRole('dialog', { name: row.student.name })
  await expect(inspector).toBeVisible()
  await inspector.getByRole('button', { name: 'Tạo tái ký' }).click()
  await expect.poll(() => page.evaluate(() => Object.keys(window.renewalQueueFixture.preparePending).length)).toBe(1)
  await inspector.locator('header button').click()
  await page.evaluate(() => window.renewalQueueFixture.preparePending[0].reject(new Error('Stale prepare failure')))
  await page.waitForTimeout(100)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await renewQueueRow(page).click()
  await expect.poll(() => page.evaluate(() => Object.keys(window.renewalQueueFixture.preparePending).length)).toBe(2)
  await page.evaluate(() => {
    window.unmountRenewalQueue()
    window.renewalQueueFixture.preparePending[1].resolve()
  })
  await page.waitForTimeout(100)
  await expect(page.locator('#root')).toBeEmpty()
})

test('fresh prepare denial stays visible and refreshed permission loss closes an open wizard', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockRenewalQueue(page, { prepareError: 'Không còn quyền tái ký.', holdLists: ['page-two'] })
  await renewQueueRow(page).click()
  await expect(page.getByRole('alert')).toContainText('Không còn quyền tái ký.')
  await expect(page.getByRole('dialog', { name: 'Tạo hợp đồng tiếp theo' })).toHaveCount(0)
  await page.evaluate(() => { window.renewalQueueFixture.behavior.prepareError = '' })
  await page.getByRole('button', { name: 'Tải thêm hồ sơ' }).click()
  await expect.poll(() => page.evaluate(() => Object.keys(window.renewalQueueFixture.listPending).length)).toBe(1)
  await renewQueueRow(page).click()
  await expect(page.getByRole('dialog', { name: 'Tạo hợp đồng tiếp theo' })).toBeVisible()
  await page.evaluate(() => {
    const state = window.renewalQueueFixture
    state.listPending[1].resolve({ ...state.base, rows: [], hasMore: false, nextCursor: null,
      optionsScopeKey: 'renewal-options-v1:renewal-revoked', pageReset: true,
      permissions: { ...state.base.permissions, canRenewContract: false } })
  })
  await expect(page.getByRole('dialog', { name: 'Tạo hợp đồng tiếp theo' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Tái ký', exact: true })).toHaveCount(0)
})

test('accepted empty dictionaries preserve filters while totals stay fresh, and refresh/filter/mutation reload dictionaries', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockRenewalQueue(page)
  await page.evaluate(() => {
    const state = window.renewalQueueFixture
    state.listResponses['page-two'] = { ...state.base, optionsMode: 'reuse', optionsReused: true,
      rows: [{ ...state.base.rows[1], id: 'source-three', caseId: 'source-three', sourceContractId: 'source-three',
        student: { ...state.base.rows[1].student, id: 'student-three', name: 'Học viên thứ ba' } }],
      hasMore: false, nextCursor: null,
      options: { branches: [], assignees: [], packages: [], cashAccounts: [] },
      stats: { ...state.base.stats, total: 7, segmentCounts: { ...state.base.stats.segmentCounts, expiring_30d: 7 } },
    }
  })
  await page.getByRole('button', { name: 'Tải thêm hồ sơ' }).click()
  await expect(page.locator('.renewal-table tbody tr')).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Hàng đợi 7', exact: true })).toBeVisible()
  await expect(page.locator('.renewal-focus-card--expiring .renewal-focus-card__copy strong')).toHaveText('7')
  await page.getByRole('button', { name: 'Bộ lọc', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Chi nhánh', exact: true }).locator('option[value="branch-1"]')).toHaveText('Aura')
  await expect(page.getByRole('combobox', { name: 'Phụ trách', exact: true }).locator('option[value="sales-one"]')).toHaveText('Sales hiện tại')
  await page.getByRole('button', { name: 'Làm mới', exact: true }).click()
  await expect(page.locator('.renewal-table tbody tr')).toHaveCount(2)
  await page.getByRole('combobox', { name: 'Chi nhánh', exact: true }).selectOption('branch-1')
  await expect.poll(() => page.evaluate(() => window.renewalQueueFixture.listCalls.length)).toBe(4)
  await page.locator('.renewal-table tbody tr').first().click()
  const inspector = page.getByRole('dialog', { name: row.student.name })
  await expect(inspector).toBeVisible()
  await inspector.getByLabel('Ghi chú', { exact: true }).fill('Synthetic local activity')
  await inspector.getByRole('button', { name: 'Lưu tương tác' }).click()
  await expect.poll(() => page.evaluate(() => window.renewalQueueFixture.listCalls.length)).toBe(5)
  const calls = await page.evaluate(() => window.renewalQueueFixture.listCalls)
  expect(calls.map((input: any) => input.optionsMode)).toEqual(['filters', 'reuse', 'filters', 'filters', 'filters'])
  expect(calls[1].optionsScopeKey).toBe(queueResponse.optionsScopeKey)
  expect(calls.filter((input: any) => input.optionsMode === 'filters').every((input: any) => input.optionsScopeKey === undefined && input.cursor === null)).toBe(true)
  expect(await page.evaluate(() => window.renewalQueueFixture.mutations.length)).toBe(1)
})

test('authority reset replaces rows and dictionaries, clears selection, and closes detail plus payment wizard', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockRenewalQueue(page, { holdLists: ['page-two'] })
  await page.locator('.renewal-table').getByRole('checkbox', { name: `Chọn ${row.student.name}`, exact: true }).check()
  await page.getByRole('button', { name: 'Tải thêm hồ sơ' }).click()
  await expect.poll(() => page.evaluate(() => Object.keys(window.renewalQueueFixture.listPending).length)).toBe(1)
  await page.locator('.renewal-table tbody tr').first().click()
  const inspector = page.getByRole('dialog', { name: row.student.name })
  await inspector.getByRole('button', { name: 'Tạo tái ký' }).click()
  await expect(page.getByRole('dialog', { name: 'Tạo hợp đồng tiếp theo' })).toBeVisible()
  await page.evaluate(() => {
    const state = window.renewalQueueFixture
    const freshRow = { ...state.base.rows[1], branchId: 'branch-2', branchName: 'Aura chi nhánh mới',
      student: { ...state.base.rows[1].student, name: 'Học viên phạm vi mới' } }
    state.base = { ...state.base, rows: [freshRow], hasMore: false, nextCursor: null,
      optionsScopeKey: 'renewal-options-v1:scope-two', pageReset: true,
      options: { packages: [], cashAccounts: [], branches: [{ id: 'branch-2', name: 'Aura chi nhánh mới' }],
        assignees: [{ id: 'sales-two', name: 'Sales mới', branchIds: ['branch-2'] }] },
      stats: { ...state.base.stats, total: 1 },
    }
    state.listPending[1].resolve(state.base)
  })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('Phạm vi truy cập đã thay đổi')
  await expect(page.locator('.renewal-table tbody tr')).toHaveCount(1)
  await expect(page.locator('.renewal-table tbody')).toContainText('Học viên phạm vi mới')
  await expect(page.locator('.renewal-table tbody')).not.toContainText(row.student.name)
  await expect(page.getByRole('button', { name: /Bàn giao .* lead/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Bộ lọc', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Chi nhánh', exact: true }).locator('option')).toHaveText(['Tất cả', 'Aura chi nhánh mới'])
  await expect(page.getByRole('combobox', { name: 'Phụ trách', exact: true }).locator('option')).toHaveText(['Tất cả', 'Sales mới'])
})

test('authority reset rejects old calendar and prepare responses without leaving loading stuck', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockRenewalQueue(page, { holdLists: ['page-two'], holdPrepare: ['source'], holdCalendar: true })
  await page.getByRole('button', { name: 'Tải thêm hồ sơ' }).click()
  await expect.poll(() => page.evaluate(() => Object.keys(window.renewalQueueFixture.listPending).length)).toBe(1)
  await renewQueueRow(page).click()
  await expect.poll(() => page.evaluate(() => Object.keys(window.renewalQueueFixture.preparePending).length)).toBe(1)
  await page.getByRole('button', { name: 'Lịch chăm sóc', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.renewalQueueFixture.calendarCalls.length)).toBe(1)
  await page.evaluate(() => {
    const state = window.renewalQueueFixture
    state.listPending[1].resolve({ ...state.base, optionsScopeKey: 'renewal-options-v1:scope-two',
      pageReset: true, rows: [], hasMore: false, nextCursor: null,
      options: { packages: [], cashAccounts: [], branches: [], assignees: [] } })
  })
  await expect.poll(() => page.evaluate(() => window.renewalQueueFixture.calendarCalls.length)).toBe(2)
  await page.evaluate(() => {
    const state = window.renewalQueueFixture
    state.calendarPending[1].resolve({ items: [] })
    state.calendarPending[0].resolve({ items: state.base.rows })
    state.preparePending[0].resolve()
  })
  await expect(page.locator('.renewal-calendar')).toBeVisible()
  await expect(page.locator('.renewal-calendar')).not.toContainText(row.student.name)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('Đang tải lịch chăm sóc…', { exact: true })).toHaveCount(0)
})

test('unconfirmed reuse cannot append rows, while a transient failure retains the last visible page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockRenewalQueue(page, { holdLists: ['page-two'] })
  await page.getByRole('button', { name: 'Tải thêm hồ sơ' }).click()
  await expect.poll(() => page.evaluate(() => Object.keys(window.renewalQueueFixture.listPending).length)).toBe(1)
  await page.evaluate(() => window.renewalQueueFixture.listPending[1].resolve(window.renewalQueueFixture.base))
  await expect(page.getByRole('alert')).toContainText('Chưa xác nhận được phạm vi dữ liệu')
  await expect(page.locator('.renewal-table tbody tr')).toHaveCount(2)
  await page.getByRole('button', { name: 'Tải thêm hồ sơ' }).click()
  await expect.poll(() => page.evaluate(() => Object.keys(window.renewalQueueFixture.listPending).length)).toBe(2)
  await page.evaluate(() => window.renewalQueueFixture.listPending[2].reject(Object.assign(new Error('Lỗi mạng tạm thời'), { code: 'functions/unavailable' })))
  await expect(page.getByRole('alert')).toContainText('Lỗi mạng tạm thời')
  await expect(page.locator('.renewal-table tbody tr')).toHaveCount(2)
  await page.getByRole('button', { name: 'Tải thêm hồ sơ' }).click()
  await expect.poll(() => page.evaluate(() => Object.keys(window.renewalQueueFixture.listPending).length)).toBe(3)
  await page.evaluate(() => {
    const state = window.renewalQueueFixture
    state.listPending[3].resolve({ ...state.base, optionsReused: true, optionsMode: 'reuse', optionsScopeKey: 'wrong-scope' })
  })
  await expect(page.getByRole('alert')).toContainText('Phạm vi dữ liệu đã thay đổi')
  await expect(page.locator('.renewal-table tbody tr')).toHaveCount(2)
})

test('a normal filters refresh with a new scope key closes a previously prepared wizard even without pageReset', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockRenewalQueue(page, { holdPrepare: ['source'] })
  await page.evaluate(() => { window.renewalQueueFixture.behavior.holdLists = ['initial'] })
  await renewQueueRow(page).click()
  await expect.poll(() => page.evaluate(() => Object.keys(window.renewalQueueFixture.preparePending).length)).toBe(1)
  await page.getByRole('button', { name: 'Làm mới', exact: true }).click()
  await expect.poll(() => page.evaluate(() => Object.keys(window.renewalQueueFixture.listPending).length)).toBe(1)
  await page.evaluate(() => window.renewalQueueFixture.preparePending[0].resolve())
  await expect(page.getByRole('dialog', { name: 'Tạo hợp đồng tiếp theo' })).toBeVisible()
  await page.evaluate(() => {
    const state = window.renewalQueueFixture
    state.listPending[1].resolve({ ...state.base, optionsScopeKey: 'renewal-options-v1:scope-two',
      pageReset: false, rows: [], hasMore: false, nextCursor: null,
      options: { packages: [], cashAccounts: [], branches: [], assignees: [] } })
  })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('Phạm vi truy cập đã thay đổi')
  await expect(page.locator('.renewal-table tbody tr')).toHaveCount(0)
  const calls = await page.evaluate(() => window.renewalQueueFixture.listCalls)
  expect(calls.map((input: any) => input.optionsMode)).toEqual(['filters', 'filters'])
})

test('legacy list responses without scope keys retain filters-mode pagination compatibility', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockRenewalQueue(page)
  await page.evaluate(() => { delete window.renewalQueueFixture.base.optionsScopeKey })
  await page.getByRole('button', { name: 'Làm mới', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.renewalQueueFixture.listCalls.length)).toBe(2)
  await page.getByRole('button', { name: 'Tải thêm hồ sơ' }).click()
  await expect(page.getByRole('button', { name: 'Tải thêm hồ sơ' })).toHaveCount(0)
  await expect(page.locator('.renewal-table tbody tr')).toHaveCount(2)
  await expect(page.getByRole('alert')).toHaveCount(0)
  const calls = await page.evaluate(() => window.renewalQueueFixture.listCalls)
  expect(calls.map((input: any) => input.optionsMode)).toEqual(['filters', 'filters', 'filters'])
  expect(calls[2].cursor).toBe('page-two')
  expect(calls[2].optionsScopeKey).toBeUndefined()
})

for (const code of ['functions/permission-denied', 'functions/unauthenticated']) test(`fresh ${code} clears old rows, filters and open dialogs`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockRenewalQueue(page, { holdLists: ['page-two'] })
  await page.getByRole('button', { name: 'Tải thêm hồ sơ' }).click()
  await expect.poll(() => page.evaluate(() => Object.keys(window.renewalQueueFixture.listPending).length)).toBe(1)
  await page.locator('.renewal-table tbody tr').first().click()
  await page.getByRole('dialog', { name: row.student.name }).getByRole('button', { name: 'Tạo tái ký' }).click()
  await expect(page.getByRole('dialog', { name: 'Tạo hợp đồng tiếp theo' })).toBeVisible()
  await page.evaluate(code => window.renewalQueueFixture.listPending[1].reject(Object.assign(new Error('Quyền truy cập đã thay đổi'), { code })), code)
  await expect(page.getByRole('alert')).toContainText('Quyền truy cập đã thay đổi')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.renewal-table tbody tr')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Tải thêm hồ sơ' })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Chi nhánh', exact: true }).locator('option')).toHaveText(['Tất cả'])
})
