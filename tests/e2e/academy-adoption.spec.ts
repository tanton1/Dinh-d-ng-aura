import { expect, test, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { academyAdoptionFixture } = require('../../functions/test-support/academy-adoption-fixture')
const { getAcademyLearningDraft } = require('../../functions/generated/academy-learning-drafts.cjs')
const url = '/tests/e2e/fixtures/academy-authoring.html?adoption'
const notes = 'Đã đối chiếu nội dung, phạm vi nguồn, câu hỏi và ngưỡng an toàn; ghi nhận này chỉ thuộc dữ liệu kiểm thử.'
const deferred = () => { let release = () => undefined; const wait = new Promise<void>((resolve) => { release = resolve }); return { wait, release } }

async function setup(page: Page, options: { qualified?: boolean; adoptWait?: Promise<void>; candidateWait?: Promise<void>; loseAdoptResponse?: boolean } = {}) {
  const f = await academyAdoptionFixture({ publish: false })
  if (options.qualified) f.grant()
  const reads: any[] = [], actions: any[] = [], saves: any[] = []
  await page.route('**/src/lib/firebase.ts', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    export * from '/src/lib/firebase.ts?adoption-real';
    const listeners = new Set();
    export const firebaseAuth = { currentUser: { uid: 'editor' }, onAuthStateChanged(callback) { listeners.add(callback); queueMicrotask(() => callback(firebaseAuth.currentUser)); return () => listeners.delete(callback); } };
    window.__changeAcademyUser = (uid) => { firebaseAuth.currentUser = uid ? { uid } : null; for (const callback of listeners) callback(firebaseAuth.currentUser); };
  ` }))
  await page.route('**/src/services/firebaseService.ts', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    export * from '/src/services/firebaseService.ts?adoption-real';
    export async function getCourseRevisionHistory() { return []; }
    export async function loadCourseQuizAnswerKeys() { throw new Error('Unexpected legacy key load'); }
  ` }))
  await page.route('**/src/services/academyReadService.ts', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    export async function callAcademyReadFunction(name, input) {
      const response = await fetch('/__academy_adoption_read', { method: 'POST', body: JSON.stringify(input) });
      const result = await response.json(); window.__adoptionReadSettled = input.adoptionCandidate?.candidateId || input.learningUnitDraft || input.authoringCourseId;
      if (!response.ok) throw Object.assign(new Error(result.message), { code: result.code });
      return result;
    }
  ` }))
  await page.route('**/src/services/academyAdoptionService.ts', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    export * from '/src/services/academyAdoptionService.ts?adoption-real';
    async function command(input) {
      const response = await fetch('/__academy_adoption_action', { method: 'POST', body: JSON.stringify(input) });
      const value = await response.json(); window.__adoptionActionSettled = input.action;
      if (!response.ok) throw Object.assign(new Error(value.message), { code: value.code }); return value;
    }
    export const prepareAcademyAdoption = (courseId, chapter, expectedRevision) => command({ action: 'prepare', courseId, chapter, expectedRevision });
    export const reviewAcademyAdoption = (input) => command({ action: 'review', ...input });
    export const adoptAcademyChapter = (input) => command({ action: 'adopt', ...input });
  ` }))
  await page.route('**/__academy_adoption_read', async (route) => {
    const input = route.request().postDataJSON(); reads.push(input)
    try {
      let result
      if (input.authoringCourseId) {
        result = { course: await f.readEditor(input.expectedRevision) }
        if (input.authoringCourseId !== 'course') result.course.id = input.authoringCourseId
      } else if (input.learningUnitDraft) result = { draft: getAcademyLearningDraft(input.learningUnitDraft) }
      else {
        if (input.adoptionCandidate.candidateId && options.candidateWait) await options.candidateWait
        result = await f.adoption.readCandidate(f.request(input, 'editor'))
      }
      await route.fulfill({ json: result })
    } catch (error: any) { await route.fulfill({ status: 409, json: { message: error.message, code: error.code } }) }
  })
  await page.route('**/__academy_adoption_action', async (route) => {
    const input = route.request().postDataJSON(); actions.push(input)
    try {
      const result = await f.adoption.mutate(f.command(input, 'editor'))
      if (input.action === 'adopt' && options.adoptWait) await options.adoptWait
      if (input.action === 'adopt' && options.loseAdoptResponse) return route.abort('failed')
      await route.fulfill({ json: result })
    } catch (error: any) { await route.fulfill({ status: 409, json: { message: error.message, code: error.code } }) }
  })
  await page.route('**/__academy_authoring_write', async (route) => {
    const course = route.request().postDataJSON(); saves.push(course)
    try { await route.fulfill({ json: await f.handlers.save(f.request({ course, expectedRevision: course.revision }, 'editor')) }) }
    catch (error: any) { await route.fulfill({ status: 409, json: { message: error.message } }) }
  })
  return { ...f, reads, actions, saves }
}

async function openChapter(page: Page) {
  await page.goto(url)
  await expect(page.locator('#course-title')).toHaveValue('Làm chủ dinh dưỡng cùng AURA')
  await page.getByRole('button', { name: 'Xem bản nháp chuyên sâu 20 chương' }).click()
  await page.getByRole('button', { name: 'Chương 3', exact: true }).click()
  return page.getByRole('region', { name: 'Đề xuất nhập chương 3', exact: true })
}
async function prepare(page: Page) {
  await page.getByRole('button', { name: 'Tạo đề xuất từ bản đã lưu' }).click()
  await expect(page.getByRole('region', { name: 'Trạng thái đề xuất' })).toBeVisible()
}
async function approve(page: Page) {
  for (const label of ['Nội dung, ví dụ và phạm vi áp dụng', 'Câu hỏi, đáp án và tiêu chí bài thực hành', 'Nguồn tham khảo và giới hạn bằng chứng', 'Dấu hiệu cảnh báo và giới hạn chuyên môn']) await page.getByLabel(label, { exact: true }).check()
  await page.getByLabel('Kết luận', { exact: true }).selectOption('approved')
  await page.getByLabel('Nhận xét chuyên môn', { exact: true }).fill(notes)
  await page.getByRole('button', { name: 'Ghi nhận kết quả duyệt', exact: true }).click()
  await expect(page.getByText('Đã duyệt chuyên môn và quyền duyệt còn hiệu lực.', { exact: true })).toBeVisible()
}
async function requestAdopt(page: Page) {
  await page.getByLabel('Tôi hiểu thao tác này thay chương trong bản nháp, chưa xuất bản cho học viên.', { exact: true }).check()
  await page.getByRole('button', { name: 'Nhập chương 3 vào bản nháp', exact: true }).click()
}

test('opening a chapter does not create proposals or read candidates; non-qualified staff can inspect but not approve', async ({ page }) => {
  const f = await setup(page), panel = await openChapter(page)
  expect(f.actions).toHaveLength(0)
  expect(f.reads.filter((input) => input.adoptionCandidate)).toHaveLength(0)
  await panel.getByRole('button', { name: 'Mở đề xuất mới nhất' }).click()
  await expect(panel.getByText(/Chưa có đề xuất cho chương này/)).toBeVisible()
  await prepare(page)
  await expect(panel.getByText(/Tài khoản chưa có quyền duyệt chuyên môn còn hiệu lực/)).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Ghi nhận kết quả duyệt' })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Nhập chương 3 vào bản nháp' })).toBeDisabled()
  await panel.getByText('Checkpoint riêng: 8 câu, đáp án và giải thích', { exact: true }).click()
  await expect(panel.getByText('Chỉ người có quyền biên tập được xem đáp án ở đây.', { exact: false })).toBeVisible()
  expect(f.root().revision).toBe(1)
  expect(f.actions.map((input) => input.action)).toEqual(['prepare'])
})

test('explicit qualified review and clean-editor adoption preserve exact content through the real save validator', async ({ page }) => {
  const f = await setup(page, { qualified: true }), panel = await openChapter(page)
  await prepare(page)
  await expect(page.getByRole('button', { name: 'Ghi nhận kết quả duyệt' })).toBeDisabled()
  await approve(page)
  expect(f.root().revision).toBe(1)
  await page.locator('#course-title').fill('Chỉnh sửa chưa lưu')
  await expect(panel.getByText(/Có thay đổi chưa lưu/)).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Nhập chương 3 vào bản nháp' })).toBeDisabled()
  await expect(panel.getByRole('button', { name: 'Tạo đề xuất từ bản đã lưu' })).toBeDisabled()
  await page.locator('#course-title').fill('Làm chủ dinh dưỡng cùng AURA')
  await requestAdopt(page)
  await expect(panel.getByText(/Đã nhập chương vào bản nháp. Học viên/)).toBeVisible()
  expect(f.root().revision).toBe(2)
  expect(f.root().status).toBe('draft')
  expect(f.chapterCount()).toBe(3)
  await page.getByRole('button', { name: 'Lưu khóa học', exact: true }).click()
  await expect.poll(() => f.root().revision).toBe(3)
  expect(f.saves[0].modules[0].academyAdoption.candidateId).toBe(f.actions.find((input) => input.action === 'adopt').candidateId)
  expect(f.chapterCount()).toBe(3)
  expect(f.reads.filter((input) => input.authoringCourseId)).toHaveLength(1, 'successful adoption merges its exact chapter without re-reading the entire course')
  const normalized = f.validation.normalizeCourseDraftInput(f.saves[0])
  const candidateId = f.saves[0].modules[0].academyAdoption.candidateId
  delete normalized.course.modules[0].academyAdoption
  expect(JSON.parse(JSON.stringify(normalized.course.modules[0]))).toEqual(f.candidate(candidateId).artifact.module)
})

test('a server-revoked scientific approval cannot be used from a stale screen', async ({ page }) => {
  const f = await setup(page, { qualified: true }), panel = await openChapter(page)
  await prepare(page); await approve(page)
  f.store.get('academyScientificReviewers/editor').enabled = false
  await requestAdopt(page)
  await expect(panel.getByRole('alert')).toContainText('Quyền duyệt chuyên môn đã đổi hoặc hết hạn')
  await expect(panel.getByRole('button', { name: 'Nhập chương 3 vào bản nháp' })).toBeDisabled()
  expect(f.root().revision).toBe(1)
  await panel.getByRole('button', { name: 'Mở đề xuất mới nhất' }).click()
  await expect(panel.getByText(/Kết quả đồng ý trước đó không còn đủ hiệu lực/)).toBeVisible()
})

test('an uncertain adoption result requires explicit reconciliation and never retries or overwrites local work', async ({ page }) => {
  const f = await setup(page, { qualified: true, loseAdoptResponse: true }), panel = await openChapter(page)
  await prepare(page); await approve(page); await requestAdopt(page)
  await expect(panel.getByRole('alert')).toBeVisible()
  expect(f.root().revision).toBe(2)
  expect(f.actions.filter((input) => input.action === 'adopt')).toHaveLength(1)
  await page.locator('#course-title').fill('Giữ nội dung này')
  await panel.getByRole('button', { name: 'Mở đề xuất mới nhất' }).click()
  await expect(panel.getByText(/Đề xuất này đã có trong bản biên tập/)).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Tải bản biên tập revision 2' })).toBeDisabled()
  await expect(page.locator('#course-title')).toHaveValue('Giữ nội dung này')
  await page.locator('#course-title').fill('Làm chủ dinh dưỡng cùng AURA')
  await panel.getByRole('button', { name: 'Tải bản biên tập revision 2' }).click()
  await expect(panel.getByText(/Đã tải bản biên tập theo revision đã kiểm tra/)).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Tải bản biên tập revision 2' })).toHaveCount(0)
  expect(f.actions.filter((input) => input.action === 'adopt')).toHaveLength(1)
  expect(f.saves).toHaveLength(0)
})

test('late private candidate responses cannot enter another selected chapter', async ({ page }) => {
  const wait = deferred(), f = await setup(page, { qualified: true, candidateWait: wait.wait })
  await openChapter(page)
  await page.getByRole('button', { name: 'Tạo đề xuất từ bản đã lưu' }).click()
  await expect.poll(() => f.reads.some((input) => input.adoptionCandidate?.candidateId)).toBe(true)
  const oldId = f.actions[0] && [...f.store.keys()].find((path) => path.includes('/academyAdoptionCandidates/'))!.split('/').at(-1)
  await page.getByRole('button', { name: 'Chương 4', exact: true }).click()
  wait.release()
  await page.waitForFunction((id) => (window as any).__adoptionReadSettled === id, oldId)
  await expect(page.getByRole('region', { name: 'Đề xuất nhập chương 4' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Trạng thái đề xuất' })).toHaveCount(0)
})

test('changing account during adoption hides the old editor and ignores its late result', async ({ page }) => {
  const wait = deferred(), f = await setup(page, { qualified: true, adoptWait: wait.wait })
  await openChapter(page); await prepare(page); await approve(page); await requestAdopt(page)
  await expect.poll(() => f.actions.some((input) => input.action === 'adopt')).toBe(true)
  await expect(page.locator('#course-title')).toBeDisabled()
  await page.evaluate(() => (window as any).__changeAcademyUser('different-staff'))
  await expect(page.getByRole('heading', { name: 'Phiên đăng nhập đã thay đổi' })).toBeVisible()
  wait.release()
  await page.waitForFunction(() => (window as any).__adoptionActionSettled === 'adopt')
  await expect(page.locator('#course-title')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Trạng thái đề xuất' })).toHaveCount(0)
})

for (const width of [320, 1440]) test(`scientific review form and private checkpoint remain readable at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 })
  await setup(page, { qualified: true }); const panel = await openChapter(page)
  await prepare(page)
  await expect(panel.getByLabel('Nhận xét chuyên môn', { exact: true })).toBeVisible()
  await panel.getByRole('heading', { name: 'Ghi nhận duyệt chuyên môn', exact: true }).evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await page.screenshot({ path: info.outputPath(`scientific-review-${width}.png`) })
  const reviewNotes = panel.getByLabel('Nhận xét chuyên môn', { exact: true })
  await reviewNotes.focus()
  await reviewNotes.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  // The document uses smooth scrolling. Keep the real hit-test, but wait for
  // scrolling to settle instead of sampling an intermediate animation frame.
  await expect.poll(() => reviewNotes.evaluate((element) => {
    const box = element.getBoundingClientRect()
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element
  })).toBe(true)
  await page.screenshot({ path: info.outputPath(`review-notes-${width}.png`) })
  await panel.getByText('Checkpoint riêng: 8 câu, đáp án và giải thích', { exact: true }).click()
  await panel.locator('.academy-adoption__question').first().screenshot({ path: info.outputPath(`private-checkpoint-${width}.png`) })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
