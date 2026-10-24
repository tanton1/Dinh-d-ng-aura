import { expect, test } from '@playwright/test'

test('overview renders while its queue is pending; queue retry and account tab load independently', async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await page.addInitScript(() => Object.assign(window, { clubAdmin: { dashboard: 0, queue: [], accounts: 0, hold: true } }))
  await page.route('**/src/features/loyalty/loyaltyService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    const s=window.clubAdmin;
    export const getLoyaltyAdminDashboard=async()=>{s.dashboard++;return {schemaVersion:1,policyRevision:1,scope:'all',generatedAt:'2026-10-24',metrics:{memberCount:1010,walletCount:900,availablePoints:200,pendingPoints:0,reservedPoints:0,debtPoints:0,lifetimeRedeemedPoints:0,pendingRedemptions:1,fulfilledRedemptions:0,qualifiedReferrals:0,approvedAmbassadors:0,outstandingNominalValueVnd:20000},tiers:[{tier:'member',count:1010}],features:{earn:true,redeem:false,referral:false,ambassador:false,nutrition:true}}};
    export const listLoyaltyRedemptions=async status=>{s.queue.push(status);if(s.hold)return new Promise((resolve,reject)=>{s.fail=()=>reject(new Error('Lỗi tải hàng chờ'));s.release=()=>resolve({redemptions:[]})});return{redemptions:[]}};
    export const listLoyaltyAccounts=async()=>{s.accounts++;return{accounts:[],totalCount:0,hasMore:false,nextCursor:null}};
    export const listLoyaltyRewardsAdmin=async()=>({rewards:[]});
    export const listLoyaltyAmbassadors=async()=>({ambassadors:[]});
    export const listLoyaltyAdjustments=async()=>({adjustments:[]});
    export const listLoyaltyReconciliationIssues=async()=>({issues:[]});
    export const saveLoyaltyPolicy=async()=>{};export const transitionLoyaltyRedemption=async()=>{};export const runLoyaltyBackfill=async()=>{};
    export const adjustLoyaltyBalance=async()=>{};export const approveAmbassadorPayout=async()=>{};export const manageAmbassadorProfile=async()=>{};
    export const reconcileLoyaltyAccount=async()=>{};export const reviewLoyaltyAdjustment=async()=>{};export const saveLoyaltyReward=async()=>{};
  ` }))
  await page.goto('/tests/loyalty-operations-ui/admin.html')
  await expect(page.getByText('Thành viên theo hạng')).toBeVisible()
  await expect(page.getByText('Đang tải yêu cầu đổi thưởng…')).toBeVisible()
  expect(await page.evaluate(() => ({ dashboard: (window as any).clubAdmin.dashboard, accounts: (window as any).clubAdmin.accounts }))).toEqual({ dashboard: 1, accounts: 0 })
  await page.evaluate(() => (window as any).clubAdmin.fail())
  await expect(page.getByText('Lỗi tải hàng chờ')).toBeVisible()
  await expect(page.getByText('Thành viên theo hạng')).toBeVisible()
  await page.evaluate(() => { (window as any).clubAdmin.hold = false })
  await page.getByRole('button', { name: 'Thử lại yêu cầu đổi thưởng' }).click()
  await expect(page.getByText('Đã xử lý hết yêu cầu')).toBeVisible()
  expect(await page.evaluate(() => ({ dashboard: (window as any).clubAdmin.dashboard, queue: (window as any).clubAdmin.queue }))).toEqual({ dashboard: 1, queue: ['open', 'open'] })
  await page.getByText('Quản lý thành viên và quyền lợi', { exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).clubAdmin.accounts)).toBe(1)
})
