import { expect, test, type Page } from '@playwright/test'

const url = '/tests/e2e/fixtures/academy-review.html'
async function setup(page: Page) {
  await page.route('**/src/services/academyChapterService.ts', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    import { createAcademyChapterClient } from '/src/features/academy/chapterClient.ts';
    const client = createAcademyChapterClient({ session: () => window.__academyOwner, read: async (input, access) => {
      const response = await fetch('/__review_chapter', { method: 'POST', body: JSON.stringify({ input, access }) });
      const value = await response.json(); if (!response.ok) throw Object.assign(new Error(value.message), { code: value.code }); return value;
    }});
    export const loadAcademyChapter = client.load;
    export const peekAcademyChapter = client.peek;
    export const clearAcademyChapterCache = client.clear;
  ` }))
  await page.route('**/src/services/academyLearningService.ts', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    export * from '/src/services/academyLearningService.ts?actual-review-service';
    import { loadAcademyReviewState } from '/src/services/academyLearningService.ts?actual-review-service';
    import { createAcademyReviewClient } from '/src/features/academy/reviewClient.ts';
    const client = createAcademyReviewClient({ session: () => window.__academyOwner, readLocal: loadAcademyReviewState,
      writeLocal: (owner, course, state) => localStorage.setItem('aura:academy:review:v1:' + owner + ':' + course, JSON.stringify(state)),
      readRemote: async (owner, course) => { const response = await fetch('/__review_history?owner=' + owner); if (!response.ok) throw new Error('Không tải được lịch ôn.'); return response.json(); }
    });
    export const loadAcademyReviewStateFromCloud = client.load;
  ` }))
  const calls: string[] = [], history: string[] = []
  let fail = false
  let gate: Promise<void> = Promise.resolve()
  let release: () => void = () => undefined
  await page.route('**/__review_history?*', (route) => {
    history.push(new URL(route.request().url()).searchParams.get('owner')!)
    return route.fulfill({ json: { version: 1, cards: {
      'reading-2:one': { lessonId: 'reading-2', cardId: 'one', rating: 'good', repetitions: 1, intervalDays: 1, reviewedAt: 1, dueAt: 2 },
      'reading-3:one': { lessonId: 'reading-3', cardId: 'one', rating: 'good', repetitions: 1, intervalDays: 100, reviewedAt: 1, dueAt: Date.now() + 86400000 },
    } } })
  })
  await page.route('**/__review_chapter', async (route) => {
    const { input } = route.request().postDataJSON(); calls.push(input.lessonId)
    const n = Number(input.lessonId.split('-').at(-1))
    if (n === 2) { await gate; if (fail) return route.fulfill({ status: 503, json: { code: 'functions/unavailable', message: 'Chưa tải được chương cần ôn. Hãy thử lại.' } }) }
    return route.fulfill({ json: { courseId: 'delivery', courseRevision: 1, contentAccess: 'full', chapterVersion: input.chapterVersion,
      module: { id: `module-${n}`, title: `Chương ${n}`, order: n, contentVersion: input.chapterVersion,
        lessons: [{ id: input.lessonId, title: `Bài đọc ${n}`, type: 'Bài đọc', duration: '5 phút', contentVersion: input.chapterVersion, tags: [`Chương ${n}`],
          memory: { recap: `Tóm tắt chương ${n}`, flashcards: [{ id: 'one', front: `Câu hỏi chương ${n}`, back: `Đáp án chương ${n}` }] } }] } } })
  })
  return { calls, history, fail: (value: boolean) => { fail = value }, block: () => { gate = new Promise((resolve) => { release = resolve }) }, release: () => release() }
}

test('review reads only due chapters on demand, reuses history across chapters, and never calls unlearned chapters', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 950 })
  const f = await setup(page)
  await page.goto(url)
  const queue = page.getByRole('region', { name: 'Hôm nay cần ôn' })
  await expect(page.getByText('Tóm tắt chương 1')).toBeVisible()
  await expect(queue).toContainText('Chưa tải không có nghĩa')
  expect(f.calls).toEqual(['reading-1']); expect(f.history).toEqual(['student-a'])
  f.block()
  await queue.getByRole('button', { name: 'Mở hàng đợi ôn' }).click()
  await expect(queue.getByRole('button', { name: 'Đang tải phần cần ôn…' })).toBeDisabled()
  await expect(queue).not.toContainText('Không có thẻ đến hạn')
  await page.screenshot({ path: testInfo.outputPath('review-loading-320.png'), fullPage: true })
  f.release()
  await expect(queue.getByRole('button', { name: 'Mở đáp án thẻ đang ôn' })).toContainText('Câu hỏi chương 2')
  expect(f.calls).toEqual(['reading-1', 'reading-2']); expect(f.history).toEqual(['student-a'])
  await queue.getByRole('button', { name: 'Mở đáp án thẻ đang ôn' }).click()
  await queue.getByRole('button', { name: 'Đã nhớ Tăng khoảng ôn' }).click()
  await expect(queue).toContainText('Chưa có thẻ đã học nào đến hạn')
  await queue.getByRole('button', { name: 'Thu gọn' }).click()
  await queue.getByRole('button', { name: 'Mở hàng đợi ôn' }).click()
  await expect(queue).toContainText('Chưa có thẻ đã học nào đến hạn')
  await page.getByRole('button', { name: 'Mở chương 2' }).click()
  await expect(page.getByText('Tóm tắt chương 2')).toBeVisible()
  expect(f.calls).toEqual(['reading-1', 'reading-2']); expect(f.history).toEqual(['student-a'])
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
})

test('a transient due-chapter error stays in the queue, does not claim zero, and retries without rereading history', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 950 })
  const f = await setup(page); f.fail(true)
  await page.goto(url)
  const queue = page.getByRole('region', { name: 'Hôm nay cần ôn' })
  await queue.getByRole('button', { name: 'Mở hàng đợi ôn' }).click()
  await expect(queue.getByRole('alert')).toContainText('Chưa tải được chương cần ôn')
  await expect(page.getByText('Tóm tắt chương 1')).toBeVisible()
  await expect(queue).not.toContainText('Không có thẻ đến hạn')
  await page.screenshot({ path: testInfo.outputPath('review-error-1440.png'), fullPage: true })
  f.fail(false)
  await queue.getByRole('button', { name: 'Thử tải lại phần ôn' }).click()
  await expect(queue.getByRole('button', { name: 'Mở đáp án thẻ đang ôn' })).toContainText('Câu hỏi chương 2')
  expect(f.calls).toEqual(['reading-1', 'reading-2', 'reading-2']); expect(f.history).toEqual(['student-a'])
})

test('changing chapter while its due queue loads cannot leak the old queue into the new chapter', async ({ page }) => {
  const f = await setup(page); f.block()
  await page.goto(url)
  await page.getByRole('button', { name: 'Mở hàng đợi ôn' }).click()
  await expect.poll(() => f.calls.length).toBe(2)
  await page.getByRole('button', { name: 'Mở chương 3' }).click()
  await expect(page.getByText('Tóm tắt chương 3')).toBeVisible()
  f.release()
  await expect(page.getByRole('button', { name: 'Mở đáp án thẻ đang ôn' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Hôm nay cần ôn' })).toContainText('Chưa tải không có nghĩa')
  await page.getByRole('button', { name: 'Hủy ghi danh' }).click()
  await expect(page.getByText('Chưa có quyền học.')).toBeVisible()
  await expect(page.getByText('Tóm tắt chương 3')).toHaveCount(0)
})
