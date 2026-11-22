import { expect, test, type Page } from '@playwright/test'

async function openLanEditor(page: Page) {
  await page.addInitScript(() => { (window as any).__enableScheduleListener = true })
  await page.goto('/tests/schedule-ui/index.html')
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
  await page.getByRole('tab', { name: 'Học viên', exact: true }).click()
  const student = page.locator('#schedule-student-a')
  await student.getByRole('button', { name: 'Lịch rảnh', exact: true }).click()
  const editor = student.locator('.branch-schedule__availability-editor')
  await expect(editor.getByRole('region', { name: 'Lịch rảnh của Lan' })).toBeVisible()
  return editor
}

async function changeLanSlots(page: Page, slots: string[]) {
  await page.evaluate(async (slots) => {
    const { weeklyViewFixture } = await import('/tests/schedule-ui/service.ts')
    const call = (window as any).__scheduleCalls.find((item: any) => item.operation === 'weekly-view')
    const payload = weeklyViewFixture(call.input)
    payload.students[0] = { ...payload.students[0], availableSlots: slots, availabilityRevision: 2 }
    payload.viewRevision = 2
    ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', payload)
  }, slots)
}

test('an untouched editor follows the corrected week and saves from that version', async ({ page }) => {
  const editor = await openLanEditor(page)
  await changeLanSlots(page, ['T5-6'])
  await expect(editor).toContainText('1 khung đã chọn')
  await expect(editor.getByRole('alert')).toHaveCount(0)
  await editor.getByRole('button', { name: 'Lưu lịch rảnh', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__scheduleCalls.find((item: any) => item.operation === 'save-availability')?.input))
    .toMatchObject({ availableSlots: ['T5-6'], expectedSlots: ['T5-6'], expectedRevision: 2 })
})

test('a change underneath an edit blocks saving until the latest week is loaded', async ({ page }) => {
  const editor = await openLanEditor(page)
  await editor.getByRole('button', { name: 'Thứ 2 7 giờ', exact: true }).click()
  await changeLanSlots(page, ['T5-6'])
  await expect(editor.getByRole('alert')).toContainText('vừa thay đổi')
  await expect(editor.getByRole('button', { name: 'Lưu lịch rảnh', exact: true })).toBeDisabled()
  await expect(editor).toContainText('4 khung đã chọn')
  await editor.getByRole('button', { name: 'Tải lịch mới' }).click()
  await expect(editor).toContainText('1 khung đã chọn')
  await expect(editor.getByRole('alert')).toHaveCount(0)
  await expect(editor.getByRole('button', { name: 'Lưu lịch rảnh', exact: true })).toBeEnabled()
})

test('next week can be edited and the week after next is read-only', async ({ page }) => {
  await page.goto('/tests/schedule-ui/index.html')
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
  await page.getByRole('tab', { name: 'Học viên', exact: true }).click()
  const student = page.locator('#schedule-student-a')
  const editor = student.locator('.branch-schedule__availability-editor')
  const open = async () => {
    await page.getByRole('tab', { name: 'Học viên', exact: true }).click()
    await student.getByRole('button', { name: /^Lịch rảnh/ }).click()
    await expect(editor.getByRole('region', { name: 'Lịch rảnh của Lan' })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Tuần sau', exact: true }).click()
  await open()
  await expect(editor.getByRole('button', { name: 'Lưu lịch rảnh', exact: true })).toBeEnabled()

  await page.getByRole('button', { name: 'Tuần sau', exact: true }).click()
  // An editor never survives a week switch carrying the previous week's draft.
  await expect(editor).toHaveCount(0)
  await open()
  await expect(editor).toContainText('Chỉ đăng ký lịch rảnh đến hết tuần sau')
  await expect(editor.getByRole('button', { name: 'Lưu lịch rảnh' })).toHaveCount(0)
  await expect(editor.getByRole('button', { name: 'Thứ 2 6 giờ, đã chọn', exact: true })).toBeDisabled()
})
