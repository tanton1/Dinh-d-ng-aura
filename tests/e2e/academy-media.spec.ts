import { test, expect, type Page } from '@playwright/test'
const url = '/tests/e2e/fixtures/academy-media.html'
type Call = { input: { path: string; courseId: string; lessonId: string; chapterVersion: string; courseRevision: number; authoringPreview?: boolean }; owner: string }
async function setup(page: Page) {
  await page.route('**/src/services/courseRuntimeService.ts', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    export * from '/src/services/courseRuntimeService.ts?media-real';
    import { safeCourseMediaUrl } from '/src/services/courseRuntimeService.ts?media-real';
    import { createAcademyMediaClient } from '/src/features/academy/mediaClient.ts';
    const client = createAcademyMediaClient({ session: () => window.__mediaOwner, safeUrl: safeCourseMediaUrl,
      read: async (input) => { const response = await fetch('/__media_lease', { method: 'POST', body: JSON.stringify({ input, owner: window.__mediaOwner.uid }) });
        const value = await response.json(); if (!response.ok) throw Object.assign(new Error(value.message), { code: value.code }); return value;
      } });
    export const getCourseMediaUrl = client.load;
    export const clearAcademyMediaCache = client.clear;
  ` }))
  const calls: Call[] = []
  let denied = false, gate = Promise.resolve(), release: () => void = () => undefined
  await page.route('**/__media_lease', async (route) => {
    const call = route.request().postDataJSON() as Call; calls.push(call)
    if (call.input.courseRevision > 1) await gate
    if (denied) return route.fulfill({ status: 403, json: { code: 'functions/permission-denied', message: 'Quyền đã đổi' } })
    const path = `https://aura-media-fixture.test/${call.owner}/${call.input.chapterVersion}/guide.pdf`
    const expiresAt = await page.evaluate(() => new Date(Date.now() + 300000).toISOString())
    return route.fulfill({ json: { ...call.input, url: path, downloadUrl: `${path}?download=1`,
      contentType: new URL(page.url()).searchParams.has('video') ? 'video/mp4' : 'application/pdf',
      contentAccess: call.input.authoringPreview ? 'staff-preview' : 'full', expiresAt } })
  })
  return { calls, deny: (value: boolean) => { denied = value }, block: () => { gate = new Promise((resolve) => { release = resolve }) }, release: () => release() }
}
function pdf() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << >> /Contents 4 0 R >>', '<< /Length 0 >>\nstream\n\nendstream']
  let value = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((body, index) => { offsets.push(Buffer.byteLength(value)); value += `${index + 1} 0 obj\n${body}\nendobj\n` })
  const xref = Buffer.byteLength(value)
  value += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(value)
}
test('two resource views share one authorized lease and reopening within its TTL does not reread', async ({ page }) => {
  const f = await setup(page); await page.goto(`${url}?twice`)
  await expect(page.locator('a[href*="r1_c1"]')).toHaveCount(4)
  expect(f.calls).toHaveLength(1)
  await page.getByRole('button', { name: 'Ẩn hiện tài liệu' }).click()
  await expect(page.locator('a[href*="r1_c1"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Ẩn hiện tài liệu' }).click()
  await expect(page.locator('a[href*="r1_c1"]')).toHaveCount(4)
  expect(f.calls).toHaveLength(1)
})
test('chapter and account changes hide old links immediately and ignore late old-session results', async ({ page }) => {
  const f = await setup(page); await page.goto(url)
  await expect(page.locator('a[href*="media-a/r1_c1"]')).toHaveCount(2)
  f.block(); await page.getByRole('button', { name: 'Đổi phiên bản' }).click()
  await expect(page.locator('a')).toHaveCount(0)
  await expect.poll(() => f.calls.length).toBe(2)
  await page.getByRole('button', { name: 'Đổi tài khoản' }).click()
  await expect.poll(() => f.calls.length).toBe(3)
  f.release()
  await expect(page.locator('a[href*="media-b/r2_c1"]')).toHaveCount(2)
  await expect(page.locator('a[href*="media-a"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Thu hồi quyền' }).click()
  await expect(page.locator('a')).toHaveCount(0)
  expect(f.calls).toHaveLength(3)
})
test('lease refresh denial removes links and explicit retry refreshes catalog before recovering', async ({ page }) => {
  await page.clock.install(); const f = await setup(page)
  await page.goto(url); await expect(page.locator('a')).toHaveCount(2)
  f.deny(true); await page.clock.fastForward(270050)
  await expect(page.getByRole('alert')).toContainText('chưa có quyền')
  await expect(page.locator('a')).toHaveCount(0)
  expect(f.calls).toHaveLength(2)
  f.deny(false); await page.getByRole('button', { name: 'Thử tải lại Tài liệu kiểm thử' }).click()
  await expect(page.locator('a')).toHaveCount(2)
  await expect(page.getByLabel('Số lần làm mới danh mục')).toHaveText('1')
  expect(f.calls).toHaveLength(3)
})
test('primary PDF renders through one lease without a second child-reader request and staff preview binds its revision', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 950 })
  const f = await setup(page)
  await page.route('https://aura-media-fixture.test/**', (route) => route.fulfill({ contentType: 'application/pdf', headers: { 'access-control-allow-origin': '*' }, body: pdf() }))
  await page.goto(`${url}?pdf&staff`)
  await expect(page.getByRole('combobox', { name: 'Chọn trang PDF' })).toBeVisible()
  await expect(page.getByText(/Đang hiển thị trang/)).toHaveCount(0)
  await expect(page.locator('canvas')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(f.calls).toHaveLength(1)
  expect(f.calls[0].input.authoringPreview).toBe(true)
  expect(f.calls[0].input.chapterVersion).toBe('r1_c1')
  expect(f.calls[0].input.courseRevision).toBe(1)
  await page.screenshot({ path: testInfo.outputPath('versioned-pdf-320.png') })
  await page.getByRole('button', { name: 'Thu hồi quyền' }).click()
  await expect(page.locator('canvas')).toHaveCount(0)
  expect(f.calls).toHaveLength(1)
})
test('video source is bound to the displayed version and is removed while the new version is resolving', async ({ page }) => {
  const f = await setup(page)
  await page.route('https://aura-media-fixture.test/**', (route) => route.fulfill({ status: 404 }))
  await page.goto(`${url}?video`)
  await expect(page.locator('video')).toHaveAttribute('src', /r1_c1/)
  f.block(); await page.getByRole('button', { name: 'Đổi phiên bản' }).click()
  await expect(page.locator('video')).toHaveCount(0)
  f.release(); await expect(page.locator('video')).toHaveAttribute('src', /r2_c1/)
  expect(f.calls).toHaveLength(2)
})
