import {expect,test} from '@playwright/test'
import {score,staff} from './fixtures'

for(const width of [390,1440]) test(`populated scorecard and its review controls remain usable at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:900})
 await page.route('**/src/contexts/AuthContext.tsx*',route=>route.fulfill({contentType:'application/javascript',body:'export function useAuth(){return {hasCapability:()=>true}}'}))
 await page.route('**/src/services/performanceScoreService.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
  export const PERFORMANCE_PROFILE_KEYS=['photo','bio','certifications','expertise','case_studies','reviews','intro_video','social_links','schedule','contact'];
  export async function listPerformanceReviewQueue(){return {rows:[],profiles:[],staff:${JSON.stringify(staff)}}}
  export async function getPerformanceStaffScore(){return ${JSON.stringify(score)}}
  const deny=async()=>{throw new Error('Unexpected business mutation in layout fixture')};
  export const savePerformanceGateAssessment=deny,savePerformanceMetricAssessment=deny,setPerformanceSnapshotLock=deny,reviewPerformanceBrandEvidence=deny,savePerformanceProfileChecklist=deny;
 `}))
 await page.goto('/tests/workforce-ui/index.html')
 await expect(page.locator('.performance-scorecard-review__summary')).toContainText('72.5')
 await expect(page.locator('.performance-scorecard-review__gates button')).toHaveCount(4)
 const fit=async()=>expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1)
 await fit()
 await page.screenshot({path:info.outputPath(`scorecard-${width}.png`),fullPage:true})
 await page.getByRole('button',{name:/Chuyên cần/}).click()
 const gate=page.getByRole('dialog')
 await expect(gate).toBeVisible()
 await fit()
 await gate.getByRole('button',{name:'Đóng',exact:true}).click()
 await page.getByRole('button',{name:'Chấm Chất lượng hướng dẫn và sửa kỹ thuật',exact:true}).click()
 const editor=page.getByRole('dialog')
 await expect(editor).toBeVisible()
 await expect(editor.getByLabel('Điểm audit /100')).toHaveValue('80')
 await fit()
 await editor.getByRole('button',{name:'Đóng',exact:true}).click()
 await page.getByRole('tab',{name:'Hồ sơ PT'}).click()
 await page.getByRole('combobox',{name:'Chọn PT',exact:true}).selectOption('pt-demo')
 await expect(page.getByRole('checkbox',{name:/Ảnh đại diện/})).toBeEnabled()
 await fit()
})
