import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const full = (id = 'course-a') => ({ id, revision: 4, contentStorage: 'chapters-v1', publishedRevision: 3,
  title: `Bản đầy đủ ${id}`, slug: id, description: 'Mô tả đầy đủ', category: 'Dinh dưỡng', level: 'Nền tảng', coach: 'Aura', duration: '4 tuần',
  outcomes: ['Hiểu nội dung'], requirements: ['Đọc kỹ'], publicationStatus: 'draft', quizAnswerKeys: {},
  settings: { accessTier: 'free', visibility: 'members', dripSchedule: 'none', completionPercent: 80, certificateEnabled: false },
  modules: [{ id: 'module', title: 'Chương đầy đủ', order: 1, lessons: [{ id: 'quiz', type: 'Quiz', title: 'Kiến thức kiểm thử', duration: '5 phút', summary: 'Nội dung gốc',
    quiz: { id: 'quiz', questionOrder: 'sequential', passPercent: 70, questions: [] } }] }],
})
const url = '/tests/e2e/fixtures/academy-authoring.html'
const deferred = () => { let release = () => {}; const wait = new Promise<void>(resolve => { release = resolve }); return { release, wait } }
async function setup(context: BrowserContext, options: { wait?: Promise<void>; loseResponse?: boolean; unknownFirst?: boolean } = {}) {
  const calls: Array<{ action: string; requestId: string; payload: Record<string, unknown> }> = []
  const receipts = new Map<string, { status: 'processing' | 'completed' | 'unknown'; response?: unknown }>()
  let providers = 0, lost = false
  await context.route('**/src/lib/firebase.ts', route => route.fulfill({ contentType: 'application/javascript', body: `
    export * from '/src/lib/firebase.ts?content-ai-real';
    const listeners = new Set();
    export const firebaseAuth = { currentUser: { uid: 'editor' }, onAuthStateChanged(callback) { listeners.add(callback); queueMicrotask(() => callback(firebaseAuth.currentUser)); return () => listeners.delete(callback); } };
    window.__changeContentAiUser = uid => { firebaseAuth.currentUser = uid ? { uid } : null; for (const callback of listeners) callback(firebaseAuth.currentUser); };
  ` }))
  await context.route('**/src/lib/firebaseFunctions.ts', route => route.fulfill({ contentType: 'application/javascript', body: `
    export * from '/src/lib/firebaseFunctions.ts?content-ai-real'; export const firebaseFunctions = {};
  ` }))
  // Replace only the transport import in the real transformed service. The
  // production request coordinator, hashing, storage and single-flight run.
  await context.route('**/src/services/generativeAiService.ts', async route => {
    const original = await route.fetch(), body = await original.text()
    const transport = /import\s*\{\s*httpsCallable\s*\}\s*from\s*["'][^"']+["'];?/
    if (!transport.test(body)) throw Error('Expected callable transport import')
    await route.fulfill({ response: original, body: body.replace(transport, `
      const httpsCallable = (_functions, name) => async input => {
        if (name !== 'generateAuraContent') throw new Error('Unexpected callable');
        const response = await fetch('/__content_ai_request', { method: 'POST', body: JSON.stringify(input) });
        const result = await response.json();
        if (!response.ok) throw Object.assign(new Error(result.message || result.code), { code: result.code, details: result.details });
        return { data: result };
      };
    `) })
  })
  await context.route('**/src/services/firebaseService.ts', route => route.fulfill({ contentType: 'application/javascript', body: `
    export * from '/src/services/firebaseService.ts?content-ai-real';
    export async function getCourseRevisionHistory() { return []; }
    export async function loadCourseQuizAnswerKeys() { throw new Error('Unexpected legacy key load'); }
  ` }))
  await context.route('**/src/services/academyReadService.ts', route => route.fulfill({ contentType: 'application/javascript', body: `
    export async function callAcademyReadFunction(name, input) {
      const response = await fetch('/__content_ai_course', { method: 'POST', body: JSON.stringify(input) }); return response.json();
    }
  ` }))
  await context.route('**/__content_ai_course', route => route.fulfill({ json: { course: full(route.request().postDataJSON().authoringCourseId) } }))
  await context.route('**/__content_ai_request', async route => {
    const input = route.request().postDataJSON(); calls.push(input)
    const key = `${input.expectedOwnerUid}:${input.requestId}`, previous = receipts.get(key)
    const fail = (kind: string, code: string, message: string) => route.fulfill({ status: 409, json: { code, message, details: { kind, requestId: input.requestId, retryAfterMs: 1000, maxPollAttempts: 12 } } })
    if (previous?.status === 'completed') return route.fulfill({ json: previous.response })
    if (previous?.status === 'unknown') return fail('content_ai_outcome_unknown', 'functions/failed-precondition', 'Chưa xác định được kết quả yêu cầu AI trước.')
    if (previous?.status === 'processing') return fail('content_ai_processing', 'functions/aborted', 'Đang xử lý yêu cầu trước.')
    if (input.action === 'request-status') return fail('content_ai_not_started', 'functions/not-found', 'Chưa bắt đầu.')
    providers++; const number = providers
    receipts.set(key, { status: 'processing' })
    if (options.wait) await options.wait
    if (options.unknownFirst && providers === 1) {
      receipts.set(key, { status: 'unknown' })
      return route.fulfill({ status: 503, json: { code: 'functions/unavailable', message: 'Lost provider response' } })
    }
    const data = input.action === 'course-outline'
      ? { title: 'AI course', modules: [{ title: `Chương AI ${number}`, lessons: [{ title: 'Bài AI', summary: 'Generated fixture' }] }] }
      : { questions: [{ question: `Câu hỏi AI ${number}`, options: ['A', 'B'], correctIndex: 0, explanation: 'Synthetic fixture' }] }
    const response = { action: input.action, data, receipt: { schemaVersion: 1, requestId: input.requestId, status: 'completed' } }
    receipts.set(key, { status: 'completed', response })
    if (options.loseResponse && !lost) { lost = true; return route.fulfill({ status: 503, json: { code: 'functions/deadline-exceeded', message: 'Lost client response' } }) }
    await route.fulfill({ json: response })
  })
  return { calls, providers: () => providers }
}
async function openQuiz(page: Page) {
  await page.goto(url)
  await expect(page.locator('#course-title')).toHaveValue('Bản đầy đủ course-a')
  await page.getByRole('button', { name: /^2\. (Chương & Bài học|Nội dung)/ }).click()
  await expect(page.getByRole('button', { name: 'AI Tạo câu hỏi', exact: true })).toBeVisible()
}
const questions = (page: Page) => page.getByRole('textbox', { name: /^Nội dung câu hỏi \d+$/ })

test('recovered quiz is not appended twice, preserves edits, and a new draft survives reload', async ({ page, context }) => {
  const f = await setup(context); await openQuiz(page)
  await page.getByRole('button', { name: 'AI Tạo câu hỏi', exact: true }).click()
  await expect(questions(page)).toHaveCount(1)
  await questions(page).first().fill('Giảng viên đã chỉnh sửa')
  await page.getByRole('button', { name: 'AI Tạo câu hỏi', exact: true }).click()
  await expect(page.getByRole('button', { name: 'AI Tạo câu hỏi', exact: true })).toBeEnabled()
  await expect(questions(page)).toHaveCount(1)
  await expect(questions(page).first()).toHaveValue('Giảng viên đã chỉnh sửa')
  expect(f.providers()).toBe(1)
  await page.getByRole('button', { name: 'Tạo bộ câu hỏi AI khác' }).click()
  await expect(questions(page)).toHaveCount(2)
  expect(f.providers()).toBe(2)
  const newId = f.calls.at(-1)?.requestId
  await openQuiz(page)
  await page.getByRole('button', { name: 'AI Tạo câu hỏi', exact: true }).click()
  await expect(questions(page)).toHaveCount(1)
  await expect(questions(page).first()).toHaveValue('Câu hỏi AI 2')
  expect(f.providers()).toBe(2)
  expect(f.calls.at(-1)?.requestId).toBe(newId)
  expect(f.calls.at(-1)?.action).toBe('request-status')
})

test('a lost success is recovered read-only and idle time issues no further AI calls', async ({ page, context }) => {
  const f = await setup(context, { loseResponse: true }); await openQuiz(page)
  await page.clock.install()
  await page.getByRole('button', { name: 'AI Tạo câu hỏi', exact: true }).click()
  await expect(questions(page)).toHaveCount(1)
  expect(f.providers()).toBe(1)
  expect(f.calls.map(call => call.action)).toEqual(['course-quiz', 'request-status'])
  await page.clock.fastForward(60 * 60 * 1000)
  expect(f.calls).toHaveLength(2)
})

test('two browser tabs recover the same pending generation', async ({ page, context }) => {
  const gate = deferred(), f = await setup(context, { wait: gate.wait })
  await openQuiz(page)
  const other = await context.newPage(); await openQuiz(other)
  await page.getByRole('button', { name: 'AI Tạo câu hỏi', exact: true }).click()
  await expect.poll(f.providers).toBe(1)
  await other.getByRole('button', { name: 'AI Tạo câu hỏi', exact: true }).click()
  await expect.poll(() => f.calls.some(call => call.action === 'request-status')).toBe(true)
  gate.release()
  await expect(questions(page)).toHaveCount(1)
  await expect(questions(other)).toHaveCount(1)
  expect(f.providers()).toBe(1)
  expect(new Set(f.calls.map(call => call.requestId)).size).toBe(1)
})

test('a late generation cannot modify a different course', async ({ page, context }) => {
  const gate = deferred(), f = await setup(context, { wait: gate.wait }); await openQuiz(page)
  await page.getByRole('button', { name: 'AI Tạo câu hỏi', exact: true }).click()
  await expect.poll(f.providers).toBe(1)
  await page.getByRole('button', { name: 'Chuyển khóa B' }).click()
  await expect(page.locator('#course-title')).toHaveValue('Bản đầy đủ course-b')
  gate.release()
  await page.getByRole('button', { name: /^2\. (Chương & Bài học|Nội dung)/ }).click()
  await expect(page.getByRole('button', { name: 'AI Tạo câu hỏi', exact: true })).toBeEnabled()
  await expect(questions(page)).toHaveCount(0)
  expect(f.providers()).toBe(1)
})

test('edits made during a generation are preserved and its result remains recoverable', async ({ page, context }) => {
  const gate = deferred(), f = await setup(context, { wait: gate.wait }), alerts: string[] = []
  page.on('dialog', async dialog => { alerts.push(dialog.message()); await dialog.accept() })
  await openQuiz(page)
  await page.getByRole('button', { name: 'AI Tạo câu hỏi', exact: true }).click()
  await expect.poll(f.providers).toBe(1)
  await page.getByRole('textbox', { name: 'Mô tả bài học', exact: true }).fill('Chỉnh sửa trong lúc chờ')
  gate.release()
  await expect.poll(() => alerts.some(text => text.includes('đã thay đổi'))).toBe(true)
  await expect(questions(page)).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Mô tả bài học', exact: true })).toHaveValue('Chỉnh sửa trong lúc chờ')
  await page.getByRole('textbox', { name: 'Mô tả bài học', exact: true }).fill('Nội dung gốc')
  await page.getByRole('button', { name: 'AI Tạo câu hỏi', exact: true }).click()
  await expect(questions(page)).toHaveCount(1)
  expect(f.providers()).toBe(1)
})

test('unknown outcomes remain read-only until an explicit new-draft action', async ({ page, context }) => {
  const f = await setup(context, { unknownFirst: true }), alerts: string[] = []
  page.on('dialog', async dialog => { alerts.push(dialog.message()); await dialog.accept() })
  await openQuiz(page)
  await page.getByRole('button', { name: 'AI Tạo câu hỏi', exact: true }).click()
  await expect.poll(() => alerts.length).toBe(1)
  await page.getByRole('button', { name: 'AI Tạo câu hỏi', exact: true }).click()
  await expect.poll(() => alerts.length).toBe(2)
  expect(f.providers()).toBe(1)
  expect(f.calls.map(call => call.action)).toEqual(['course-quiz', 'request-status', 'request-status'])
  await page.getByRole('button', { name: 'Tạo bộ câu hỏi AI khác' }).click()
  await expect(questions(page)).toHaveCount(1)
  expect(f.providers()).toBe(2)
})
