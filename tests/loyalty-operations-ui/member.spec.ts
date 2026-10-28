import { expect, test, type Page } from '@playwright/test'

async function fixture(page: Page, holdHistory = false) {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await page.addInitScript(hold => Object.assign(window, { club: { dashboard: 0, rewards: 0, referral: 0, history: [], hold, owner: 'owner-1' } }), holdHistory)
  await page.route('**/src/features/loyalty/loyaltyService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    const state = window.club;
    const dashboard = () => ({ schemaVersion: 1, account: { studentId: state.owner, status:'active', availablePoints: state.owner === 'owner-1' ? 200 : 600, pendingPoints: 0, reservedPoints: 0, debtPoints: 0, lifetimeEarnedPoints: 200, lifetimeRedeemedPoints: 0, tierQualifyingValue: 0, tier: 'member', tierProgress: { tier: 'member', nextTier: 'silver', percent: 0, remainingValue: 10000000 }, revision: 1 }, missions: [], recognition: { totalKudos:0,totalXp:0,badges:[],recent:[] }, redemptions: [], ambassador: null, features:{earn:true,nutrition:true,redeem:false,referral:false,ambassador:false} });
    export const getMyLoyaltyDashboard = async () => { state.dashboard++; return dashboard(); };
    export const listMyAvailableRewards = async () => { state.rewards++; if(state.failRewards)throw new Error('test'); return {rewards:state.rewardItems||[],redeemEnabled:false}; };
    export const listMyLoyaltyHistory = async (cursor, pageSize) => {
      const owner=state.owner; state.history.push({cursor,pageSize,owner});
      const result={entries:[{id:owner+(cursor?'2':'1'),createdAt:'2026-10-24T12:00:00Z',description:'Lịch sử '+owner+(cursor?' trang hai':''),sourceType:'launch_bonus',kind:'earn',availableDelta:200,pendingDelta:0,reservedDelta:0,debtDelta:0,tierCreditDelta:0}],nextCursor:cursor?null:'opaque-next-cursor'};
      if(state.hold&&owner==='owner-1')return new Promise(resolve=>{state.releaseOldHistory=()=>resolve(result)});
      return result;
    };
    export const getMyReferralWorkspace = async()=>{state.referral++;return{code:null,referrals:[],ambassador:null}};
    export const subscribeToLoyaltySummary = ()=>()=>{};
    export const demoLoyaltyDashboard = dashboard;
    export const demoRewards = [];
    export const applyForAmbassador = async()=>{};
    export const cancelMyPendingRedemption = async()=>{};
    export const createMyReferralCode = async()=>{};
    export const redeemMyReward = async()=>{};
  ` }))
  await page.goto('/tests/loyalty-operations-ui/member.html')
  await expect.poll(() => page.evaluate(() => (window as any).club.dashboard)).toBe(1)
}

test('members see reward banners from the catalog with a fallback for a missing image', async ({ page }, info) => {
  await fixture(page)
  await page.evaluate(() => { (window as any).club.rewardItems = [{ id: 'gift', name: 'Bộ quà Aura', description: 'Bình nước và áo tập Aura', pointsCost: 150, category: 'other', fulfillmentType: 'staff', entitlementType: null, branchIds: [], stock: 5, validityDays: 60, active: true, featured: true, bannerUrl: '/images/aura-club/rewards-gifts-960.webp' }] })
  await page.getByRole('button', { name: 'Đổi quà', exact: true }).filter({ visible: true }).click()
  const card = page.locator('.club-gift-card').filter({ hasText: 'Bộ quà Aura' })
  await expect(card.getByRole('img', { name: 'Bộ quà Aura' })).toBeVisible()
  await expect.poll(() => card.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
  await page.screenshot({ path: info.outputPath('member-reward-banner.png'), fullPage: true })
  await page.route('**/missing-reward.webp', route => route.fulfill({ status: 404, body: '' }))
  await page.evaluate(() => { (window as any).club.rewardItems[0].bannerUrl = '/missing-reward.webp' })
  await page.getByRole('button', { name: 'Tải lại Aura Club', exact: true }).click()
  await expect(card.locator('img')).toHaveCount(0)
  await expect(card.getByRole('heading', { name: 'Bộ quà Aura' })).toBeVisible()
})

test('built-in artwork follows stable reward IDs and recovers from a broken custom banner', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await fixture(page)
  await page.evaluate(() => {
    const names = ['InBody / Assessment', 'Voucher 500K', 'Đổi lịch', 'Guest Pass', 'Voucher 100K', 'Tư vấn dinh dưỡng', 'Aura Shaker', 'Buổi PT', 'Áo Aura', 'Freeze bảy ngày', 'Voucher gia hạn 1 Triệu']
    const ids = ['assessment', 'voucher-50k', 'extra-reschedule', 'guest-pass', 'voucher-100k', 'nutrition-consultation', 'aura-shaker', 'bonus-pt-session', 'aura-shirt', 'freeze-seven-days', 'renewal-voucher-300k']
    ;(window as any).club.rewardItems = ids.map((id, index) => ({ id, name: names[index], description: '', pointsCost: 150, category: 'other', fulfillmentType: 'staff', entitlementType: null, branchIds: [], stock: 5, validityDays: 60, active: true, featured: false }))
  })
  await page.getByRole('button', { name: 'Đổi quà', exact: true }).filter({ visible: true }).click()
  await expect(page.locator('.club-gift-card img')).toHaveCount(11)
  for (const card of await page.locator('.club-gift-card').all()) {
    await card.scrollIntoViewIfNeeded()
    await expect.poll(() => card.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: info.outputPath('member-catalog.png'), fullPage: true })
  await page.route('**/broken-custom.webp', route => route.fulfill({ status: 404, body: '' }))
  await page.evaluate(() => { (window as any).club.rewardItems[0].bannerUrl = '/broken-custom.webp' })
  await page.getByRole('button', { name: 'Tải lại Aura Club', exact: true }).click()
  const assessment = page.getByRole('img', { name: 'InBody / Assessment', exact: true })
  await expect(assessment).toHaveAttribute('src', '/images/aura-club/rewards-20261028/assessment-480.webp')
  await expect.poll(() => assessment.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
})

test('history opens without loading rewards or referrals and uses the server cursor for more entries', async ({ page }) => {
  await fixture(page)
  await expect(page.getByText('Lịch sử owner-1', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => ({ rewards: (window as any).club.rewards, referral: (window as any).club.referral }))).toEqual({ rewards: 0, referral: 0 })
  await page.getByRole('button', { name: 'Tải thêm', exact: true }).click()
  await expect(page.getByText('Lịch sử owner-1 trang hai')).toBeVisible()
  expect(await page.evaluate(() => (window as any).club.history.map(({cursor,pageSize}: any) => ({cursor,pageSize})))).toEqual([
    { cursor: '', pageSize: 30 }, { cursor: 'opaque-next-cursor', pageSize: 30 },
  ])
})

test('reward retry does not reload dashboard or history', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => { (window as any).club.failRewards = true })
  await page.getByRole('button', { name: 'Đổi quà', exact: true }).filter({ visible: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.evaluate(() => { (window as any).club.failRewards = false })
  await page.getByRole('alert').getByRole('button', { name: 'Thử lại' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await page.evaluate(() => ({ dashboard:(window as any).club.dashboard, history:(window as any).club.history.length, rewards:(window as any).club.rewards }))).toEqual({ dashboard:1,history:1,rewards:2 })
})

test('an old account response cannot populate a newly signed-in account', async ({ page }) => {
  await fixture(page, true)
  await expect.poll(() => page.evaluate(() => !!(window as any).club.releaseOldHistory)).toBe(true)
  await page.evaluate(() => { (window as any).club.owner='owner-2'; (window as any).renderClubOwner('owner-2') })
  await expect(page.getByText('Lịch sử owner-2', { exact: true })).toBeVisible()
  await page.evaluate(() => (window as any).club.releaseOldHistory())
  await expect(page.getByText('Lịch sử owner-1', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Lịch sử owner-2', { exact: true })).toBeVisible()
})
