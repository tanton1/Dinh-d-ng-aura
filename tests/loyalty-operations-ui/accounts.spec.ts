import { expect, test, type Page } from '@playwright/test'
declare global { interface Window { loyaltyFixture: any; unmountLoyaltyOperations: () => void } }
const cards = (page: Page) => page.locator('.loyalty-admin-accounts .loyalty-admin-list > article')
const calls = (page: Page, count: number) => expect.poll(() => page.evaluate(() => window.loyaltyFixture.calls.length)).toBe(count)
async function openFixture(page: Page, query = '', hold: string[] = []) {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await page.addInitScript(hold => { window.loyaltyFixture = { calls: [], pending: {}, hold, mutations: [], rewardsCalls: 0, generation: 1 } }, hold)
  await page.route('**/src/features/loyalty/loyaltyService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    const state=window.loyaltyFixture;
    const account=(studentId,studentName,tier='silver',points=10)=>({studentId,studentName,tier,branchId:'branch-one',status:'active',availablePoints:points,pendingPoints:0,reservedPoints:0,debtPoints:0,lifetimeEarnedPoints:points,lifetimeRedeemedPoints:0,tierQualifyingValue:0,tierProgress:{tier,currentValue:0},revision:1,walletInitialized:true});
    const normalize=value=>value.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/đ/g,'d').toLowerCase();
    export async function listLoyaltyAccounts(input){
      const index=state.calls.push(input)-1,key=input.studentId||input.cursor||input.query||input.tier||'all';
      let all=new URLSearchParams(location.search).has('many')?Array.from({length:165},(_,i)=>account('member-'+i,'Thành viên '+i,i===164?'diamond':'silver')):[account('student-one','Học viên Một','silver',state.generation),account('student-two','Học viên Hai','gold'),account('student-three','Học viên Ba')];
      if(input.studentId)all=input.studentId==='student-far'?[account('student-far','Học viên ngoài trang đầu','silver',state.generation)]:[];
      else if(input.query)all=all.filter(row=>normalize(row.studentName).includes(normalize(input.query)));
      const tierCounts=Object.fromEntries(['member','silver','gold','diamond'].map(tier=>[tier,all.filter(row=>row.tier===tier).length]));
      const selected=input.studentId||!input.tier||input.tier==='all'?all:all.filter(row=>row.tier===input.tier);
      const offset=Number(input.cursor||0),size=Math.min(input.pageSize,2),rows=selected.slice(offset,offset+size),hasMore=offset+size<selected.length;
      const response={schemaVersion:state.oldBackend?1:2,accounts:rows,totalCount:input.includeTotal?selected.length:null,...(input.includeTotal?{tierCounts}:{}),hasMore,nextCursor:hasMore?String(offset+size):null};
      if(state.stale){response.totalCount=null;delete response.tierCounts;response.directoryStale=true;}
      if(state.hold.includes(key))return new Promise((resolve,reject)=>{state.pending[index]={resolve:value=>resolve(value||response),reject};});
      if(state.denial)throw Object.assign(new Error('Access revoked'),{code:state.denial});
      return response;
    }
    export const listLoyaltyRewardsAdmin=async()=>{state.rewardsCalls++;return {rewards:[]}};
    export const listLoyaltyAmbassadors=async()=>({ambassadors:[]});export const listLoyaltyAdjustments=async()=>({adjustments:[]});
    export const adjustLoyaltyBalance=async input=>{state.mutations.push(input);return new Promise(resolve=>{state.releaseAdjustment=()=>resolve({status:'applied'})})};
    export const approveAmbassadorPayout=async()=>{};export const manageAmbassadorProfile=async()=>{};export const reviewLoyaltyAdjustment=async()=>{};export const saveLoyaltyReward=async()=>{};
  ` }))
  await page.goto('/tests/loyalty-operations-ui/index.html'+query)
  await calls(page,1)
}
test('one page per request, complete tier counts and explicit continuation',async({page})=>{
  await openFixture(page)
  await expect(cards(page)).toHaveCount(2)
  await expect(page.getByRole('tab',{name:'Silver 2',exact:true})).toBeVisible()
  await expect(page.getByRole('tab',{name:'Tất cả 3',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Tải tiếp',exact:true}).click()
  await calls(page,2)
  await expect(cards(page)).toHaveCount(3)
  await expect(page.getByRole('tab',{name:'Tất cả 3',exact:true})).toBeVisible()
  expect(await page.evaluate(()=>window.loyaltyFixture.calls)).toEqual([{directoryVersion:2,pageSize:30,includeTotal:true,tier:'all',query:''},{directoryVersion:2,pageSize:30,includeTotal:false,tier:'all',query:'',cursor:'2'}])
})
test('tier and accent-insensitive search find a member beyond page 100 without draining',async({page})=>{
  await openFixture(page,'?many=1')
  await expect(cards(page)).toHaveCount(2)
  await page.getByRole('tab',{name:'Diamond 1',exact:true}).click()
  await calls(page,2)
  await expect(cards(page)).toHaveCount(1)
  await expect(cards(page)).toContainText('Thành viên 164')
  await page.getByRole('tab',{name:'Tất cả 165',exact:true}).click()
  await calls(page,3)
  await page.getByRole('textbox',{name:'Tìm thành viên'}).fill('Thanh vien 164')
  await calls(page,4)
  await expect(cards(page)).toHaveCount(1)
  expect(await page.evaluate(()=>window.loyaltyFixture.calls[3])).toMatchObject({query:'Thanh vien 164',tier:'all',includeTotal:true})
})
test('stale append cannot overwrite a new tier or finish its loading state',async({page})=>{
  await openFixture(page,'',['2','gold'])
  await page.getByRole('button',{name:'Tải tiếp',exact:true}).click()
  await calls(page,2)
  await page.getByRole('tab',{name:'Gold 1',exact:true}).click()
  await calls(page,3)
  await page.evaluate(()=>window.loyaltyFixture.pending[1].resolve())
  await expect(page.getByText('Đang tải dữ liệu…')).toBeVisible()
  await page.evaluate(()=>window.loyaltyFixture.pending[2].resolve())
  await expect(cards(page)).toHaveCount(1)
  await expect(cards(page)).toContainText('Học viên Hai')
  await expect(page.getByText('Học viên Ba',{exact:true})).toHaveCount(0)
})
test('failed continuation retries its cursor and preserves source totals',async({page})=>{
  await openFixture(page,'',['2'])
  await page.getByRole('button',{name:'Tải tiếp',exact:true}).click()
  await calls(page,2)
  await page.evaluate(()=>window.loyaltyFixture.pending[1].reject(new Error('Offline fixture')))
  await expect(page.getByRole('alert')).toContainText('Offline fixture')
  await expect(page.getByRole('tab',{name:'Silver 2',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Tải tiếp',exact:true}).click()
  await calls(page,3)
  await page.evaluate(()=>window.loyaltyFixture.pending[2].resolve())
  await expect(cards(page)).toHaveCount(3)
  expect(await page.evaluate(()=>window.loyaltyFixture.calls[2].cursor)).toBe('2')
})
test('exact deep link bypasses tier and query filters without a page scan',async({page})=>{
  await openFixture(page,'?studentId=student-far&rewards=1')
  await expect(cards(page)).toHaveCount(1)
  await expect(cards(page)).toContainText('Học viên ngoài trang đầu')
  expect(await page.evaluate(()=>window.loyaltyFixture.calls)).toEqual([{directoryVersion:2,pageSize:30,includeTotal:true,studentId:'student-far'}])
  expect(await page.evaluate(()=>window.loyaltyFixture.rewardsCalls)).toBe(0)
})
for(const code of ['functions/permission-denied','functions/unauthenticated'])test('access failure clears account state and cache: '+code,async({page})=>{
  await openFixture(page,'?rewards=1')
  await expect(cards(page)).toHaveCount(2)
  await page.evaluate(code=>{window.loyaltyFixture.denial=code},code)
  await page.getByRole('button',{name:'Tải lại tab đang mở'}).click()
  await expect(page.getByRole('alert')).toContainText('Access revoked')
  await expect(cards(page)).toHaveCount(0)
  await expect(page.getByText('Học viên Một',{exact:true})).toHaveCount(0)
  await page.evaluate(()=>{window.loyaltyFixture.denial=null;window.loyaltyFixture.generation=77})
  await page.getByRole('button',{name:'Thử lại',exact:true}).click()
  await calls(page,3)
  await expect(cards(page).filter({hasText:'Học viên Một'})).toContainText('77')
})
test('older schema is rejected and stale totals are not presented as zero',async({page})=>{
  await openFixture(page)
  await page.evaluate(()=>{window.loyaltyFixture.oldBackend=true})
  await page.getByRole('button',{name:'Tải lại tab đang mở'}).click()
  await expect(page.getByRole('alert')).toContainText('Danh sách thành viên đang được cập nhật')
  await expect(cards(page)).toHaveCount(0)
  await page.evaluate(()=>{window.loyaltyFixture.oldBackend=false;window.loyaltyFixture.stale=true})
  await page.getByRole('button',{name:'Tải lại tab đang mở'}).click()
  await expect(page.getByText('Danh sách đang đồng bộ, hãy làm mới.')).toBeVisible()
  await expect(page.getByRole('tab',{name:'Tất cả —',exact:true})).toBeVisible()
  await expect(page.getByText('— thành viên',{exact:true})).toBeVisible()
})
test('applied adjustment after unmount cannot trigger another account read',async({page})=>{
  await openFixture(page,'?adjust=1')
  await expect(cards(page)).toHaveCount(2)
  await cards(page).filter({hasText:'Học viên Một'}).getByRole('button',{name:'Điều chỉnh',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Học viên Một',exact:true})
  await dialog.getByLabel('Số điểm',{exact:true}).fill('100')
  await dialog.getByLabel('Lý do',{exact:true}).fill('Local fixture only')
  await dialog.getByRole('button',{name:'Gửi điều chỉnh',exact:true}).click()
  await expect.poll(()=>page.evaluate(()=>window.loyaltyFixture.mutations.length)).toBe(1)
  await page.evaluate(()=>{window.unmountLoyaltyOperations();window.loyaltyFixture.releaseAdjustment()})
  await expect(page.locator('#root')).toBeEmpty()
  expect(await page.evaluate(()=>window.loyaltyFixture.calls.length)).toBe(1)
})
