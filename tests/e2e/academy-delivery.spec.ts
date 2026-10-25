import { test, expect, type Page } from '@playwright/test'

const url = '/tests/e2e/fixtures/academy-delivery.html'
type Call = { input: { lessonId: string; courseRevision: number; chapterVersion: string; authoringChapter?: boolean }; access: string }
function packet(call: Call) {
  const n = Number(call.input.lessonId.split('-').at(-1))
  const contentAccess = call.input.authoringChapter ? 'staff-preview' : call.access.includes('cancelled') ? 'preview' : 'full'
  return { courseId: 'delivery', courseRevision: call.input.courseRevision, chapterVersion: call.input.chapterVersion, contentAccess,
    module: { id: `module-${n}`, title: `Chương ${n}`, order: n, contentVersion: call.input.chapterVersion,
      lessons: [{ id: `reading-${n}`, title: `Bài đọc ${n}`, type: 'Bài đọc', duration: '5 phút', preview: n === 1, contentVersion: call.input.chapterVersion,
        primaryContent: { kind: 'rich-text', body: `## Nội dung chương ${n}\n\nBản ${call.input.chapterVersion} cho ${call.access}.` } }] } }
}
async function mockClient(page: Page) {
  await page.route('**/src/services/academyChapterService.ts', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    import { createAcademyChapterClient } from '/src/features/academy/chapterClient.ts';
    const client = createAcademyChapterClient({ session: () => window.__academyOwner, read: async (input, access) => {
      const response = await fetch('/__academy_chapter', { method: 'POST', body: JSON.stringify({ input, access }) });
      const value = await response.json(); window.__chapterSettled = input.lessonId;
      if (!response.ok) throw Object.assign(new Error(value.message || 'Lỗi tải chương'), { code: value.code });
      return value;
    }});
    export const loadAcademyChapter = client.load;
    export const peekAcademyChapter = client.peek;
    export const clearAcademyChapterCache = client.clear;
  ` }))
}

for (const width of [320, 1440]) test(`selected chapter loads once, keeps navigation and sends completion version at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 950 }); await mockClient(page)
  const calls: Call[] = []
  let release: () => void = () => undefined
  const wait = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/__academy_chapter', async (route) => { const data = route.request().postDataJSON(); calls.push(data); await wait; await route.fulfill({ json: packet(data) }) })
  await page.goto(url)
  await expect(page.getByRole('heading', { name: 'Đang chuẩn bị bài học…' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Đang tải chương…', exact: true })).toBeDisabled()
  await page.screenshot({ path: testInfo.outputPath(`chapter-loading-${width}.png`), fullPage: true })
  release()
  await expect(page.getByRole('heading', { name: 'Nội dung chương 1' })).toBeVisible()
  expect(calls.map((call) => call.input.lessonId)).toEqual(['reading-1'])
  await page.getByRole('button', { name: 'Mở chương 2', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Nội dung chương 2' })).toBeVisible()
  await page.getByRole('button', { name: 'Mở chương 1', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Nội dung chương 1' })).toBeVisible()
  expect(calls.map((call) => call.input.lessonId)).toEqual(['reading-1', 'reading-2'])
  await page.getByRole('button', { name: 'Hoàn thành', exact: true }).click()
  await expect(page.getByLabel('Bản hoàn thành')).toHaveText('r1_m1')
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
})

test('late chapter response cannot replace a newer selection; unchanged chapters survive a new publication', async ({ page }) => {
  await mockClient(page); const calls: Call[] = []
  let release: () => void = () => undefined
  const wait = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/__academy_chapter', async (route) => { const data = route.request().postDataJSON(); calls.push(data); if (data.input.lessonId === 'reading-2') await wait; await route.fulfill({ json: packet(data) }) })
  await page.goto(url)
  await expect(page.getByRole('heading', { name: 'Nội dung chương 1' })).toBeVisible()
  await page.getByRole('button', { name: 'Mở chương 2', exact: true }).click()
  await expect.poll(() => calls.length).toBe(2)
  await page.getByRole('button', { name: 'Mở chương 3', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Nội dung chương 3' })).toBeVisible()
  release(); await page.waitForFunction(() => (window as Window & { __chapterSettled?: string }).__chapterSettled === 'reading-2')
  await expect(page.getByRole('heading', { name: 'Nội dung chương 3' })).toBeVisible()
  await page.getByRole('button', { name: 'Xuất bản chương mới' }).click()
  await page.getByRole('button', { name: 'Mở chương 2', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Nội dung chương 2' })).toBeVisible()
  expect(calls.length).toBe(3)
  await page.getByRole('button', { name: 'Mở chương 1', exact: true }).click()
  await expect(page.getByText('Bản r2_m1 cho student-a:active.')).toBeVisible()
  expect(calls.length).toBe(4)
})

test('account and enrollment changes clear full content before any new response', async ({ page }) => {
  await mockClient(page); const calls: Call[] = []
  let release: () => void = () => undefined
  const wait = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/__academy_chapter', async (route) => { const data = route.request().postDataJSON(); calls.push(data); if (data.access.startsWith('student-b')) await wait; await route.fulfill({ json: packet(data) }) })
  await page.goto(url)
  await expect(page.getByRole('heading', { name: 'Nội dung chương 1' })).toBeVisible()
  await page.getByRole('button', { name: 'Đổi tài khoản' }).click()
  await expect(page.getByRole('heading', { name: 'Đang chuẩn bị bài học…' })).toBeVisible()
  await expect(page.getByText('Bản r1_m1 cho student-a:active.')).toHaveCount(0)
  release()
  await expect(page.getByText('Bản r1_m1 cho student-b:active.')).toBeVisible()
  await page.getByRole('button', { name: 'Mở chương 2', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Nội dung chương 2' })).toBeVisible()
  await page.getByRole('button', { name: 'Hủy ghi danh' }).click()
  await expect(page.getByRole('heading', { name: 'Nội dung chương 2' })).toHaveCount(0)
  expect(calls).toHaveLength(3)
})

test('cache expiry rechecks access and a failed refresh hides content until an explicit successful retry', async ({ page }) => {
  await page.clock.install(); await mockClient(page)
  const calls: Call[] = []; let failure = false
  await page.route('**/__academy_chapter', async (route) => {
    const data = route.request().postDataJSON(); calls.push(data)
    if (failure) return route.fulfill({ status: 403, json: { code: 'functions/permission-denied', message: 'Quyền học đã bị thu hồi' } })
    await route.fulfill({ json: packet(data) })
  })
  await page.goto(url)
  await expect(page.getByRole('heading', { name: 'Nội dung chương 1' })).toBeVisible()
  failure = true
  await page.clock.fastForward(300_050)
  await expect(page.getByRole('alert')).toContainText('chưa có quyền')
  await expect(page.getByRole('heading', { name: 'Nội dung chương 1' })).toHaveCount(0)
  expect(calls).toHaveLength(2)
  failure = false
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Nội dung chương 1' })).toBeVisible()
  expect(calls).toHaveLength(3)
})

test('staff preview uses the authoring snapshot without enabling lesson completion', async ({ page }) => {
  await mockClient(page); const calls: Call[] = []
  await page.route('**/__academy_chapter', async (route) => { const data = route.request().postDataJSON(); calls.push(data); await route.fulfill({ json: packet(data) }) })
  await page.goto(`${url}?staff`)
  await expect(page.getByRole('heading', { name: 'Nội dung chương 1' })).toBeVisible()
  expect(calls[0].input.authoringChapter).toBe(true)
  await expect(page.getByRole('button', { name: 'Hoàn thành', exact: true })).toHaveCount(0)
})

test('preview can load a later lesson while private-course preview stays locked without a chapter read', async ({ page }) => {
  await mockClient(page); const calls: Call[] = []
  await page.route('**/__academy_chapter', async (route) => {
    const data = route.request().postDataJSON(); calls.push(data)
    const value = packet(data)
    const hidden = { id: 'hidden', title: 'Bài chưa mở', type: 'Bài đọc', duration: '5 phút', preview: false, contentVersion: data.input.chapterVersion }
    await route.fulfill({ json: { ...value, module: { ...value.module, lessons: [hidden, ...value.module.lessons] } } })
  })
  await page.goto(`${url}?preview-second`)
  await expect(page.getByRole('heading', { name: 'Nội dung chương 1' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Hoàn thành', exact: true })).toHaveCount(0)
  expect(calls).toHaveLength(1)
  await page.goto(`${url}?preview-second&private`)
  await expect(page.getByRole('heading', { name: 'Nội dung chương 1' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Bắt đầu học', exact: true })).toBeVisible()
  expect(calls).toHaveLength(1)
})

async function mockLearningSubscriptions(page: Page) {
  await page.route('**/src/lib/firebase.ts', (route) => route.fulfill({ contentType: 'application/javascript', body: 'export const firebaseAuth = null; export const isFirebaseConfigured = true;' }))
  await page.route('**/src/services/firebaseService.ts', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    window.__learningCallbacks = [];
    function subscribe(kind, owner, success, failure) { window.__learningCallbacks.push({ kind, owner, success, failure }); return () => {}; }
    export const subscribeToUserProgress = (owner, success, failure) => subscribe('progress', owner, success, failure);
    export const subscribeToUserEnrollments = (owner, success, failure) => subscribe('enrollments', owner, success, failure);
  ` }))
}
async function sendLearning(page: Page, owner: string, kind: string, error?: string) {
  await page.evaluate(({ owner, kind, error }) => {
    const callbacks = (window as unknown as { __learningCallbacks: Array<{ owner: string; kind: string; success: (items: unknown[]) => void; failure: (error: Error) => void }> }).__learningCallbacks
    const callback = callbacks.filter((item) => item.owner === owner && item.kind === kind).at(-1)!
    if (error) callback.failure(new Error(error))
    else callback.success([{ userId: owner, courseId: 'delivery', status: 'active' }])
  }, { owner, kind, error })
}

test('learning progress and enrollment never render another account data, even when a detached callback arrives late', async ({ page }) => {
  await mockLearningSubscriptions(page)
  await page.goto('/tests/e2e/fixtures/academy-progress.html')
  await sendLearning(page, 'student-a', 'progress'); await sendLearning(page, 'student-a', 'enrollments')
  await expect(page.getByLabel('Dữ liệu học')).toContainText('"loading":false')
  await page.getByRole('button', { name: 'Đổi tài khoản' }).click()
  await expect(page.getByLabel('Dữ liệu học')).toContainText('"progress":[],"enrollments":[]')
  await sendLearning(page, 'student-a', 'progress'); await sendLearning(page, 'student-a', 'enrollments')
  await expect(page.getByLabel('Dữ liệu học')).not.toContainText('student-a')
  await sendLearning(page, 'student-b', 'progress'); await sendLearning(page, 'student-b', 'enrollments')
  await expect(page.getByLabel('Dữ liệu học')).toContainText('"progress":["student-b"]')
  const leaked = await page.evaluate(() => (window as unknown as { __progressRenders: Array<{ owner: string; progress: string[]; enrollments: string[] }> }).__progressRenders
    .some((item) => item.owner === 'student-b' && [...item.progress, ...item.enrollments].some((owner) => owner !== 'student-b')))
  expect(leaked).toBe(false)
  await page.getByRole('button', { name: 'Ẩn dữ liệu học' }).click()
  await expect(page.getByLabel('Dữ liệu học')).toContainText('"progress":[],"enrollments":[]')
})

test('one successful subscription cannot erase the other subscription error and retry resets the read scope', async ({ page }) => {
  await mockLearningSubscriptions(page)
  await page.goto('/tests/e2e/fixtures/academy-progress.html')
  await sendLearning(page, 'student-a', 'progress', 'Không tải được tiến độ')
  await sendLearning(page, 'student-a', 'enrollments')
  await expect(page.getByLabel('Dữ liệu học')).toContainText('Không tải được tiến độ')
  await page.getByRole('button', { name: 'Thử lại dữ liệu học' }).click()
  await expect(page.getByLabel('Dữ liệu học')).toContainText('"loading":true,"error":null,"progress":[],"enrollments":[]')
  await sendLearning(page, 'student-a', 'progress'); await sendLearning(page, 'student-a', 'enrollments')
  await expect(page.getByLabel('Dữ liệu học')).toContainText('"loading":false,"error":null')
})
