import { expect, test, type Page } from '@playwright/test'

declare global {
  interface Window {
    loyaltyFixture: any
    unmountLoyaltyOperations: () => void
  }
}

async function openFixture(page: Page, query = '', hold: string[] = []) {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await page.addInitScript((hold) => {
    window.loyaltyFixture = { calls: [], pending: {}, hold, mutations: [], rewardsCalls: 0, generation: 1 }
  }, hold)
  await page.route('**/src/features/loyalty/loyaltyService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    const state = window.loyaltyFixture;
    const account = (studentId, studentName, points = 10) => ({
      studentId, studentName, branchId: 'branch-one', status: 'active', availablePoints: points, pendingPoints: 0,
      reservedPoints: 0, debtPoints: 0, lifetimeEarnedPoints: points, lifetimeRedeemedPoints: 0, tierQualifyingValue: 0,
      tier: 'silver', tierProgress: { tier: 'silver', currentValue: 0 }, revision: 1, walletInitialized: true,
    });
    export const listLoyaltyAccounts = async input => {
      const index = state.calls.push(input) - 1;
      const key = input.studentId || input.cursor || 'first';
      let response;
      if (input.studentId) response = { accounts: input.studentId === 'student-far' ? [account('student-far', 'Học viên ngoài trang đầu', state.generation)] : [], totalCount: input.studentId === 'student-far' ? 1 : 0, hasMore: false, nextCursor: null };
      else if (input.cursor) response = { accounts: [account('student-two', 'Học viên Hai', 22), account('student-three', 'Học viên Ba')], totalCount: 3, hasMore: false, nextCursor: null };
      else response = { accounts: [account('student-one', 'Học viên Một', state.generation), account('student-two', 'Học viên Hai')], totalCount: 3, hasMore: true, nextCursor: 'page-two' };
      if (state.hold.includes(key)) return new Promise((resolve, reject) => { state.pending[index] = { resolve: value => resolve(value || response), reject }; });
      return response;
    };
    export const listLoyaltyRewardsAdmin = async () => { state.rewardsCalls++; return { rewards: [] }; };
    export const listLoyaltyAmbassadors = async () => ({ ambassadors: [] });
    export const listLoyaltyAdjustments = async () => ({ adjustments: [] });
    export const listLoyaltyReconciliationIssues = async () => ({ issues: [] });
    export const reconcileLoyaltyAccount = async studentId => {
      state.mutations.push(studentId);
      return new Promise(resolve => { state.releaseReconcile = () => resolve({ mismatch: true, account: account(studentId, 'Học viên Một', 999) }); });
    };
    export const adjustLoyaltyBalance = async input => {
      state.mutations.push(input);
      return new Promise(resolve => { state.releaseAdjustment = () => resolve({ status: 'applied' }); });
    };
    export const approveAmbassadorPayout = async () => { throw new Error('Unexpected payout'); };
    export const manageAmbassadorProfile = async () => { throw new Error('Unexpected ambassador mutation'); };
    export const reviewLoyaltyAdjustment = async () => { throw new Error('Unexpected adjustment review'); };
    export const saveLoyaltyReward = async () => { throw new Error('Unexpected reward mutation'); };
  ` }))
  await page.goto(`/tests/loyalty-operations-ui/index.html${query}`)
  await expect.poll(() => page.evaluate(() => window.loyaltyFixture.calls.length)).toBe(1)
}

const search = (page: Page) => page.getByPlaceholder('Lọc tên, mã hoặc chi nhánh trong danh sách đã tải')
const cards = (page: Page) => page.locator('.loyalty-admin-accounts .loyalty-admin-list > article')

test('first page is bounded, name filtering is explicitly loaded-only, and load-more deduplicates accounts', async ({ page }) => {
  await openFixture(page)
  await expect(cards(page)).toHaveCount(2)
  await expect(page.getByText('Đã tải 2 / 3 học viên. Bộ lọc tên và chi nhánh chỉ áp dụng phần đã tải.')).toBeVisible()
  expect(await page.evaluate(() => window.loyaltyFixture.calls)).toEqual([{ pageSize: 100 }])
  await search(page).fill('Học viên Ba')
  await expect(page.getByText('Không có kết quả trong danh sách đã tải')).toBeVisible()
  expect(await page.evaluate(() => window.loyaltyFixture.calls.length)).toBe(1)
  await page.getByRole('button', { name: 'Tải thêm', exact: true }).click()
  await expect(cards(page)).toHaveCount(1)
  await expect(cards(page)).toContainText('Học viên Ba')
  expect(await page.evaluate(() => window.loyaltyFixture.calls)).toEqual([{ pageSize: 100 }, { pageSize: 100, cursor: 'page-two' }])
  await search(page).fill('')
  await expect(cards(page)).toHaveCount(3)
  await expect(cards(page).filter({ hasText: 'Học viên Hai' })).toContainText('22')
  await expect(page.getByRole('button', { name: 'Tải thêm', exact: true })).toHaveCount(0)
})

test('deep-link starts with one exact-ID lookup even for a rewards administrator, with no page scan', async ({ page }) => {
  await openFixture(page, '?studentId=student-far&rewards=1')
  await expect(cards(page)).toHaveCount(1)
  await expect(cards(page)).toContainText('Học viên ngoài trang đầu')
  await expect(page.getByText('Tra cứu chính xác mã: student-far')).toBeVisible()
  expect(await page.evaluate(() => window.loyaltyFixture.calls)).toEqual([{ pageSize: 100, studentId: 'student-far' }])
  expect(await page.evaluate(() => window.loyaltyFixture.rewardsCalls)).toBe(0)
  await expect(page.getByRole('button', { name: 'Tải thêm', exact: true })).toHaveCount(0)
  await page.evaluate(() => { window.loyaltyFixture.generation = 7 })
  await page.getByRole('button', { name: 'Tìm chính xác mã', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.loyaltyFixture.calls.length)).toBe(2)
  await expect(cards(page)).toContainText('7')
  await page.getByRole('button', { name: 'Về danh sách', exact: true }).click()
  await expect(cards(page)).toHaveCount(2)
  expect(await page.evaluate(() => window.loyaltyFixture.calls[2])).toEqual({ pageSize: 100 })
})

test('explicit ID search never claims a global name search and reports scoped not-found without paging', async ({ page }) => {
  await openFixture(page)
  await search(page).fill('student-far')
  expect(await page.evaluate(() => window.loyaltyFixture.calls.length)).toBe(1)
  await page.getByRole('button', { name: 'Tìm chính xác mã', exact: true }).click()
  await expect(cards(page)).toHaveCount(1)
  await expect(cards(page)).toContainText('Học viên ngoài trang đầu')
  await search(page).fill('other-branch-student')
  await page.getByRole('button', { name: 'Tìm chính xác mã', exact: true }).click()
  await expect(page.getByText('Không có học viên phù hợp trong phạm vi truy cập')).toBeVisible()
  await expect(cards(page)).toHaveCount(0)
  expect(await page.evaluate(() => window.loyaltyFixture.calls)).toEqual([
    { pageSize: 100 }, { pageSize: 100, studentId: 'student-far' }, { pageSize: 100, studentId: 'other-branch-student' },
  ])
})

test('a late previous page cannot append after tab change or overwrite the new list', async ({ page }) => {
  await openFixture(page, '', ['page-two'])
  await expect(cards(page)).toHaveCount(2)
  await page.getByRole('button', { name: 'Tải thêm', exact: true }).click()
  await expect.poll(() => page.evaluate(() => Object.keys(window.loyaltyFixture.pending).length)).toBe(1)
  await page.getByRole('button', { name: 'Cần đối soát', exact: true }).click()
  await expect(page.getByText('Không có lỗi đối soát mở')).toBeVisible()
  await page.getByRole('button', { name: 'Ví học viên', exact: true }).click()
  await expect(cards(page)).toHaveCount(2)
  await page.evaluate(() => window.loyaltyFixture.pending[1].resolve())
  await page.waitForTimeout(100)
  await expect(cards(page)).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Tải thêm', exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.loyaltyFixture.calls.length)).toBe(3)
})

test('an unmounted account lookup cannot reappear or issue another request', async ({ page }) => {
  await openFixture(page, '?studentId=student-far', ['student-far'])
  await expect.poll(() => page.evaluate(() => Object.keys(window.loyaltyFixture.pending).length)).toBe(1)
  await page.evaluate(() => { window.unmountLoyaltyOperations(); window.loyaltyFixture.pending[0].resolve() })
  await page.waitForTimeout(100)
  await expect(page.locator('#root')).toBeEmpty()
  expect(await page.evaluate(() => window.loyaltyFixture.calls.length)).toBe(1)
})

test('reconcile blocks tab/refresh/page races and keeps its fresh balance', async ({ page }) => {
  await openFixture(page)
  await expect(cards(page)).toHaveCount(2)
  await cards(page).first().getByRole('button', { name: 'Đối soát', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.loyaltyFixture.mutations.length)).toBe(1)
  await expect(page.getByRole('button', { name: 'Cần đối soát', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Ví học viên', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Tải lại tab đang mở', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Tải thêm', exact: true })).toBeDisabled()
  await page.evaluate(() => window.loyaltyFixture.releaseReconcile())
  await expect(cards(page).first()).toContainText('999')
  await expect(page.getByRole('button', { name: 'Ví học viên', exact: true })).toBeEnabled()
  expect(await page.evaluate(() => window.loyaltyFixture.calls.length)).toBe(1)
})

test('an applied adjustment completing after unmount cannot trigger a new account read', async ({ page }) => {
  await openFixture(page, '?adjust=1')
  await cards(page).first().getByRole('button', { name: 'Điều chỉnh', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Học viên Một', exact: true })
  await dialog.getByLabel('Số điểm', { exact: true }).fill('100')
  await dialog.getByLabel('Lý do', { exact: true }).fill('Local fixture only')
  await dialog.getByRole('button', { name: 'Gửi điều chỉnh', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.loyaltyFixture.mutations.length)).toBe(1)
  await page.evaluate(() => { window.unmountLoyaltyOperations(); window.loyaltyFixture.releaseAdjustment() })
  await page.waitForTimeout(100)
  await expect(page.locator('#root')).toBeEmpty()
  expect(await page.evaluate(() => window.loyaltyFixture.calls.length)).toBe(1)
})
