import { expect, test, type Page } from '@playwright/test'

type Call = { name: string; owner: string; input: Record<string, unknown> }
async function fixture(page: Page, reply: (call: Call) => unknown | Promise<unknown>) {
  const calls: Call[] = []
  await page.route('**/src/contexts/AuthContext.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const useAuth = () => ({ user: {uid: window.reportingOwner}, profile: {uid: window.reportingOwner, role:'admin', authzVersion:1}, backendMode:'firebase' });
  ` }))
  await page.route('**/src/contexts/DatabaseContext.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const useDatabase = () => ({branches: []});
  ` }))
  await page.route('**/src/components/admin/pt/FinanceIntentBoundary.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const FinancePendingOperations = () => null;
    export default function Boundary({children}) { return children({blocked:false,busy:false,submit:async()=>{}}); }
  ` }))
  await page.route('**/src/services/scopedReportingService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    async function read(name,input) {
      const result = await fetch('/__reporting_read',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,input,owner:window.reportingOwner})});
      if (!result.ok) throw new Error('Dịch vụ chưa sẵn sàng');
      return result.json();
    }
    export const listFinanceReceivables = input => read('finance',input);
    export const listFinanceStudentLabels = studentIds => read('labels',{studentIds});
    export const listAcademyEnrollmentsPage = cursor => read('academy',{cursor});
  ` }))
  await page.route('**/__reporting_read', async route => {
    const call = route.request().postDataJSON() as Call
    calls.push(call)
    const result = await reply(call)
    await route.fulfill(result instanceof Error ? { status: 503, json: { error: result.message } } : { json: result })
  })
  return calls
}
const summary = { complete: true, totals: { debt: 900000, overdue: 300000, thisMonth: 600000 },
  counts: { all: 3, overdue: 1, 'this-week': 1, 'this-month': 2, overpaid: 0 }, asOf: '2026-10-30T10:00:00Z', sourceDocuments: 3 }
function financePage(id: string, hasMore = false, report: unknown = summary) {
  return { contracts: [{ id, studentId: id, packageName: 'Gói PT', totalPrice: 500000, discount: 0, paidAmount: 100000, status: 'active' }],
    students: [{ id, name: `Học viên ${id}`, phone: '0900000000' }], summary: report, hasMore, nextCursor: hasMore ? 'next' : null, asOf: summary.asOf, scanned: 1 }
}

test('finance loads only explicit pages, keeps full summary and does not poll idle', async ({ page }) => {
  const calls = await fixture(page, call => financePage(call.input.cursor ? 'second' : 'first', !call.input.cursor, call.input.includeSummary ? summary : null))
  await page.goto('/tests/e2e/fixtures/academy-reporting.html')
  await expect(page.getByRole('heading', { name: 'Học viên first' })).toBeVisible()
  await expect(page.locator('.aura-metric-carousel')).toContainText('900.000đ')
  await page.getByRole('button', { name: 'Tải thêm hồ sơ' }).click()
  await expect(page.getByRole('heading', { name: 'Học viên second' })).toBeVisible()
  expect(calls.map(call => call.input.includeSummary)).toEqual([true, false])
  expect(calls[1].input.cursor).toBe('next')
  await page.clock.install()
  await page.clock.fastForward(6000)
  expect(calls).toHaveLength(2)
  await page.getByRole('button', { name: 'Làm mới trả góp' }).click()
  await expect.poll(() => calls.length).toBe(3)
  expect(calls[2].input.refresh).toBe(true)
})

test('finance incomplete totals remain unknown and account switch fences late data', async ({ page }) => {
  let resolve!: () => void
  const waiting = new Promise<void>(done => { resolve = done })
  const calls = await fixture(page, async call => {
    if (call.owner === 'admin-a') await waiting
    return financePage(call.owner, false, { ...summary, complete: false, totals: null, counts: null, reason: 'limit' })
  })
  await page.goto('/tests/e2e/fixtures/academy-reporting.html')
  await expect.poll(() => calls.length).toBe(1)
  await page.getByRole('button', { name: 'Đổi tài khoản' }).click()
  await expect(page.getByRole('heading', { name: 'Học viên admin-b' })).toBeVisible()
  resolve()
  await expect(page.getByRole('heading', { name: 'Học viên admin-a' })).toHaveCount(0)
  await expect(page.locator('.aura-metric-carousel')).not.toContainText('0đ')
  await expect(page.getByRole('alert')).toContainText('Chưa đủ dữ liệu')
})

test('Academy reads enrollment pages and only advertises counts in loaded data', async ({ page }) => {
  const calls = await fixture(page, call => {
    const id = call.input.cursor ? 'second' : 'first'
    return { enrollments: [{ id, userId: id, courseId: 'course', status: 'active' }], users: [{ uid: id, displayName: id, email: `${id}@example.test`, role: 'student' }],
      hasMore: !call.input.cursor, nextCursor: call.input.cursor ? null : 'next', asOf: summary.asOf }
  })
  await page.goto('/tests/e2e/fixtures/academy-reporting.html?academy=1')
  await expect(page.getByText('1 ghi danh hoạt động đã tải')).toBeVisible()
  await page.getByRole('button', { name: 'Tải thêm ghi danh' }).click()
  await expect(page.getByText('2 ghi danh hoạt động đã tải')).toBeVisible()
  expect(calls.map(call => call.input.cursor)).toEqual([null, 'next'])
  await page.getByPlaceholder('Tìm trong ghi danh đã tải...').fill('second')
  await expect(page.locator('.academy-enrollment-row').filter({ hasText: 'first@example.test' })).toHaveCount(0)
  expect(calls).toHaveLength(2)
})

test('malformed installment data stays visible as unknown and cannot start collection', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await fixture(page, () => {
    const result = financePage('invalid', false, { ...summary, complete: false, totals: null, counts: null })
    return { ...result, contracts: [{ ...result.contracts[0], installments: { legacy: true }, dataIssue: 'invalid-amount' }] }
  })
  await page.goto('/tests/e2e/fixtures/academy-reporting.html')
  await expect(page.getByRole('heading', { name: 'Học viên invalid' })).toBeVisible()
  await expect(page.getByText('Chưa xác định', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Thu tiền của Học viên invalid' })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('rejected old label lookup cannot overwrite the new finance scope cursor', async ({ page }) => {
  let releaseOldLabels!: () => void
  const oldLabels = new Promise<void>(resolve => { releaseOldLabels = resolve })
  const reportingCalls = await fixture(page, async call => {
    if (call.name === 'labels') {
      const ids = call.input.studentIds as string[]
      if (ids.includes('old-student')) {
        await oldLabels
        return new Error('Old optional lookup failed after scope changed')
      }
      return ids.map(id => ({ id, name: `Tên ${id}` }))
    }
    return financePage('receivable')
  })
  const ledgerCalls: Array<Record<string, unknown>> = []
  await page.route('**/src/services/financeLedgerService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const listFinanceLedger = async input => (await fetch('/__ledger_scope_read', {
      method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(input)
    })).json();
  ` }))
  await page.route('**/__ledger_scope_read', async route => {
    const input = route.request().postDataJSON()
    ledgerCalls.push(input)
    const old = input.branchId === 'all'
    const id = old ? 'old' : input.cursor ? 'new-next' : 'new'
    await route.fulfill({ json: {
      entries: [{ id, studentId: `${id}-student`, contractId: `${id}-contract`, type: 'payment', status: 'posted',
        amount: 100000, cashImpact: 100000, effectiveAt: '2026-10-30T10:00:00Z', referenceCode: `REF-${id}` }],
      hasMore: !input.cursor, nextCursor: input.cursor ? null : old ? 'old-cursor' : 'new-cursor', summary: null,
    } })
  })
  await page.goto('/tests/e2e/fixtures/academy-reporting.html')
  await page.getByRole('button', { name: 'Mở lịch sử thu trả góp' }).click()
  await expect.poll(() => reportingCalls.some(call => call.name === 'labels' && (call.input.studentIds as string[]).includes('old-student'))).toBe(true)
  const history = page.getByRole('dialog', { name: 'Sổ giao dịch' })
  await history.getByRole('button', { name: 'Đóng', exact: true }).click()
  await expect(history).toBeHidden()
  await page.getByRole('combobox', { name: 'Lọc chi nhánh công nợ' }).selectOption('none')
  await page.getByRole('button', { name: 'Mở lịch sử thu trả góp' }).click()
  await expect(history.getByRole('button', { name: 'Tải thêm giao dịch' })).toBeEnabled()
  await expect(history.getByText('Tên new-student', { exact: true })).toBeVisible()

  const oldLabelResponse = page.waitForResponse(response => response.url().endsWith('/__reporting_read')
    && response.request().postDataJSON()?.input?.studentIds?.includes('old-student'))
  releaseOldLabels()
  await (await oldLabelResponse).finished()
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await history.getByRole('button', { name: 'Tải thêm giao dịch' }).click()
  await expect.poll(() => ledgerCalls.length).toBe(3)
  expect(ledgerCalls[2].branchId).toBe('none')
  expect(ledgerCalls[2].cursor).toBe('new-cursor')
  await expect(history.getByText(/REF-old/)).toHaveCount(0)
})
