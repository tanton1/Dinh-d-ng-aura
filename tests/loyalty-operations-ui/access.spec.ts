import { expect, test, type Page } from '@playwright/test'

async function open(page: Page) {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await page.route('**/src/features/loyalty/clubSession.ts*', route => route.fulfill({ contentType:'application/javascript', body:`
    let owner={uid:'actor-a'}; const observers=new Set();
    export const getClubSession=()=>owner;
    export const subscribeClubSession=notify=>{observers.add(notify);return()=>observers.delete(notify)};
    window.setClubOwner=uid=>{owner=uid?{uid}:null;observers.forEach(notify=>notify())};
  `}))
  await page.route('**/src/features/loyalty/loyaltyService.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
    const s=window.clubSecurity={calls:0,pending:[],source:'',code:'',hold:false};
    const fail=source=>{if(s.source===source)throw Object.assign(new Error('Club access revoked'),{code:s.code})};
    const dashboard=count=>({schemaVersion:1,policyRevision:1,scope:['branch-a'],generatedAt:'2026-10-30',metrics:{memberCount:count,walletCount:1,availablePoints:200,pendingPoints:0,reservedPoints:0,debtPoints:0,lifetimeRedeemedPoints:0,pendingRedemptions:0,fulfilledRedemptions:0,qualifiedReferrals:0,approvedAmbassadors:0,outstandingNominalValueVnd:20000},tiers:[{tier:'member',count}],features:{earn:true,redeem:false,referral:false,ambassador:false,nutrition:true}});
    export async function getLoyaltyAdminDashboard(){s.calls++;fail('overview');if(s.hold)return new Promise((resolve,reject)=>s.pending.push({resolve:count=>resolve(dashboard(count)),reject}));return dashboard(54321)}
    export async function listLoyaltyRedemptions(){fail('queue');return{redemptions:[]}}
    export async function listLoyaltyAccounts(){fail('accounts');return{schemaVersion:2,accounts:[],totalCount:0,tierCounts:{member:0,silver:0,gold:0,diamond:0},hasMore:false,nextCursor:null}}
    export const listLoyaltyRewardsAdmin=async()=>({rewards:[]});export const listLoyaltyAmbassadors=async()=>({ambassadors:[]});export const listLoyaltyAdjustments=async()=>({adjustments:[]});
    export const saveLoyaltyPolicy=async()=>{};export const transitionLoyaltyRedemption=async()=>{};export const adjustLoyaltyBalance=async()=>{};export const approveAmbassadorPayout=async()=>{};export const manageAmbassadorProfile=async()=>{};export const reviewLoyaltyAdjustment=async()=>{};export const saveLoyaltyReward=async()=>{};
  `}))
  await page.goto('/tests/loyalty-operations-ui/admin.html')
  await expect(page.getByText('54.321',{exact:true}).first()).toBeVisible()
}
for(const code of ['functions/permission-denied','functions/unauthenticated'])for(const source of ['overview','queue','accounts'])test(`${source} ${code} removes all previous Club data`,async({page})=>{
  await open(page)
  await page.evaluate(({code,source})=>Object.assign((window as any).clubSecurity,{code,source}),{code,source})
  if(source==='overview')await page.getByRole('button',{name:'Tải lại dữ liệu Aura Club'}).click()
  else await page.getByRole('navigation',{name:'Vận hành Aura Club'}).getByRole('button',{name:source==='queue'?'Đổi quà':'Thành viên',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('Club access revoked')
  await expect(page.getByText('54.321',{exact:true})).toHaveCount(0)
  await expect(page.getByRole('navigation',{name:'Vận hành Aura Club'})).toHaveCount(0)
})
test('new access scope clears old data before loading and ignores retired responses',async({page})=>{
  await open(page)
  await page.evaluate(()=>{(window as any).clubSecurity.hold=true})
  await page.getByRole('button',{name:'Tải lại dữ liệu Aura Club'}).click()
  await expect.poll(()=>page.evaluate(()=>(window as any).clubSecurity.pending.length)).toBe(1)
  await page.evaluate(()=>(window as any).setClubAccessRevision('scope-b'))
  await expect.poll(()=>page.evaluate(()=>(window as any).clubSecurity.pending.length)).toBe(2)
  await expect(page.getByText('54.321',{exact:true})).toHaveCount(0)
  await page.evaluate(()=>(window as any).clubSecurity.pending[1].resolve(67890))
  await expect(page.getByText('67.890',{exact:true}).first()).toBeVisible()
  await page.evaluate(()=>(window as any).clubSecurity.pending[0].resolve(11111))
  await expect(page.getByText('11.111',{exact:true})).toHaveCount(0)
  await expect(page.getByText('67.890',{exact:true}).first()).toBeVisible()
})
for (const uid of ['actor-a','actor-b']) test(`new session ${uid} clears data even before the actor context updates`,async({page})=>{
  await open(page)
  await page.evaluate(()=>{(window as any).setClubActor('actor-a')})
  await expect(page.getByText('54.321',{exact:true}).first()).toBeVisible()
  await page.evaluate(()=>{(window as any).clubSecurity.hold=true})
  const before=await page.evaluate(()=>(window as any).clubSecurity.calls)
  await page.evaluate(uid=>(window as any).setClubOwner(uid),uid)
  await expect(page.getByText('54.321',{exact:true})).toHaveCount(0)
  if(uid==='actor-b') {
    await expect(page.getByText('Đang xác minh quyền Aura Club')).toBeVisible()
    expect(await page.evaluate(()=>(window as any).clubSecurity.calls)).toBe(before)
    await page.evaluate(()=>(window as any).setClubActor('actor-b'))
  }
  await expect.poll(()=>page.evaluate(()=>(window as any).clubSecurity.pending.length)).toBe(1)
  await page.evaluate(()=>(window as any).clubSecurity.pending[0].resolve(67890))
  await expect(page.getByText('67.890',{exact:true}).first()).toBeVisible()
})
