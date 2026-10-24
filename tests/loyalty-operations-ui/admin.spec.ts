import { expect, test } from '@playwright/test'

test('operations load only on selection; queue failure never blocks other panels and cached tabs avoid repeated reads', async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await page.addInitScript(() => Object.assign(window, { clubAdmin: { dashboard: 0, queue: [], accounts: 0, rewards: 0, hold: true } }))
  await page.route('**/src/features/loyalty/loyaltyService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    const s=window.clubAdmin;
    export const getLoyaltyAdminDashboard=async()=>{s.dashboard++;return {schemaVersion:1,policyRevision:1,scope:'all',generatedAt:'2026-10-24',metrics:{memberCount:1010,walletCount:900,availablePoints:200,pendingPoints:0,reservedPoints:0,debtPoints:0,lifetimeRedeemedPoints:0,pendingRedemptions:1,fulfilledRedemptions:0,qualifiedReferrals:0,approvedAmbassadors:0,outstandingNominalValueVnd:20000},tiers:[{tier:'member',count:1010}],features:{earn:true,redeem:false,referral:false,ambassador:false,nutrition:true}}};
    export const listLoyaltyRedemptions=async status=>{s.queue.push(status);if(s.hold)return new Promise((resolve,reject)=>{s.fail=()=>reject(new Error('Lỗi tải hàng chờ'));s.release=()=>resolve({redemptions:[]})});return{redemptions:s.items||[]}};
    export const listLoyaltyAccounts=async()=>{s.accounts++;return{accounts:[],totalCount:0,hasMore:false,nextCursor:null}};
    export const listLoyaltyRewardsAdmin=async()=>{s.rewards++;return{rewards:[]}};
    export const listLoyaltyAmbassadors=async()=>({ambassadors:[]});
    export const listLoyaltyAdjustments=async()=>({adjustments:[]});
    export const listLoyaltyReconciliationIssues=async()=>({issues:[]});
    export const saveLoyaltyPolicy=async()=>{};export const transitionLoyaltyRedemption=async()=>{};export const runLoyaltyBackfill=async()=>{};
    export const adjustLoyaltyBalance=async()=>{};export const approveAmbassadorPayout=async()=>{};export const manageAmbassadorProfile=async()=>{};
    export const reconcileLoyaltyAccount=async()=>{};export const reviewLoyaltyAdjustment=async()=>{};export const saveLoyaltyReward=async()=>{};
  ` }))
  await page.goto('/tests/loyalty-operations-ui/admin.html')
  await expect(page.getByText('Thành viên theo hạng')).toBeVisible()
  expect(await page.evaluate(() => (window as any).clubAdmin.queue)).toEqual([])
  const nav = page.getByRole('navigation', { name: 'Vận hành Aura Club' })
  await nav.getByRole('button', { name: 'Đổi quà', exact: true }).click()
  await expect(page.getByText('Đang tải yêu cầu đổi thưởng…')).toBeVisible()
  await nav.getByRole('button', { name: 'Tổng quan' }).click()
  expect(await page.evaluate(() => ({ dashboard: (window as any).clubAdmin.dashboard, accounts: (window as any).clubAdmin.accounts }))).toEqual({ dashboard: 1, accounts: 0 })
  await page.evaluate(() => (window as any).clubAdmin.fail())
  await nav.getByRole('button', { name: 'Đổi quà', exact: true }).click()
  await expect(page.getByText('Lỗi tải hàng chờ')).toBeVisible()
  await page.evaluate(() => { (window as any).clubAdmin.hold = false })
  await page.getByRole('button', { name: 'Thử lại yêu cầu đổi thưởng' }).click()
  await expect(page.getByText('Đã xử lý hết yêu cầu')).toBeVisible()
  expect(await page.evaluate(() => ({ dashboard: (window as any).clubAdmin.dashboard, queue: (window as any).clubAdmin.queue }))).toEqual({ dashboard: 1, queue: ['open', 'open'] })
  await nav.getByRole('button', { name: 'Thành viên', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).clubAdmin.accounts)).toBe(1)
  expect(await page.evaluate(() => (window as any).clubAdmin.rewards)).toBe(0)
  await nav.getByRole('button', { name: 'Quà tặng', exact: true }).click()
  await expect(page.getByText('0 quyền lợi')).toBeVisible()
  await nav.getByRole('button', { name: 'Thành viên', exact: true }).click()
  await expect(page.getByText('Không có kết quả trong danh sách đã tải')).toBeVisible()
  expect(await page.evaluate(() => ({accounts:(window as any).clubAdmin.accounts,rewards:(window as any).clubAdmin.rewards}))).toEqual({accounts:1,rewards:1})
  await page.getByRole('button', {name:'Tải lại tab đang mở'}).click()
  await expect.poll(() => page.evaluate(() => (window as any).clubAdmin.accounts)).toBe(2)
  await nav.getByRole('button', { name: 'Đổi quà', exact: true }).click()
  expect(await page.evaluate(() => (window as any).clubAdmin.queue)).toEqual(['open','open'])
  await page.evaluate(() => { (window as any).clubAdmin.items = [{id:'gift-request',studentId:'test-member',status:'pending',pointsCost:100,rewardSnapshot:{name:'Quà kiểm tra'}}] })
  await page.getByRole('button', {name:'Tải lại dữ liệu Aura Club'}).click()
  await page.getByRole('button', {name:'Từ chối',exact:true}).click()
  await expect(page.getByText('Đã từ chối và hoàn lại điểm giữ chỗ.')).toBeVisible()
  await nav.getByRole('button', {name:'Thành viên',exact:true}).click()
  await expect.poll(() => page.evaluate(() => (window as any).clubAdmin.accounts)).toBe(3)
})

test('gift and redemption banners load actual images; actions stay compact and neutral', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/tests/loyalty-operations-ui/admin.html?demo')
  await expect(page.getByRole('heading', { name: 'Aura Club', exact: true })).toBeVisible()
  const banners = page.getByRole('region', { name: 'Quà tặng và đổi quà' })
  await expect(banners.locator('article')).toHaveCount(2)
  await expect.poll(() => banners.locator('img').evaluateAll(imgs => imgs.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true)
  await expect(page.getByText(/đối soát/i)).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
  await page.screenshot({ path: testInfo.outputPath('admin-overview.png'), fullPage: true })
  await banners.getByRole('button', { name: 'Xem yêu cầu' }).click()
  await expect(page.getByRole('heading', { name: /Yêu cầu cần xử lý/ })).toBeVisible()
  const action = page.locator('.loyalty-admin-actions button').first()
  expect(await action.evaluate(el => ({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,color:getComputedStyle(el).backgroundColor}))).toMatchObject({color:'rgb(38, 34, 41)'})
  const bounds = await action.boundingBox()
  expect(bounds!.width).toBeLessThan(150)
  expect(bounds!.height).toBeGreaterThanOrEqual(44)
  await page.screenshot({ path: testInfo.outputPath('admin-queue.png'), fullPage: true })
  const nav = page.getByRole('navigation', { name: 'Vận hành Aura Club' })
  await nav.getByRole('button', { name: 'Thêm', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Cài đặt' }).click()
  await expect(page.getByRole('heading', {name:'Trạng thái chương trình'})).toBeVisible()
  await nav.getByRole('button', {name:'Quà tặng',exact:true}).click()
  await page.getByRole('button', {name:'Sửa',exact:true}).first().click()
  await expect(page.getByRole('dialog', {name:'Chỉnh quyền lợi'})).toBeVisible()
  await expect(nav.getByRole('button', {name:'Thành viên',exact:true})).toBeDisabled()
  await page.screenshot({ path: testInfo.outputPath('admin-reward-editor.png'), fullPage: true })
})
