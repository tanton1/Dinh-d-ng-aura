import { expect, test, type Page } from '@playwright/test'

const submission = {
  schemaVersion: 1, userId: 'academy-fixture-owner', courseId: 'academy-fixture', artifactId: 'chapter-01-core',
  submissionId: 'a'.repeat(64), kind: 'practice', title: 'Bản đồ quan sát dinh dưỡng', workbookRevision: 7, definitionVersion: 1, submittedAt: 1792800000000,
  definitionSnapshot: { fields: [{ id: 'context', label: 'Bối cảnh đã quan sát', kind: 'long', required: true }] },
  evidence: { answers: { context: 'Tôi quan sát ba bữa trong ngày làm việc và ghi rõ thời điểm đói. Đây là nội dung của bản đã nộp, không phải nháp mới.' }, safetyAcknowledged: true },
  rubric: { version: 1, criteria: [
    { id: 'data', label: 'Dữ liệu và bối cảnh', levels: ['Thiếu dữ kiện.', 'Cần bổ sung bối cảnh.', 'Dữ kiện và bối cảnh rõ.'] },
    { id: 'mechanism', label: 'Diễn giải kiến thức', levels: ['Cần sửa cơ chế.', 'Cần giải thích thêm.', 'Diễn giải phù hợp.'] },
    { id: 'feasibility', label: 'Tính khả thi', levels: ['Chưa rõ bước làm.', 'Thiếu cách rà.', 'Bước làm và rà rõ.'] },
    { id: 'safety', label: 'Giới hạn an toàn', levels: ['Cần sửa nguy cơ.', 'Cần bổ sung hỗ trợ.', 'Giới hạn và hỗ trợ rõ.'] },
  ] }, sourceEvidence: [],
}
const initialReview = { submissionId: submission.submissionId, reviewerId: 'coach-fixture', reviewerName: 'Coach kiểm thử', revision: 1, rubricVersion: 1,
  scores: { data: 2, mechanism: 1, feasibility: 2, safety: 1 }, verdict: 'needs-revision', feedback: 'Bạn đã mô tả thời điểm khá rõ. Hãy tách dữ liệu quan sát khỏi suy đoán, bổ sung cách tìm hỗ trợ nếu có cờ đỏ.', reviewedAt: 1792800100000 }

async function mockSubmissionService(page: Page, mode: 'student' | 'coach' | 'revoked' | 'portfolio' = 'student') {
  const calls: Array<{ action: string; input: Record<string, unknown> }> = []
  let review: object | null = mode === 'student' ? initialReview : null
  await page.route('**/src/services/academySubmissionService.ts', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    async function call(action,input) {
      const response = await fetch('/__academy_submission_fixture', {method:'POST',body:JSON.stringify({action,input})});
      const body = await response.json(); if (!response.ok) throw Object.assign(new Error(body.message),{code:body.code}); return body;
    }
    export const readAcademySubmission = input => call('read',input);
    export const listSharedAcademySubmissions = (userId,cursor) => call('list',{userId,cursor});
    export const saveAcademyCoachReview = input => call('review',input);
    export const submitAcademyPortfolio = input => call('portfolio',input);
  ` }))
  await page.route('**/__academy_submission_fixture', async (route) => {
    const call = route.request().postDataJSON(); calls.push(call)
    if (call.action === 'list') return route.fulfill({ json: { items: [{ ...submission, reviewStatus: 'not-reviewed' }], nextCursor: null } })
    if (call.action === 'review') {
      if (mode === 'revoked') return route.fulfill({ status: 403, json: { code: 'functions/permission-denied', message: 'Học viên đã dừng chia sẻ bài này.' } })
      review = { ...initialReview, ...call.input, revision: 1, reviewedAt: null }
      return route.fulfill({ json: { review, duplicate: false } })
    }
    if (call.action === 'portfolio') return route.fulfill({ json: { submissionId: 'b'.repeat(64), workbookRevision: call.input.workbookRevision, duplicate: false } })
    return route.fulfill({ json: { submission, review, latestSubmissionId: submission.submissionId } })
  })
  return calls
}

for (const width of [320, 1440]) {
  test(`learner opens immutable evidence and version-bound feedback on demand at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const calls = await mockSubmissionService(page)
    await page.goto('/tests/e2e/fixtures/academy-modules.html?scenario=submission-review')
    const panel = page.getByRole('region', { name: 'Bản đã nộp và phản hồi' })
    await expect(panel.getByRole('button', { name: 'Xem bài đã nộp và phản hồi' })).toBeVisible()
    expect(calls).toHaveLength(0)
    await panel.getByRole('button', { name: 'Xem bài đã nộp và phản hồi' }).click()
    await expect(panel).toContainText('Bản nộp từ nháp v7')
    await expect(panel).toContainText('Bạn có nháp mới hơn')
    await expect(panel).toContainText('Coach kiểm thử')
    await expect(panel).toContainText('không xác nhận năng lực chẩn đoán')
    await panel.getByText('Đọc nội dung đã nộp', { exact: true }).click()
    await expect(panel).toContainText('Tôi quan sát ba bữa')
    expect(calls).toHaveLength(1)
    await panel.getByRole('button', { name: 'Thu gọn bài đã nộp' }).click()
    await panel.getByRole('button', { name: 'Xem bài đã nộp và phản hồi' }).click()
    expect(calls).toHaveLength(1)
    await expect(panel.getByRole('button', { name: 'Lưu nhận xét cho bản này' })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
    await page.screenshot({ path: testInfo.outputPath(`learner-submission-${width}.png`), fullPage: true })
    await panel.getByRole('button', { name: 'Tải lại phản hồi mới nhất' }).click()
    await expect.poll(() => calls.length).toBe(2)
  })

  test(`coach loads only a selected shared submission and saves exact-version feedback at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const calls = await mockSubmissionService(page, 'coach')
    await page.goto('/tests/e2e/fixtures/academy-modules.html?scenario=coach-review')
    await expect(page.getByRole('button', { name: 'Tải các bài đã chia sẻ' })).toBeVisible()
    expect(calls).toHaveLength(0)
    await page.getByRole('button', { name: 'Tải các bài đã chia sẻ' }).click()
    await page.getByRole('button', { name: /Bản đồ quan sát dinh dưỡng/ }).click()
    await expect(page.getByRole('heading', { name: 'Chưa có nhận xét của coach' })).toBeVisible()
    expect(calls.map((call) => call.action)).toEqual(['list', 'read'])
    const form = page.locator('.academy-submission__review-form')
    for (const label of ['Dữ liệu và bối cảnh', 'Diễn giải kiến thức', 'Tính khả thi', 'Giới hạn an toàn']) await form.getByLabel(label, { exact: true }).selectOption('2')
    await form.getByLabel('Kết quả bài học', { exact: false }).selectOption('accepted')
    await form.getByLabel('Điểm tốt và bước tiếp theo').fill('Bài có dữ kiện và giới hạn rõ. Tiếp tục theo dõi cùng điều kiện và rà lại vào ngày đã chọn.')
    await form.getByRole('button', { name: 'Lưu nhận xét cho bản này' }).click()
    await expect(form.getByRole('status')).toContainText('Đã lưu nhận xét cho bản nộp v7')
    expect(calls.at(-1)?.input.submissionId).toBe(submission.submissionId)
    expect(calls.at(-1)?.input.expectedReviewRevision).toBe(0)
    expect(calls.map((call) => call.action)).toEqual(['list', 'read', 'review'])
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
    await form.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`coach-review-${width}.png`), fullPage: true })
  })
}

test('a revoked share clears evidence and unsaved coach feedback from the panel', async ({ page }) => {
  await mockSubmissionService(page, 'revoked')
  await page.goto('/tests/e2e/fixtures/academy-modules.html?scenario=coach-review')
  await page.getByRole('button', { name: 'Tải các bài đã chia sẻ' }).click()
  await page.getByRole('button', { name: /Bản đồ quan sát dinh dưỡng/ }).click()
  const form = page.locator('.academy-submission__review-form')
  for (const label of ['Dữ liệu và bối cảnh', 'Diễn giải kiến thức', 'Tính khả thi', 'Giới hạn an toàn']) await form.getByLabel(label, { exact: true }).selectOption('1')
  await form.getByLabel('Điểm tốt và bước tiếp theo').fill('Cần bổ sung dữ kiện và giới hạn trước khi kết luận.')
  await form.getByRole('button', { name: 'Lưu nhận xét cho bản này' }).click()
  await expect(page.getByRole('alert')).toContainText('Học viên đã dừng chia sẻ')
  await expect(form).toHaveCount(0)
  await expect(page.locator('.academy-submission__evidence')).toHaveCount(0)
})

test('portfolio submits only after explicit action, with the synchronized revision and no automatic feedback read', async ({ page }) => {
  const calls = await mockSubmissionService(page, 'portfolio')
  await page.route('**/src/services/academyLearningService.ts', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    export * from '/src/services/academyLearningService.ts?fixture-original';
    import {loadAcademyWorkbook} from '/src/services/academyLearningService.ts?fixture-original';
    export async function loadAcademyWorkbookFromCloud(owner,course,lesson) {return loadAcademyWorkbook(owner,course,lesson)}
    export async function saveAcademyWorkbook(owner,course,lesson,state) {return {...state,pendingSync:false,cloudRevision:state.cloudRevision+1}}
  ` }))
  await page.goto('/tests/e2e/fixtures/academy-modules.html?scenario=portfolio-submit')
  const portfolio = page.locator('.academy-portfolio')
  await expect(portfolio).toContainText('5/5 bài thực hành đã nộp')
  await portfolio.getByRole('button', { name: /Mở portfolio để tổng hợp/ }).click()
  for (const field of await portfolio.locator('.academy-portfolio__fields textarea').all()) await field.fill('Minh chứng và bối cảnh phù hợp cho bản tổng hợp.')
  await portfolio.locator('.academy-portfolio__review input').fill('2026-10-30')
  for (const row of await portfolio.locator('.academy-portfolio__rubric article').all()) await row.getByRole('button', { name: '2', exact: true }).click()
  await portfolio.locator('.academy-practice-safety input').check()
  await expect(portfolio.getByRole('button', { name: 'Nộp portfolio', exact: true })).toBeEnabled()
  expect(calls).toHaveLength(0)
  await portfolio.getByRole('button', { name: 'Nộp portfolio', exact: true }).click()
  await expect(portfolio.getByRole('button', { name: 'Đã nộp portfolio này' })).toBeDisabled()
  expect(calls).toHaveLength(1)
  expect(calls[0].action).toBe('portfolio')
  expect(calls[0].input.stageId).toBe(1)
  expect(calls[0].input.workbookRevision).toBeGreaterThan(0)
})
