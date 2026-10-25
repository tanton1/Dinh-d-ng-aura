import { expect, test, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createAcademyDraftCompiler } = require('../../functions/academy-draft-compiler')
const { normalizedAcademyTemplate, academyAuthoringValidation } = require('../../functions/test-support/academy-template-fixture')
const { academyRuntimeFixture } = require('../../functions/test-support/academy-runtime-fixture')
const { getAcademyLearningDraft } = require('../../functions/generated/academy-learning-drafts.cjs')
const { getAcademyLearningCheckpoint } = require('../../functions/generated/academy-learning-checkpoints.cjs')
const url = '/tests/e2e/fixtures/academy-learner-content.html'
const deferred = () => { let release = () => undefined; const wait = new Promise<void>((resolve) => { release = resolve }); return { wait, release } }

async function setup(page: Page) {
  const f = academyRuntimeFixture()
  const v = academyAuthoringValidation(f.context.HttpsError), original = normalizedAcademyTemplate(f.context.HttpsError)
  const compiler = createAcademyDraftCompiler({ HttpsError: f.context.HttpsError, normalize: v.normalizeCourseDraftInput,
    buildQuizContentHash: v.buildQuizContentHash, canonical: f.storage.canonical })
  const artifacts = original.course.modules.map((previousModule: any, index: number) => compiler.compile({ courseId: 'course',
    course: original.course, previousModule, previousQuizKeys: original.quizKeys,
    packet: getAcademyLearningDraft(index + 1), checkpointQuestions: getAcademyLearningCheckpoint(index + 1) }))
  const course = { ...original.course, id: 'course', revision: 1, status: 'published',
    settings: { ...original.course.settings, accessTier: 'free', visibility: 'members', dripSchedule: 'none' },
    modules: artifacts.map((artifact: any) => artifact.module) }
  // Optional legacy PDF deliberately remains; opening a chapter must not fetch it.
  course.modules[4].lessons[0].resources = [{ id: 'old-pdf', title: 'PDF tham khảo phiên bản trước', kind: 'document',
    url: 'https://aura-pdf-fixture.test/legacy.pdf' }]
  const keys = Object.assign({}, ...artifacts.map((artifact: any) => artifact.quizKeys))
  let plan = f.storage.pack({ courseId: 'course', revision: 1, course, quizKeys: keys })
  const publish = () => {
    for (const chapter of plan.chapters) f.store.set(chapter.path, chapter.document)
    f.store.set('courses/course', { ...plan.manifest, publishedSnapshot: { active: true, course: plan.manifest } })
  }
  publish()
  const calls: string[] = [], workbooks: string[] = [], pdfs: string[] = []
  let block: Promise<void> = Promise.resolve(), failChapter = 0, inFlight = 0, maximum = 0
  await page.route('**/__learner_catalog', (route) => route.fulfill({ json: { ...plan.manifest, id: 'course', contentDelivery: 'catalog',
    contentAccess: 'full', publicationStatus: 'published', modules: f.context.academyModulesForLearner(plan.manifest.modules, 'locked') } }))
  await page.route('**/src/services/academyChapterService.ts', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    import { createAcademyChapterClient } from '/src/features/academy/chapterClient.ts';
    const client = createAcademyChapterClient({ session: () => window.__academyOwner, read: async (input, access) => {
      const response = await fetch('/__learner_chapter', { method: 'POST', body: JSON.stringify({ input, access }) });
      const value = await response.json(); if (!response.ok) throw Object.assign(new Error(value.message), { code: value.code }); return value;
    }});
    export const loadAcademyChapter = client.load; export const peekAcademyChapter = client.peek; export const clearAcademyChapterCache = client.clear;
  ` }))
  await page.route('**/__learner_chapter', async (route) => {
    const { input } = route.request().postDataJSON(), chapter = Number(input.lessonId.split('-')[1])
    calls.push(input.lessonId); inFlight++; maximum = Math.max(maximum, inFlight)
    try {
      if (chapter !== 5) await block
      if (chapter === failChapter) return await route.fulfill({ status: 503, json: { code: 'functions/unavailable', message: 'Không tải được tiêu chí chương này. Hãy thử lại.' } })
      const result = await f.list({ auth: { uid: 'student', token: { role: 'student' } }, data: input })
      return await route.fulfill({ json: result })
    } catch (error: any) { return await route.fulfill({ status: 409, json: { code: `functions/${error.code}`, message: error.message } }) }
    finally { inFlight-- }
  })
  await page.route('**/src/services/academyLearningService.ts', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    export * from '/src/services/academyLearningService.ts?learner-real';
    import { loadAcademyWorkbook } from '/src/services/academyLearningService.ts?learner-real';
    export async function loadAcademyWorkbookFromCloud(owner, course, lesson, options = {}) {
      await fetch('/__learner_workbook?lesson=' + lesson);
      const local = loadAcademyWorkbook(owner, course, lesson);
      return { ...local, definitionVersion: options.definitionVersion ?? local.definitionVersion, definitionHash: options.definitionHash ?? local.definitionHash };
    }
  ` }))
  await page.route('**/__learner_workbook?*', (route) => { workbooks.push(new URL(route.request().url()).searchParams.get('lesson')!); return route.fulfill({ json: {} }) })
  await page.route('https://aura-pdf-fixture.test/**', (route) => { pdfs.push(route.request().url()); return route.abort() })
  return { calls, workbooks, pdfs, artifacts, f, maximum: () => maximum, block: (wait: Promise<void>) => { block = wait }, fail: (chapter: number) => { failChapter = chapter },
    revise: () => {
      course.modules[0].lessons[0].summary = 'Nội dung đã được cập nhật để kiểm thử phiên bản.'
      plan = f.storage.pack({ courseId: 'course', revision: 2, course, quizKeys: keys, priorCourse: plan.manifest }); publish()
    } }
}
const practice = (page: Page) => page.getByRole('navigation', { name: 'Các bước học trong chương' }).getByRole('button', { name: /Thực hành|^Làm$/ })

for (const width of [320, 1440]) test(`complete delivered text precedes optional PDF and is readable at ${width}px`, async ({ page }, testInfo) => {
  const f = await setup(page); await page.setViewportSize({ width, height: 1000 }); await page.goto(url)
  const article = page.getByRole('article', { name: 'Bài đọc đầy đủ của chương' })
  await expect(article).toBeVisible()
  const source = getAcademyLearningDraft(5)
  await expect(article).toContainText(source.unit.sections[0].paragraphs[0])
  await expect(article).toContainText(source.unit.cases[2].commonError)
  await expect(article).toContainText(source.sources.at(-1).limitations)
  expect(f.pdfs).toEqual([]); expect(f.calls).toEqual(['chapter-05-core'])
  await expect(page.locator('.academy-learning-warmup')).toContainText('Tự nhớ sau bài đọc')
  await expect(page.locator('.academy-workbook-panel')).toHaveCount(0)
  await expect(page.getByRole('tab', { name: /Tham khảo/ })).toHaveAttribute('aria-selected', 'false')
  await article.evaluate((node) => node.scrollIntoView({ block: 'start' }))
  await page.screenshot({ path: testInfo.outputPath(`full-chapter-${width}.png`) })
  const link = article.getByRole('navigation').getByRole('link').last()
  const hashBefore = await page.evaluate(() => location.hash)
  await link.click()
  expect(await page.evaluate(() => location.hash)).toBe(hashBefore)
  await expect(article.locator('h4').last()).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath(`chapter-sources-${width}.png`) })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
  await page.getByRole('navigation', { name: 'Các bước học trong chương' }).getByRole('button', { name: /Kiểm tra|^Kiểm$/ }).click()
  await expect(page.getByText('Đã lưu lần hoàn thành trước;', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nộp bài kiểm tra', exact: true })).toBeEnabled()
})

test('all twenty compiled chapters expose every authored section, example, case and source without legacy replacements', async ({ page }) => {
  test.setTimeout(120_000)
  const f = await setup(page); await page.goto(url)
  for (let chapter = 1; chapter <= 20; chapter++) {
    await page.getByRole('navigation', { name: 'Điều khiển kiểm thử' }).getByRole('button', { name: `Mở chương ${chapter}`, exact: true }).click()
    const article = page.getByRole('article', { name: 'Bài đọc đầy đủ của chương' }), source = getAcademyLearningDraft(chapter)
    await expect(article).toContainText(source.unit.title)
    const text = await article.innerText()
    for (const expected of [source.unit.scope, ...source.unit.sections.flatMap((item: any) => [...item.paragraphs, ...item.takeaways]),
      ...source.unit.workedExamples.flatMap((item: any) => [item.prompt, ...item.steps, item.answer, item.limitation]),
      ...source.unit.cases.flatMap((item: any) => [item.context, ...item.reasoning, item.safeNextStep, item.commonError]),
      ...source.unit.safety, ...source.sources.flatMap((item: any) => [item.title, item.supports, item.limitations])]) {
      expect(text.replace(/\s+/g, ' ')).toContain(expected.replace(/\s+/g, ' '))
    }
    expect(await article.locator('a[target="_blank"]').count()).toBeGreaterThanOrEqual(source.sources.length)
  }
  expect(new Set(f.calls).size).toBe(20); expect(f.calls.length).toBeLessThanOrEqual(20); expect(f.pdfs).toEqual([])
})

test('portfolio loads only five definitions on explicit opening, reuses cache and never counts previous-version submissions', async ({ page }, testInfo) => {
  const f = await setup(page), gate = deferred(); f.block(gate.wait)
  await page.setViewportSize({ width: 320, height: 1000 }); await page.goto(url); await practice(page).click()
  const portfolio = page.locator('.academy-portfolio')
  await expect(portfolio).toContainText('Chưa đối chiếu đủ tiêu chí năm chương')
  await expect(portfolio).not.toContainText('5/5 bài thực hành đã nộp')
  expect(f.calls).toEqual(['chapter-05-core']); expect(f.workbooks).toEqual(['chapter-05-core'])
  await portfolio.getByRole('button', { name: /Mở portfolio để tổng hợp/ }).click()
  await expect(portfolio).toContainText('Đang tải tiêu chí của năm chương')
  await expect(portfolio.getByRole('button', { name: 'Nộp portfolio', exact: true })).toBeDisabled()
  await page.screenshot({ path: testInfo.outputPath('portfolio-unknown-320.png') })
  gate.release()
  await expect(portfolio).toContainText('0/5 bài thực hành đã nộp theo yêu cầu hiện tại')
  await expect(portfolio.locator('.academy-portfolio__artifacts')).toContainText('Đã nộp phiên bản trước')
  expect(f.calls).toEqual(['chapter-05-core', 'chapter-01-core', 'chapter-02-core', 'chapter-03-core', 'chapter-04-core'])
  await expect.poll(() => f.workbooks.length).toBe(6) // selected + portfolio + four source drafts
  expect(f.maximum()).toBeLessThanOrEqual(2)
  await portfolio.getByRole('button', { name: /Thu gọn portfolio/ }).click()
  await portfolio.getByRole('button', { name: /Mở portfolio để tổng hợp/ }).click()
  expect(f.calls.length).toBe(5); expect(f.workbooks.length).toBe(6)
  await portfolio.evaluate((node) => node.scrollIntoView({ block: 'start' }))
  await page.screenshot({ path: testInfo.outputPath('portfolio-versioned-320.png') })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
})

test('partial definition failure is not zero work and retry reuses successful immutable chapters', async ({ page }) => {
  const f = await setup(page); f.fail(2); await page.goto(url); await practice(page).click()
  const portfolio = page.locator('.academy-portfolio')
  await portfolio.getByRole('button', { name: /Mở portfolio để tổng hợp/ }).click()
  await expect(portfolio.getByRole('alert')).toContainText('Không tải được tiêu chí')
  await expect(portfolio).not.toContainText('0/5 bài thực hành đã nộp')
  expect(f.workbooks).not.toContain('chapter-01-core')
  f.fail(0); await portfolio.getByRole('button', { name: 'Tải lại tiêu chí chặng' }).click()
  await expect(portfolio).toContainText('0/5 bài thực hành đã nộp theo yêu cầu hiện tại')
  expect(f.calls.filter((id) => id === 'chapter-01-core')).toHaveLength(1)
  expect(f.calls.filter((id) => id === 'chapter-02-core')).toHaveLength(2)
})

test('changing selection while loading a portfolio stops later batches and cannot overwrite the new chapter', async ({ page }) => {
  const f = await setup(page), gate = deferred(); f.block(gate.wait)
  await page.goto(url); await practice(page).click()
  await page.getByRole('button', { name: /Mở portfolio để tổng hợp/ }).click()
  await expect.poll(() => f.calls.length).toBe(3)
  await page.getByRole('navigation', { name: 'Điều khiển kiểm thử' }).getByRole('button', { name: 'Mở chương 6', exact: true }).click()
  gate.release()
  await expect(page.getByRole('article', { name: 'Bài đọc đầy đủ của chương' })).toContainText(getAcademyLearningDraft(6).unit.title)
  expect(f.calls).not.toContain('chapter-03-core'); expect(f.calls).not.toContain('chapter-04-core')
  await expect(page.locator('.academy-portfolio')).toHaveCount(0)
})

test('revoked enrollment while definitions load cannot display portfolio or start remaining batches', async ({ page }) => {
  const f = await setup(page), gate = deferred(); f.block(gate.wait)
  await page.goto(url); await practice(page).click(); await page.getByRole('button', { name: /Mở portfolio để tổng hợp/ }).click()
  await expect.poll(() => f.calls.length).toBe(3)
  f.f.store.get('enrollments/student_course').status = 'cancelled'
  await page.getByRole('button', { name: 'Hủy ghi danh', exact: true }).click(); gate.release()
  await expect(page.locator('.academy-portfolio')).toHaveCount(0)
  expect(f.calls).not.toContain('chapter-03-core'); expect(f.calls).not.toContain('chapter-04-core')
})

test('catalog revision invalidates only the changed chapter in the five-chapter portfolio', async ({ page }) => {
  const f = await setup(page); await page.goto(url); await practice(page).click()
  await page.getByRole('button', { name: /Mở portfolio để tổng hợp/ }).click()
  await expect(page.locator('.academy-portfolio')).toContainText('0/5 bài thực hành đã nộp theo yêu cầu hiện tại')
  f.revise(); await page.getByRole('button', { name: 'Tải danh mục mới', exact: true }).click()
  await expect(page.getByLabel('Lượt tải danh mục')).toHaveText('2')
  await page.getByRole('button', { name: /Mở portfolio để tổng hợp/ }).click()
  await expect(page.locator('.academy-portfolio')).toContainText('0/5 bài thực hành đã nộp theo yêu cầu hiện tại')
  expect(f.calls.filter((id) => id === 'chapter-01-core')).toHaveLength(2)
  for (const n of [2, 3, 4, 5]) expect(f.calls.filter((id) => id === `chapter-0${n}-core`)).toHaveLength(1)
})

test('new account cannot receive a previous account portfolio response or resume its remaining batches', async ({ page }) => {
  const f = await setup(page), gate = deferred(); f.block(gate.wait)
  await page.goto(url); await practice(page).click(); await page.getByRole('button', { name: /Mở portfolio để tổng hợp/ }).click()
  await expect.poll(() => f.calls.length).toBe(3)
  await page.getByRole('button', { name: 'Đổi tài khoản', exact: true }).click(); gate.release()
  await expect(page.getByRole('article', { name: 'Bài đọc đầy đủ của chương' })).toBeVisible()
  await practice(page).click()
  await expect(page.locator('.academy-portfolio')).toContainText('Chưa đối chiếu đủ tiêu chí năm chương')
  await expect(page.getByRole('button', { name: /Mở portfolio để tổng hợp/ })).toHaveAttribute('aria-expanded', 'false')
  expect(f.calls.filter((id) => id === 'chapter-05-core')).toHaveLength(2)
  expect(f.calls).not.toContain('chapter-03-core'); expect(f.calls).not.toContain('chapter-04-core')
})

test('expired portfolio criteria become unknown without background chapter prefetch and explicit retry reloads only the stage', async ({ page }) => {
  await page.clock.install()
  const f = await setup(page); await page.goto(url); await practice(page).click()
  const portfolio = page.locator('.academy-portfolio')
  await portfolio.getByRole('button', { name: /Mở portfolio để tổng hợp/ }).click()
  await expect(portfolio).toContainText('0/5 bài thực hành đã nộp theo yêu cầu hiện tại')
  await page.clock.runFor(301_000)
  await expect(portfolio).toContainText('Chưa đối chiếu đủ tiêu chí năm chương')
  // The selected chapter's access TTL expires first. Its reload intentionally
  // remounts the studio and closes the portfolio, retaining the saved draft.
  await expect(portfolio.getByRole('button', { name: 'Nộp portfolio', exact: true })).toHaveCount(0)
  await expect(portfolio.getByRole('button', { name: /Mở portfolio để tổng hợp/ })).toHaveAttribute('aria-expanded', 'false')
  expect(f.calls.filter((id) => id !== 'chapter-05-core')).toHaveLength(4)
  await portfolio.getByRole('button', { name: /Mở portfolio để tổng hợp/ }).click()
  await expect(portfolio).toContainText('0/5 bài thực hành đã nộp theo yêu cầu hiện tại')
  for (const n of [1, 2, 3, 4]) expect(f.calls.filter((id) => id === `chapter-0${n}-core`)).toHaveLength(2)
})

test('leaving the course during a portfolio read does not continue downloading the remaining chapters', async ({ page }) => {
  const f = await setup(page), gate = deferred(); f.block(gate.wait)
  await page.goto(url); await practice(page).click(); await page.getByRole('button', { name: /Mở portfolio để tổng hợp/ }).click()
  await expect.poll(() => f.calls.length).toBe(3)
  await page.getByRole('button', { name: 'Rời khóa học', exact: true }).click(); gate.release()
  await expect(page.getByText('Đã rời khóa học', { exact: true })).toBeVisible()
  await expect(page.locator('.academy-portfolio')).toHaveCount(0)
  await expect.poll(() => f.maximum()).toBe(2)
  // Both already-started responses settle; no new batch may be issued.
  await expect.poll(() => f.f.transactionReads.filter((paths: string[]) => paths.some((path) => path.includes('/academyChapterVersions/'))).length).toBe(3)
  expect(f.calls).toEqual(['chapter-05-core', 'chapter-01-core', 'chapter-02-core'])
})
