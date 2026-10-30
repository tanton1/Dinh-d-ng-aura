import { expect, test, type Page } from '@playwright/test'

const panel = (page: Page) => page.getByRole('region', { name: 'Quyết toán khi nghỉ' })
async function open(page: Page, cutoffDate = '') {
  await page.goto('/tests/finance-history-ui/index.html?workspace=settlement' + (cutoffDate ? '&settlementCutoffDate=' + cutoffDate : ''))
  await expect(panel(page).getByText('Cần kiểm tra', { exact: true })).toBeVisible()
  await expect(panel(page).getByLabel('Ngày nghỉ')).toBeEnabled()
}
async function proposal(page: Page) {
  await panel(page).getByLabel('Ngày nghỉ').fill('2026-10-25')
  await panel(page).getByLabel('Lý do nghỉ').fill('Khách xác nhận kết thúc dịch vụ theo biên bản.')
  await expect(panel(page).getByTestId('settlement-waiver')).toContainText('800.000')
}
async function adjustments(page: Page) {
  await panel(page).locator('summary').filter({ hasText: /^Điều chỉnh thêm/ }).click()
  await expect(panel(page).getByLabel('Phí chấm dứt (đ)', { exact: true })).toBeVisible()
}
async function approve(page: Page) {
  await proposal(page)
  await panel(page).getByRole('button', { name: 'Gửi duyệt', exact: true }).click()
  await expect(panel(page).getByText('Chờ duyệt', { exact: true })).toBeVisible()
  await panel(page).getByRole('button', { name: 'Xác nhận duyệt', exact: true }).click()
  await expect(panel(page).getByText('Đã duyệt', { exact: true })).toBeVisible()
}
async function openStudentPage(page: Page) {
  await page.goto('/tests/finance-history-ui/index.html?workspace=student-page&cancelled=true&multipleContracts=true')
  await expect(page.getByRole('heading', { name: 'Test learner A', exact: true })).toBeVisible()
  await page.evaluate(() => (window as any).financeState.updateContract('contract-a', { paidAmount: 400000 }))
  await page.getByRole('navigation').filter({ visible: true }).getByRole('button', { name: 'Hợp đồng', exact: true }).click()
  const choice = page.getByRole('region', { name: 'Lịch sử hợp đồng', exact: true }).getByRole('button').filter({ hasText: 'Test package A' })
  await choice.click()
  await expect(panel(page).getByLabel('Ngày nghỉ')).toBeEnabled()
  return choice
}

test('legacy cancellation needs date and reason; adjustments are optional and cash needs approval', async ({ page }) => {
  await open(page)
  await expect(panel(page).getByLabel('Ngày nghỉ')).toHaveValue('')
  await expect(panel(page).getByLabel('Miễn phần chưa thực hiện (đ)')).toHaveCount(0)
  await expect(panel(page).getByRole('button', { name: 'Gửi duyệt', exact: true })).toBeDisabled()
  await expect(panel(page).getByRole('button', { name: 'Thu tiền', exact: true })).toHaveCount(0)
  await expect(panel(page).getByLabel('Phí chấm dứt (đ)', { exact: true })).toBeHidden()
  await proposal(page)
  await adjustments(page)
  await expect(panel(page).getByLabel('Lý do phí chấm dứt', { exact: true })).toHaveCount(0)
  await panel(page).getByLabel('Phí chấm dứt (đ)', { exact: true }).fill('100000')
  await expect(panel(page).getByRole('button', { name: 'Gửi duyệt', exact: true })).toBeDisabled()
  await panel(page).getByLabel('Lý do phí chấm dứt', { exact: true }).fill('Theo thỏa thuận')
  await panel(page).getByLabel('Giảm giá trị dịch vụ đã ghi nhận (đ)', { exact: true }).fill('50000')
  await panel(page).getByLabel('Lý do giảm giá trị dịch vụ đã ghi nhận', { exact: true }).fill('Điều chỉnh chất lượng')
  await panel(page).getByLabel('Xóa nợ có phê duyệt (đ)', { exact: true }).fill('50000')
  await panel(page).getByLabel('Lý do xóa nợ có phê duyệt', { exact: true }).fill('Theo phê duyệt')
  await panel(page).getByRole('button', { name: 'Gửi duyệt', exact: true }).click()
  await expect(panel(page).getByText('Chờ duyệt', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).financeState.payments)).toBe(0)
  await panel(page).getByRole('button', { name: 'Xác nhận duyệt', exact: true }).click()
  await expect(panel(page).getByRole('button', { name: 'Hoàn tất', exact: true })).toHaveCount(0)
  await panel(page).getByRole('button', { name: 'Thu tiền', exact: true }).click()
  await panel(page).getByLabel('Nội dung thu/hoàn').fill('Thu theo quyết toán đã duyệt')
  await panel(page).getByLabel('Số tiền quyết toán (đ)').fill('200001')
  await expect(panel(page).getByRole('button', { name: 'Lưu phiếu thu' })).toBeDisabled()
  await panel(page).getByLabel('Số tiền quyết toán (đ)').fill('200000')
  await panel(page).getByRole('button', { name: 'Lưu phiếu thu' }).click()
  await expect(panel(page).getByText('Đã cân đối. Xác nhận hoàn tất hồ sơ.')).toBeVisible()
  await expect(panel(page).getByText('Đã duyệt', { exact: true })).toBeVisible()
  const payload = await page.evaluate(() => (window as any).financeState.intentCalls[0].operation.payload)
  expect(payload).toMatchObject({ amount: 200000, expectedPaidAmount: 200000, expectedSettlementRevision: 2 })
  expect(payload.installmentId).toBeUndefined()
  await panel(page).getByRole('button', { name: 'Hoàn tất' }).click()
  await expect(panel(page).getByText('Đã hoàn tất', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).financeState.settlementCommands.map((item: any) => item.action))).toEqual(['submit', 'approve', 'close'])
})

test('known cancellation date is prefilled and a simple proposal automatically waives unserved value', async ({ page }) => {
  await open(page, '2026-10-24')
  await expect(panel(page).getByLabel('Ngày nghỉ')).toHaveValue('2026-10-24')
  await panel(page).getByLabel('Lý do nghỉ').fill('Khách nghỉ tập.')
  await expect(panel(page).getByRole('button', { name: 'Gửi duyệt', exact: true })).toBeEnabled()
  await panel(page).getByRole('button', { name: 'Gửi duyệt', exact: true }).click()
  await expect(panel(page).getByText('Chờ duyệt', { exact: true })).toBeVisible()
  const command = await page.evaluate(() => (window as any).financeState.settlementCommands[0])
  expect(command.proposal).toMatchObject({
    cutoffDate: '2026-10-24', reason: 'Khách nghỉ tập.', waivedFutureAmount: 800000,
    feeAmount: 0, serviceReductionAmount: 0, writeOffAmount: 0,
  })
  expect(await page.evaluate(() => (window as any).financeState.payments + (window as any).financeState.refunds)).toBe(0)
})

test('refresh uses the latest exact unserved amount and service value in the proposal and forecast', async ({ page }) => {
  await open(page)
  await proposal(page)
  await page.evaluate(() => {
    const s = (window as any).financeState
    s.settlementRecognizedRevenue = 450001
    s.settlementUnservedValue = 749999
  })
  await panel(page).getByRole('button', { name: 'Cập nhật', exact: true }).click()
  await expect(panel(page).getByTestId('settlement-waiver')).toContainText('749.999')
  await expect(panel(page).getByTestId('settlement-result')).toContainText('Dự kiến cần thu thêm')
  await expect(panel(page).getByTestId('settlement-result')).toContainText('250.001')
  await panel(page).getByRole('button', { name: 'Gửi duyệt', exact: true }).click()
  await expect(panel(page).getByText('Chờ duyệt', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).financeState.settlementCommands[0].proposal.waivedFutureAmount)).toBe(749999)
})

test('refund forecast is visible before approval and reflects optional adjustments without moving money', async ({ page }) => {
  await open(page, '2026-10-25')
  await page.evaluate(() => (window as any).financeState.updateContract('contract-a', { paidAmount: 600000 }))
  await panel(page).getByRole('button', { name: 'Cập nhật', exact: true }).click()
  await expect(panel(page).getByTestId('settlement-result')).toContainText('Dự kiến hoàn khách')
  await expect(panel(page).getByTestId('settlement-result')).toContainText('200.000')
  await expect(panel(page).getByRole('button', { name: 'Hoàn tiền', exact: true })).toHaveCount(0)
  await adjustments(page)
  await panel(page).getByLabel('Phí chấm dứt (đ)', { exact: true }).fill('50000')
  await panel(page).getByLabel('Lý do phí chấm dứt', { exact: true }).fill('Phí theo thỏa thuận.')
  await expect(panel(page).getByTestId('settlement-result')).toContainText('150.000')
  await panel(page).getByLabel('Lý do nghỉ').fill('Khách nghỉ tập.')
  await panel(page).getByRole('button', { name: 'Gửi duyệt', exact: true }).click()
  await expect(panel(page).getByText('Chờ duyệt', { exact: true })).toBeVisible()
  await expect(panel(page).getByTestId('settlement-result')).toContainText('Dự kiến hoàn khách')
  await expect(panel(page).getByTestId('settlement-result')).toContainText('150.000')
  expect(await page.evaluate(() => (window as any).financeState.payments + (window as any).financeState.refunds)).toBe(0)
})

test('refund is capped by approved target and lost cash response retries exact revision without duplicate refund', async ({ page }) => {
  await open(page)
  await page.evaluate(() => (window as any).financeState.updateContract('contract-a', { paidAmount: 600000 }))
  await panel(page).getByRole('button', { name: 'Cập nhật' }).click()
  await approve(page)
  await expect(panel(page).getByTestId('settlement-result')).toContainText('Cần hoàn khách')
  await panel(page).getByRole('button', { name: 'Hoàn tiền', exact: true }).click()
  await panel(page).getByLabel('Nội dung thu/hoàn').fill('Hoàn phần chưa sử dụng')
  await panel(page).getByLabel('Số tiền quyết toán (đ)').fill('200001')
  await expect(panel(page).getByRole('button', { name: 'Lưu phiếu hoàn', exact: true })).toBeDisabled()
  await panel(page).getByLabel('Số tiền quyết toán (đ)').fill('200000')
  await page.evaluate(() => { (window as any).financeState.intentFailure = 'commit-lost' })
  await panel(page).getByRole('button', { name: 'Lưu phiếu hoàn' }).click()
  await expect(panel(page).getByRole('button', { name: 'Kiểm tra / gửi lại yêu cầu' })).toBeVisible()
  await expect(panel(page).getByLabel('Số tiền quyết toán (đ)')).toBeDisabled()
  await panel(page).getByRole('button', { name: 'Kiểm tra / gửi lại yêu cầu' }).click()
  await expect(panel(page).getByRole('button', { name: 'Hoàn tất' })).toBeEnabled()
  const state = await page.evaluate(() => { const s = (window as any).financeState; return { calls: s.intentCalls, refunds: s.refunds } })
  expect(state.refunds).toBe(1)
  expect(state.calls[0].operation).toEqual(state.calls[1].operation)
  expect(state.calls[0].operation.payload.expectedSettlementRevision).toBe(2)
})

test('blockers prevent submission and withdrawn proposals preserve nonzero adjustments for editing', async ({ page }) => {
  await open(page)
  await page.evaluate(() => { (window as any).financeState.settlementBlockers = [{ code: 'pending_session', message: 'Còn buổi chưa đối soát trước ngày chốt.' }] })
  await proposal(page)
  await expect(panel(page).getByText('Còn buổi chưa đối soát trước ngày chốt.')).toBeVisible()
  await expect(panel(page).getByRole('button', { name: 'Gửi duyệt', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => (window as any).financeState.settlementCommands.length)).toBe(0)
  await page.evaluate(() => { (window as any).financeState.settlementBlockers = [] })
  await panel(page).getByRole('button', { name: 'Cập nhật' }).click()
  await adjustments(page)
  await panel(page).getByLabel('Phí chấm dứt (đ)', { exact: true }).fill('50000')
  await panel(page).getByLabel('Lý do phí chấm dứt', { exact: true }).fill('Phí theo thỏa thuận.')
  await panel(page).getByLabel('Giảm giá trị dịch vụ đã ghi nhận (đ)', { exact: true }).fill('20000')
  await panel(page).getByLabel('Lý do giảm giá trị dịch vụ đã ghi nhận', { exact: true }).fill('Điều chỉnh chất lượng.')
  await panel(page).getByLabel('Xóa nợ có phê duyệt (đ)', { exact: true }).fill('10000')
  await panel(page).getByLabel('Lý do xóa nợ có phê duyệt', { exact: true }).fill('Theo phê duyệt.')
  await panel(page).getByRole('button', { name: 'Gửi duyệt', exact: true }).click()
  await expect(panel(page).getByRole('button', { name: 'Xác nhận duyệt', exact: true })).toBeEnabled()
  await panel(page).getByRole('button', { name: 'Sửa đề xuất' }).click()
  await expect(panel(page).getByLabel('Lý do nghỉ')).toHaveValue('Khách xác nhận kết thúc dịch vụ theo biên bản.')
  await expect(panel(page).getByTestId('settlement-adjustment-summary')).toContainText('50.000')
  await expect(panel(page).getByTestId('settlement-adjustment-summary')).toContainText('20.000')
  await expect(panel(page).getByTestId('settlement-adjustment-summary')).toContainText('10.000')
  await adjustments(page)
  await expect(panel(page).getByLabel('Phí chấm dứt (đ)', { exact: true })).toBeVisible()
  await expect(panel(page).getByLabel('Phí chấm dứt (đ)', { exact: true })).toHaveValue('50000')
  await expect(panel(page).getByLabel('Lý do phí chấm dứt', { exact: true })).toHaveValue('Phí theo thỏa thuận.')
  await expect(panel(page).getByLabel('Giảm giá trị dịch vụ đã ghi nhận (đ)', { exact: true })).toHaveValue('20000')
  await expect(panel(page).getByLabel('Lý do giảm giá trị dịch vụ đã ghi nhận', { exact: true })).toHaveValue('Điều chỉnh chất lượng.')
  await expect(panel(page).getByLabel('Xóa nợ có phê duyệt (đ)', { exact: true })).toHaveValue('10000')
  await expect(panel(page).getByLabel('Lý do xóa nợ có phê duyệt', { exact: true })).toHaveValue('Theo phê duyệt.')
  expect(await page.evaluate(() => (window as any).financeState.payments + (window as any).financeState.refunds)).toBe(0)
})

test('a definitive stale rejection permits fresh review instead of trapping an invalid retry', async ({ page }) => {
  await open(page)
  await proposal(page)
  await page.evaluate(() => { (window as any).financeState.settlementFailure = 'aborted' })
  await panel(page).getByRole('button', { name: 'Gửi duyệt', exact: true }).click()
  await expect(panel(page).getByText('Số liệu đã thay đổi. Đối soát lại.')).toBeVisible()
  await expect(panel(page).getByRole('button', { name: 'Kiểm tra kết quả' })).toHaveCount(0)
  await panel(page).getByRole('button', { name: 'Tải lại' }).click()
  await expect(panel(page).getByLabel('Lý do nghỉ')).toHaveValue('Khách xác nhận kết thúc dịch vụ theo biên bản.')
  await panel(page).getByRole('button', { name: 'Gửi duyệt', exact: true }).click()
  await expect(panel(page).getByText('Chờ duyệt', { exact: true })).toBeVisible()
  const commands = await page.evaluate(() => (window as any).financeState.settlementCommands)
  expect(commands[0].operationId).not.toBe(commands[1].operationId)
  expect(commands[1].expectedRevision).toBe(1)
})

test('changed approved evidence visibly blocks cash and closure', async ({ page }) => {
  await open(page)
  await approve(page)
  await page.evaluate(() => { (window as any).financeState.settlementBlockers = [{ code: 'approval_stale', message: 'Bằng chứng dịch vụ đã thay đổi sau phê duyệt.' }] })
  await panel(page).getByRole('button', { name: 'Cập nhật' }).click()
  await expect(panel(page).getByText('Bằng chứng dịch vụ đã thay đổi sau phê duyệt.')).toBeVisible()
  await expect(panel(page).getByRole('button', { name: 'Thu tiền', exact: true })).toBeDisabled()
  await expect(panel(page).getByRole('button', { name: 'Hoàn tất', exact: true })).toHaveCount(0)
})

test('lost proposal response retains exact operation and does not auto approve', async ({ page }) => {
  await open(page)
  await proposal(page)
  await page.evaluate(() => { (window as any).financeState.settlementFailure = 'commit-lost' })
  await panel(page).getByRole('button', { name: 'Gửi duyệt', exact: true }).click()
  await expect(panel(page).getByLabel('Lý do nghỉ')).toBeDisabled()
  await panel(page).getByRole('button', { name: 'Kiểm tra kết quả' }).click()
  await expect(panel(page).getByText('Chờ duyệt', { exact: true })).toBeVisible()
  const commands = await page.evaluate(() => (window as any).financeState.settlementCommands)
  expect(commands).toHaveLength(2)
  expect(commands[0]).toEqual(commands[1])
})

test('slow summary sync cannot disable approval or completion after the settlement command succeeds', async ({ page }) => {
  await open(page)
  await page.evaluate(() => {
    const s = (window as any).financeState
    s.updateContract('contract-a', { paidAmount: 400000 })
    s.settlementSyncDefer = true
  })
  await proposal(page)
  await panel(page).getByRole('button', { name: 'Gửi duyệt', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).financeState.settlementSyncPending.length)).toBe(1)
  await expect(panel(page).getByRole('button', { name: 'Xác nhận duyệt', exact: true })).toBeEnabled()
  await panel(page).getByRole('button', { name: 'Xác nhận duyệt', exact: true }).click()
  await expect(panel(page).getByRole('button', { name: 'Hoàn tất', exact: true })).toBeEnabled()
  await panel(page).getByRole('button', { name: 'Hoàn tất', exact: true }).click()
  await expect(panel(page).getByText('Đã hoàn tất', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    const s = (window as any).financeState
    s.settlementSyncDefer = false
    s.settlementSyncPending[0].resolve()
  })
  await expect(panel(page).getByRole('button', { name: 'Kiểm tra kết quả', exact: true })).toHaveCount(0)
  const state = await page.evaluate(() => {
    const s = (window as any).financeState
    return { actions: s.settlementCommands.map((item: any) => item.action), payments: s.payments, refunds: s.refunds }
  })
  expect(state).toEqual({ actions: ['submit', 'approve', 'close'], payments: 0, refunds: 0 })
})

test('summary sync rejection preserves committed settlement and only retries the summary read', async ({ page }) => {
  await open(page)
  await page.evaluate(() => (window as any).financeState.updateContract('contract-a', { paidAmount: 400000 }))
  await proposal(page)
  await panel(page).getByRole('button', { name: 'Gửi duyệt', exact: true }).click()
  await expect(panel(page).getByRole('button', { name: 'Xác nhận duyệt', exact: true })).toBeEnabled()
  await page.evaluate(() => { (window as any).financeState.settlementSyncFailure = 'functions/failed-precondition' })
  await panel(page).getByRole('button', { name: 'Xác nhận duyệt', exact: true }).click()
  await expect(panel(page).getByText('Quyết toán đã lưu. Chưa cập nhật được tóm tắt học viên.')).toBeVisible()
  await expect(panel(page).getByRole('button', { name: 'Hoàn tất', exact: true })).toBeEnabled()
  await expect(panel(page).getByRole('button', { name: 'Kiểm tra kết quả', exact: true })).toHaveCount(0)
  await panel(page).getByRole('button', { name: 'Hoàn tất', exact: true }).click()
  await expect(panel(page).getByText('Đã hoàn tất', { exact: true })).toBeVisible()
  await expect(panel(page).getByRole('button', { name: 'Cập nhật tóm tắt', exact: true })).toBeEnabled()
  await page.evaluate(() => { (window as any).financeState.settlementSyncFailure = '' })
  await panel(page).getByRole('button', { name: 'Cập nhật tóm tắt', exact: true }).click()
  await expect(panel(page).getByText('Quyết toán đã lưu. Chưa cập nhật được tóm tắt học viên.')).toHaveCount(0)
  await expect(panel(page).getByText('Đã hoàn tất', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).financeState.settlementCommands.map((item: any) => item.action))).toEqual(['submit', 'approve', 'close'])
})

test('student overview and contract refresh keep the selected cancelled contract mounted through completion', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const contractChoice = await openStudentPage(page)
  await panel(page).evaluate(node => { node.setAttribute('data-mount-probe', 'original') })
  await proposal(page)
  await page.evaluate(() => { const s = (window as any).financeState; s.overviewDefer = true; s.workspaceDefer = true })
  await panel(page).getByRole('button', { name: 'Gửi duyệt', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).financeState.overviewPending.length)).toBe(1)
  await expect(contractChoice).toHaveAttribute('aria-current', 'true')
  await expect(panel(page)).toHaveAttribute('data-mount-probe', 'original')
  await expect(panel(page).getByRole('button', { name: 'Xác nhận duyệt', exact: true })).toBeEnabled()
  await page.evaluate(() => { const s = (window as any).financeState; s.overviewDefer = false; s.overviewPending[0].resolve() })
  await expect.poll(() => page.evaluate(() => (window as any).financeState.workspacePending.length)).toBe(1)
  await expect(panel(page)).toHaveAttribute('data-mount-probe', 'original')
  await expect(contractChoice).toHaveAttribute('aria-current', 'true')
  await page.evaluate(() => { const s = (window as any).financeState; s.workspaceDefer = false; s.workspacePending[0].resolve() })
  await expect(page.getByText('Đang cập nhật hồ sơ hợp đồng…')).toHaveCount(0)
  await expect(panel(page)).toHaveAttribute('data-mount-probe', 'original')
  await expect(contractChoice).toHaveAttribute('aria-current', 'true')
  await panel(page).getByRole('button', { name: 'Xác nhận duyệt', exact: true }).click()
  await expect(panel(page).getByRole('button', { name: 'Hoàn tất', exact: true })).toBeEnabled()
  await panel(page).getByRole('button', { name: 'Hoàn tất', exact: true }).click()
  await expect(panel(page).getByText('Đã hoàn tất', { exact: true })).toBeVisible()
  const commands = await page.evaluate(() => (window as any).financeState.settlementCommands)
  expect(commands.map((item: any) => [item.contractId, item.action])).toEqual([
    ['contract-a', 'submit'], ['contract-a', 'approve'], ['contract-a', 'close'],
  ])
  expect(errors).toEqual([])
})

test('refreshing student data preserves an unsaved settlement draft and the selected cancelled contract', async ({ page }) => {
  const contractChoice = await openStudentPage(page)
  await proposal(page)
  await panel(page).evaluate(node => { node.setAttribute('data-mount-probe', 'draft') })
  await page.evaluate(() => { (window as any).financeState.workspaceDefer = true })
  await page.getByLabel('Mở menu nghiệp vụ').click()
  await page.getByRole('button', { name: 'Đối soát dữ liệu', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).financeState.workspacePending.length)).toBe(1)
  await expect(panel(page)).toHaveAttribute('data-mount-probe', 'draft')
  await expect(panel(page).getByLabel('Lý do nghỉ')).toHaveValue('Khách xác nhận kết thúc dịch vụ theo biên bản.')
  await page.evaluate(() => { const s = (window as any).financeState; s.workspaceDefer = false; s.workspacePending[0].resolve() })
  await expect(page.getByText('Đang cập nhật hồ sơ hợp đồng…')).toHaveCount(0)
  await expect(panel(page)).toHaveAttribute('data-mount-probe', 'draft')
  await expect(contractChoice).toHaveAttribute('aria-current', 'true')
  await expect(panel(page).getByLabel('Ngày nghỉ')).toHaveValue('2026-10-25')
  await expect(panel(page).getByLabel('Lý do nghỉ')).toHaveValue('Khách xác nhận kết thúc dịch vụ theo biên bản.')
  expect(await page.evaluate(() => (window as any).financeState.settlementCommands)).toEqual([])
})

test('a denied projection refresh still checks overview access and hides revoked financial data', async ({ page }) => {
  await openStudentPage(page)
  await proposal(page)
  const before = await page.evaluate(() => {
    const s = (window as any).financeState
    s.projectionFailure = 'permission-denied'
    s.overviewFailure = 'permission-denied'
    return { overview: s.overviewLoads, projection: s.projectionRefreshes }
  })
  await panel(page).getByRole('button', { name: 'Gửi duyệt', exact: true }).click()
  await expect.poll(() => page.evaluate(() => {
    const s = (window as any).financeState
    return { overview: s.overviewLoads, projection: s.projectionRefreshes }
  })).toEqual({ overview: before.overview + 1, projection: before.projection + 1 })
  await expect(page.getByRole('heading', { name: 'Chưa thể mở Học viên 360', exact: true })).toBeVisible()
  await expect(page.getByText('Không tải được tổng quan thử nghiệm.', { exact: true })).toBeVisible()
  await expect(panel(page)).toHaveCount(0)
  const result = await page.evaluate(() => {
    const s = (window as any).financeState
    return { actions: s.settlementCommands.map((item: any) => item.action), status: s.settlementStatus, payments: s.payments, refunds: s.refunds }
  })
  expect(result).toEqual({ actions: ['submit'], status: 'pending_approval', payments: 0, refunds: 0 })
})

for (const source of ['overview', 'workspace'] as const) {
  for (const code of ['unavailable', source === 'overview' ? 'unauthenticated' : 'permission-denied']) {
    test(`${source} refresh ${code} ${code === 'unavailable' ? 'preserves' : 'hides'} the existing financial workspace`, async ({ page }) => {
      await openStudentPage(page)
      await proposal(page)
      await page.evaluate(({ source, code }) => {
        const s = (window as any).financeState
        if (source === 'overview') s.overviewDefer = true
        else s.workspaceFailure = code
      }, { source, code })
      await panel(page).getByRole('button', { name: 'Gửi duyệt', exact: true }).click()
      if (source === 'overview') {
        await expect.poll(() => page.evaluate(() => (window as any).financeState.overviewPending.length)).toBe(1)
        await page.evaluate(code => {
          const s = (window as any).financeState
          s.overviewDefer = false
          s.overviewPending[0].reject(Object.assign(new Error('Không tải được tổng quan thử nghiệm.'), { code: 'functions/' + code }))
        }, code)
      }
      const message = source === 'overview'
        ? (code === 'unavailable' ? 'Hồ sơ đã lưu. Chưa cập nhật được tóm tắt học viên: Không tải được tổng quan thử nghiệm.' : 'Không tải được tổng quan thử nghiệm.')
        : 'Không tải được hồ sơ hợp đồng thử nghiệm.'
      await expect(page.getByText(message, { exact: true })).toBeVisible()
      if (code === 'unavailable') {
        await expect(panel(page).getByText('Chờ duyệt', { exact: true })).toBeVisible()
        await expect(panel(page).getByRole('button', { name: 'Xác nhận duyệt', exact: true })).toBeEnabled()
      } else await expect(panel(page)).toHaveCount(0)
      expect(await page.evaluate(() => (window as any).financeState.settlementCommands.map((item: any) => item.action))).toEqual(['submit'])
    })
  }
}

test('account change fences old settlement reads and preserves current authority permissions', async ({ page }) => {
  await open(page)
  await page.evaluate(() => { const s = (window as any).financeState; s.settlementDefer = true })
  await panel(page).getByRole('button', { name: 'Cập nhật' }).click()
  await expect.poll(() => page.evaluate(() => (window as any).financeState.settlementPending.length)).toBe(1)
  await page.evaluate(() => { const s = (window as any).financeState; s.settlementDefer = false; s.settlementPermissions = { canSubmit: false, canApprove: false, canClose: false } })
  await page.getByRole('button', { name: 'Change account' }).click()
  await expect(panel(page).getByText('Chờ người phụ trách tài chính xử lý.')).toBeVisible()
  await page.evaluate(() => (window as any).financeState.settlementPending[0].resolve())
  await expect(panel(page).getByLabel('Ngày nghỉ')).toHaveCount(0)
})

test('cancelled contract profile replaces generic installment money controls with settlement and fits narrow screens', async ({ page }, testInfo) => {
  await page.goto('/tests/finance-history-ui/index.html?workspace=student&cancelled=true')
  await expect(panel(page)).toBeVisible()
  await expect(panel(page).getByTestId('settlement-result')).toBeVisible()
  await expect(panel(page).getByLabel('Ngày nghỉ')).toBeEnabled()
  await expect(panel(page).getByText('Đang tính số tiền…', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Quản lý thu tiền', exact: true })).toHaveCount(0)
  await expect(page.getByText('Còn nợ', { exact: true })).toHaveCount(0)
  for (const width of [360, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    if (width === 390 || width === 1440) await panel(page).screenshot({ path: testInfo.outputPath(`settlement-${width}.png`) })
  }
})
