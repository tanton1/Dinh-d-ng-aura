import { expect, test, type Page } from '@playwright/test'

async function fixture(page: Page, holdHistory = false) {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await page.addInitScript(hold => Object.assign(window, { club: { dashboard: 0, rewards: 0, referral: 0, history: [], hold, owner: 'owner-1' } }), holdHistory)
  await page.route('**/src/features/loyalty/loyaltyService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    const state = window.club;
    const dashboard = () => ({ schemaVersion: 1, account: { studentId: state.owner, status:'active', availablePoints: state.owner === 'owner-1' ? 200 : 600, pendingPoints: 0, reservedPoints: 0, debtPoints: 0, lifetimeEarnedPoints: 200, lifetimeRedeemedPoints: 0, tierQualifyingValue: 0, tier: 'member', tierProgress: { tier: 'member', nextTier: 'silver', percent: 0, remainingValue: 10000000 }, revision: 1 }, missions: [], recognition: { totalKudos:0,totalXp:0,badges:[],recent:[] }, redemptions: [], ambassador: null, features:{earn:true,nutrition:true,redeem:false,referral:false,ambassador:false} });
    export const getMyLoyaltyDashboard = async () => { state.dashboard++; return dashboard(); };
    export const listMyAvailableRewards = async () => { state.rewards++; if(state.failRewards)throw new Error('test'); return {rewards:[],redeemEnabled:false}; };
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
