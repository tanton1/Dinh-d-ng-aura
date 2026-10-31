import { expect, test, type Page } from '@playwright/test'

async function setup(page: Page, options: { late?: boolean; pending?: boolean; manager?: boolean } = {}) {
  await page.route('**/src/services/sessionOperationsService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    const options = ${JSON.stringify(options)};
    window.offCalls = []; window.offContextCalls = []; window.offLostResponse = false;
    export const listPtOperationsRequests = async kind => ({ schemaVersion: 1, kind, canManageStudentOff: !options.manager,
      summary: { total: 1, pending: options.pending ? 1 : 0, approved: options.pending ? 0 : 1, rejected: 0 }, truncated: false,
      records: [{ id: 'off', kind: 'pause', type: 'off', status: options.pending ? 'pending' : 'approved', studentId: 'student', contractId: 'contract', studentName: 'Nguyễn Thanh An', packageName: 'PT 3 tháng', reason: 'Đi công tác', startDate: '2026-10-26', endDate: '2026-10-28', durationDays: 3, cancelledSessionCount: 1 }] });
    export const getStudentOffContext = async (contractId, requestId) => {
      window.offContextCalls.push({contractId, requestId});
      return { contractId, contractRevision: 5, studentName: 'Nguyễn Thanh An', packageName: 'PT 3 tháng', startDate: '2026-10-01', endDate: requestId && !options.pending ? '2027-01-03' : '2026-12-31', maxOffEndDate: '2026-12-31', now: options.late ? '2026-10-26T04:00:00Z' : '2026-10-23T04:00:00Z', today: '2026-10-23', policy: {maxDays: 14, cutoffHour: 9, offLimit: 2, offUsed: 0}, request: requestId ? { id: requestId, revision: 3, status: options.pending ? 'pending' : 'approved', startDate: '2026-10-26', endDate: '2026-10-28', reason: 'Đi công tác'} : null };
    };
    export const saveStudentOff = async command => {
      window.offCalls.push(structuredClone(command));
      if (window.offLostResponse && window.offCalls.length === 1) throw new Error('Mất kết nối sau khi gửi');
      const days = Math.round((Date.parse(command.endDate) - Date.parse(command.startDate)) / 86400000) + 1;
      return {requestId: 'off', revision: 4, durationDays: days, status: options.pending ? 'pending' : 'approved', deltaDays: options.pending ? 0 : days - (command.requestId ? 3 : 0), newEndDate: '2027-01-02', cancelledSessionCount: command.requestId ? 0 : 1, rescheduleNeededCount: command.requestId ? 1 : 0, unchanged: window.offCalls.length > 1};
    };
    export const approveContractPauseRequest = async () => ({});
    export const approveSessionRequest = async () => ({});
    export const rejectSessionRequest = async () => ({});
    export const rejectContractPauseRequest = async () => ({});
  ` }))
  await page.goto('/tests/e2e/fixtures/operations-request-center.html')
}

test('compact admin OFF form fits 360px and retries the same command after a lost response', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await setup(page)
  await page.getByRole('button', { name: 'Tạo OFF thử' }).click()
  const dialog = page.getByRole('dialog', { name: 'Tạo OFF', exact: true })
  await dialog.getByLabel('OFF từ ngày').fill('2026-10-26')
  await dialog.getByLabel('OFF đến ngày').fill('2026-10-27')
  await dialog.getByLabel('Lý do OFF', { exact: true }).fill('Công tác theo lịch mới')
  await expect(dialog).toContainText('02/01/2027 (+2 ngày)')
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: `test-results/${testInfo.project.name}-admin-off-mobile-360.png`, fullPage: true })
  await page.evaluate(() => { (window as any).offLostResponse = true })
  await dialog.getByRole('button', { name: 'Tạo OFF', exact: true }).click()
  await expect(dialog.getByLabel('OFF từ ngày')).toBeDisabled()
  await dialog.getByRole('button', { name: 'Kiểm tra & lưu lại' }).click()
  await expect(dialog).toContainText('Đã tạo OFF.')
  const calls = await page.evaluate(() => (window as any).offCalls)
  expect(calls).toHaveLength(2)
  expect(calls[0]).toEqual(calls[1])
  expect(calls[0].expectedContractRevision).toBe(5)
  await expect(dialog).toContainText('Đã hủy 1 buổi')
  await dialog.getByRole('button', { name: 'Xong', exact: true }).click()
  await expect(dialog).toHaveCount(0)
})

test('approved OFF correction shows the expiration delta and the sessions needing rescheduling', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: 'Đã duyệt', exact: false }).click()
  await page.getByRole('button', { name: 'Sửa ngày OFF', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Sửa ngày OFF', exact: true })
  await dialog.getByLabel('OFF đến ngày').fill('2026-10-27')
  await dialog.getByLabel('Lý do chỉnh sửa').fill('Sửa theo đơn xin nghỉ')
  await expect(dialog).toContainText('02/01/2027 (-1 ngày)')
  await dialog.getByRole('button', { name: 'Lưu ngày OFF' }).click()
  await expect(dialog).toContainText('Có 1 buổi đã hủy nằm ngoài ngày OFF mới')
  const command = await page.evaluate(() => (window as any).offCalls[0])
  expect(command).toMatchObject({ action: 'edit', requestId: 'off', expectedRevision: 3 })
  await dialog.getByRole('button', { name: 'Xong' }).click()
  await expect(dialog).toHaveCount(0)
})

test('OFF validates the duration and requires an explicit reason after the cutoff', async ({ page }) => {
  await setup(page, { late: true })
  await page.getByRole('button', { name: 'Tạo OFF thử' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('OFF từ ngày').fill('2026-10-26')
  await dialog.getByLabel('OFF đến ngày').fill('2026-11-10')
  await dialog.getByLabel('Lý do OFF', { exact: true }).fill('Nghỉ ốm')
  await expect(dialog).toContainText('Chọn từ 1–14 ngày')
  await expect(dialog.getByRole('button', { name: 'Tạo OFF', exact: true })).toBeDisabled()
  await dialog.getByLabel('OFF đến ngày').fill('2026-10-28')
  await expect(dialog).toContainText('Đã qua giờ chốt 9:00 ngày 25/10/2026')
  await expect(dialog.getByRole('button', { name: 'Tạo OFF', exact: true })).toBeDisabled()
  await dialog.getByLabel('Lý do ngoại lệ').fill('Đã kiểm tra giấy khám')
  await dialog.getByRole('button', { name: 'Tạo OFF', exact: true }).click()
  expect(await page.evaluate(() => (window as any).offCalls[0].exceptionReason)).toBe('Đã kiểm tra giấy khám')
})

test('pending OFF correction preserves approval and a queue change closes its modal', async ({ page }) => {
  await setup(page, { pending: true })
  await page.getByRole('button', { name: 'Sửa ngày OFF', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Lý do chỉnh sửa').fill('Sửa ngày theo đăng ký')
  await expect(dialog).toContainText('Sửa ngày không tự duyệt yêu cầu.')
  await dialog.getByRole('button', { name: 'Lưu ngày OFF' }).click()
  await expect(dialog).toContainText('Yêu cầu vẫn chờ duyệt; ngày hết hạn chưa thay đổi.')
  await page.evaluate(() => window.switchOperationsKind('session'))
  await expect(dialog).toHaveCount(0)
})

test('non-admin queue hides date editing and does not load OFF context', async ({ page }) => {
  await setup(page, { manager: true, pending: true })
  await expect(page.getByRole('button', { name: 'Sửa ngày OFF', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).offContextCalls)).toEqual([])
})
