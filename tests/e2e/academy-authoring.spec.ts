import { expect, test, type Page } from '@playwright/test'

const full = (id = 'course-a', revision = 4) => ({ id, revision, contentStorage: 'chapters-v1', publishedRevision: 3,
  title: `Bản đầy đủ ${id}`, slug: id, description: 'Mô tả đầy đủ', category: 'Dinh dưỡng', level: 'Nền tảng', coach: 'Aura', duration: 'Tự học',
  outcomes: ['Hiểu nội dung'], requirements: ['Đọc kỹ'], publicationStatus: 'draft', quizAnswerKeys: {},
  settings: { accessTier: 'free', visibility: 'members', dripSchedule: 'none', completionPercent: 80, certificateEnabled: false },
  modules: [{ id: 'module', title: 'Chương đầy đủ', order: 1, lessons: [{ id: 'reading', type: 'Bài đọc', title: 'Bài học', duration: '5 phút', summary: 'Nội dung không được mất' }] }],
})
const url = '/tests/e2e/fixtures/academy-authoring.html'
async function mockServices(page: Page) {
  await page.route('**/src/services/firebaseService.ts', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    export * from '/src/services/firebaseService.ts?authoring-real';
    export async function getCourseRevisionHistory() { return []; }
    export async function loadCourseQuizAnswerKeys() { window.__legacyKeys = (window.__legacyKeys || 0) + 1; throw new Error('Must not read legacy keys'); }
    export async function transitionCoursePublicationStatus(courseId, expectedRevision, nextStatus) {
      const response = await fetch('/__academy_authoring_transition', { method: 'POST', body: JSON.stringify({ courseId, expectedRevision, nextStatus }) });
      return response.json();
    }
  ` }))
  await page.route('**/src/services/academyReadService.ts', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    export async function callAcademyReadFunction(name, input) {
      const response = await fetch('/__academy_authoring_read', { method: 'POST', body: JSON.stringify(input) });
      if (!response.ok) throw new Error('Revision đã đổi. Hãy thử tải lại.');
      const value = await response.json(); window.__authoringSettled = input.authoringCourseId; return value;
    }
  ` }))
}

test('editor gates metadata until full hydration, preserves dirty content on catalog updates and saves no stubs', async ({ page }) => {
  await mockServices(page)
  let release: () => void = () => undefined
  const wait = new Promise<void>((resolve) => { release = resolve })
  const reads: unknown[] = [], writes: ReturnType<typeof full>[] = []
  await page.route('**/__academy_authoring_read', async (route) => {
    reads.push(route.request().postDataJSON()); await wait
    await route.fulfill({ json: { course: full() } })
  })
  await page.route('**/__academy_authoring_write', async (route) => {
    const input = route.request().postDataJSON(); writes.push(input)
    await route.fulfill({ json: { courseId: input.id, revision: input.revision + 1, publishedRevision: 3 } })
  })
  await page.goto(url)
  await expect(page.getByRole('heading', { name: 'Đang tải nội dung các chương' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Lưu khóa học', exact: true })).toHaveCount(0)
  release()
  await expect(page.locator('#course-title')).toHaveValue('Bản đầy đủ course-a')
  await expect(page.getByText(/Học viên vẫn học bản đã xuất bản revision 3/)).toBeVisible()
  await page.locator('#course-title').fill('Thay đổi chưa lưu')
  await page.getByRole('button', { name: 'Cập nhật danh mục', exact: true }).click()
  await expect(page.locator('#course-title')).toHaveValue('Thay đổi chưa lưu')
  expect(reads).toHaveLength(1)
  await page.getByRole('button', { name: 'Lưu khóa học', exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].title).toBe('Thay đổi chưa lưu')
  expect(writes[0].modules[0].lessons[0].summary).toBe('Nội dung không được mất')
  expect(writes[0].modules[0]).not.toHaveProperty('contentVersion')
  expect(writes[0].revision).toBe(4, 'background catalog cannot silently advance the editor CAS')
  expect(await page.evaluate(() => (window as Window & { __legacyKeys?: number }).__legacyKeys ?? 0)).toBe(0)
})

test('failed or incomplete editor loads never show an editable empty course; retry uses current catalog revision', async ({ page }) => {
  await mockServices(page)
  const reads: { expectedRevision: number }[] = []
  await page.route('**/__academy_authoring_read', async (route) => {
    const input = route.request().postDataJSON(); reads.push(input)
    if (reads.length === 1) return route.fulfill({ status: 409 })
    const course = full('course-a', input.expectedRevision)
    if (reads.length === 2) Object.assign(course.modules[0], { contentVersion: 'metadata-not-content' })
    await route.fulfill({ json: { course } })
  })
  await page.goto(url)
  await expect(page.getByRole('alert')).toContainText('Revision đã đổi')
  await page.getByRole('button', { name: 'Cập nhật danh mục', exact: true }).click()
  await page.getByRole('button', { name: 'Thử tải lại bản đầy đủ' }).click()
  await expect(page.getByRole('alert')).toContainText('Không thể lưu dữ liệu danh mục')
  await expect(page.locator('#course-title')).toHaveCount(0)
  await page.getByRole('button', { name: 'Thử tải lại bản đầy đủ' }).click()
  await expect(page.locator('#course-title')).toHaveValue('Bản đầy đủ course-a')
  expect(reads.map((input) => input.expectedRevision)).toEqual([4, 5, 5])
})

test('late full-content response cannot overwrite a different selected course', async ({ page }) => {
  await mockServices(page)
  let release: () => void = () => undefined
  const wait = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/__academy_authoring_read', async (route) => {
    const input = route.request().postDataJSON()
    if (input.authoringCourseId === 'course-a') await wait
    await route.fulfill({ json: { course: full(input.authoringCourseId) } })
  })
  await page.goto(url)
  await expect(page.getByRole('heading', { name: 'Đang tải nội dung các chương' })).toBeVisible()
  await page.getByRole('button', { name: 'Chuyển khóa B', exact: true }).click()
  await expect(page.locator('#course-title')).toHaveValue('Bản đầy đủ course-b')
  release()
  await page.waitForFunction(() => (window as Window & { __authoringSettled?: string }).__authoringSettled === 'course-a')
  await expect(page.locator('#course-title')).toHaveValue('Bản đầy đủ course-b')
})

test('taking live publication offline retains the draft status returned by the server', async ({ page }) => {
  await mockServices(page)
  await page.route('**/__academy_authoring_read', (route) => route.fulfill({ json: { course: full() } }))
  await page.route('**/__academy_authoring_transition', (route) => route.fulfill({ json: { courseId: 'course-a', revision: 5, status: 'draft', publishedRevision: null } }))
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto(url)
  await page.getByRole('button', { name: 'Kiểm tra khóa học trước khi xuất bản' }).click()
  await page.getByRole('button', { name: 'Lưu trữ khóa học', exact: true }).click()
  await expect(page.getByText(/Học viên vẫn học bản đã xuất bản revision/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Xuất bản lại bản mới nhất' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Lưu khóa học', exact: true })).toBeEnabled()
})

test('quiz submits its chapter version and discards a late result after switching versions', async ({ page }) => {
  const calls: { chapterVersion: string }[] = []
  let release: () => void = () => undefined
  const wait = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/src/services/courseRuntimeService.ts', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    export * from '/src/services/courseRuntimeService.ts?quiz-real';
    export async function gradeCourseQuiz(input) {
      const response = await fetch('/__academy_quiz_grade', { method: 'POST', body: JSON.stringify(input) });
      const value = await response.json(); window.__quizSettled = input.chapterVersion; return value;
    }
  ` }))
  await page.route('**/__academy_quiz_grade', async (route) => {
    const input = route.request().postDataJSON(); calls.push(input)
    if (input.chapterVersion === 'r1_fixture') await wait
    await route.fulfill({ json: { passed: true, percent: 100, totalQuestions: 1, correctCount: 1 } })
  })
  await page.goto(`${url}?quiz`)
  await page.getByLabel('Có bối cảnh', { exact: true }).check()
  await page.getByRole('button', { name: /Nộp bài/ }).click()
  await expect.poll(() => calls.length).toBe(1)
  await page.getByRole('button', { name: 'Mở phiên bản mới' }).click()
  await expect(page.getByLabel('Có bối cảnh', { exact: true })).not.toBeChecked()
  release()
  await page.waitForFunction(() => (window as Window & { __quizSettled?: string }).__quizSettled === 'r1_fixture')
  await expect(page.getByLabel('Bản đã hoàn thành')).toHaveText('')
  await page.getByLabel('Có bối cảnh', { exact: true }).check()
  await page.getByRole('button', { name: /Nộp bài/ }).click()
  await expect(page.getByLabel('Bản đã hoàn thành')).toHaveText('r2_fixture')
  expect(calls.map((call) => call.chapterVersion)).toEqual(['r1_fixture', 'r2_fixture'])
})
