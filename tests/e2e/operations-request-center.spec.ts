import { expect, test, type Page } from '@playwright/test'

declare global {
  interface Window {
    operationsCalls: Array<{ kind: string; resolve: () => void; reject: () => void }>
    operationsApprovalCalls: string[]
    finishOperationsApproval: () => void
    switchOperationsKind: (kind: 'pause' | 'session') => void
  }
}

async function mockOperations(page: Page) {
  await page.route('**/src/services/sessionOperationsService.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    window.operationsCalls = [];
    window.operationsApprovalCalls = [];
    const result = kind => {
      const common = { id: kind + '-request', kind, status: 'pending', studentId: kind + '-student', studentName: kind === 'pause' ? 'Học viên OFF' : 'Học viên đổi lịch', studentPhone: '0900000000', packageName: 'Gói PT', reason: 'Lịch làm việc', createdAt: '2026-10-21T03:00:00.000Z' };
      const record = kind === 'pause'
        ? { ...common, type: 'off', startDate: '2026-10-26', endDate: '2026-11-01', durationDays: 7, cancelledSessionCount: 0 }
        : { ...common, type: 'cancel', originalDate: '2026-10-26', originalHour: 18, trainerName: 'PT An', sessionRevision: 1 };
      return { schemaVersion: 1, kind, summary: { total: 1, pending: 1, approved: 0, rejected: 0 }, records: [record], truncated: false };
    };
    export const listPtOperationsRequests = kind => new Promise((resolve, reject) => window.operationsCalls.push({ kind, resolve: () => resolve(result(kind)), reject: () => reject(new Error('Lỗi yêu cầu cũ')) }));
    export const approveContractPauseRequest = id => new Promise(resolve => { window.operationsApprovalCalls.push(id); window.finishOperationsApproval = () => resolve({}); });
    export const approveSessionRequest = async () => ({});
    export const rejectSessionRequest = async () => ({});
    export const rejectContractPauseRequest = async () => ({});
  ` }))
  await page.goto('/tests/e2e/fixtures/operations-request-center.html')
  await expect.poll(() => page.evaluate(() => window.operationsCalls.map(call => call.kind))).toEqual(['pause'])
}

test('OFF loads only its queue; local search and status filters do not start other reads', async ({ page }) => {
  await mockOperations(page)
  await page.evaluate(() => window.operationsCalls[0].resolve())
  await expect(page.getByText('Học viên OFF', { exact: true })).toBeVisible()
  await page.getByPlaceholder('Tên, SĐT, gói tập hoặc mã yêu cầu').fill('OFF')
  await page.getByRole('button', { name: '1 Tất cả', exact: true }).click()
  await expect(page.getByText('Học viên OFF', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.operationsCalls.map(call => call.kind))).toEqual(['pause'])
})

for (const outcome of ['resolve', 'reject'] as const) test(`a late ${outcome} from OFF cannot overwrite the active change queue`, async ({ page }) => {
  await mockOperations(page)
  await page.getByRole('button', { name: 'Chọn đổi hủy' }).click()
  await expect.poll(() => page.evaluate(() => window.operationsCalls.map(call => call.kind))).toEqual(['pause', 'session'])
  await page.evaluate(() => window.operationsCalls[1].resolve())
  await expect(page.getByText('Học viên đổi lịch', { exact: true })).toBeVisible()
  await page.evaluate(outcome => window.operationsCalls[0][outcome](), outcome)
  await expect(page.getByText('Học viên đổi lịch', { exact: true })).toBeVisible()
  await expect(page.getByText('Học viên OFF', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Lỗi yêu cầu cũ', { exact: true })).toHaveCount(0)
})

test('finishing an approval after leaving OFF does not reload the inactive queue', async ({ page }) => {
  await mockOperations(page)
  await page.evaluate(() => window.operationsCalls[0].resolve())
  await page.getByRole('button', { name: 'Duyệt', exact: true }).click()
  await page.getByRole('button', { name: 'Xác nhận duyệt', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.operationsApprovalCalls)).toEqual(['pause-request'])
  await page.evaluate(() => window.switchOperationsKind('session'))
  await expect.poll(() => page.evaluate(() => window.operationsCalls.map(call => call.kind))).toEqual(['pause', 'session'])
  await page.evaluate(() => window.operationsCalls[1].resolve())
  await expect(page.getByText('Học viên đổi lịch', { exact: true })).toBeVisible()
  await page.evaluate(() => window.finishOperationsApproval())
  await expect(page.getByText('Học viên đổi lịch', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.operationsCalls.map(call => call.kind))).toEqual(['pause', 'session'])
  await expect(page.getByText('Đã duyệt và lưu lịch sử vận hành.', { exact: true })).toHaveCount(0)
})
