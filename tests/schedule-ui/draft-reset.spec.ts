import { expect, test } from '@playwright/test'

for (const nextWeek of [false, true]) {
  test(`confirmed reset clears manual bookings including locks in the ${nextWeek ? 'next' : 'current'} week`, async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as any).__workspaceOverride = { schedule: {
        'T2-6': [{ studentId: 'a', trainerId: 't', contractId: 'c-a', branchId: 'b', type: 'training', source: 'manual_v2' }],
        'T2-7': [{ studentId: 'c', trainerId: 't', contractId: 'c-c', branchId: 'b', type: 'training', source: 'manual_v2', isLocked: true }],
        'T3-6': [{ studentId: 'b', trainerId: 't', contractId: 'c-b', branchId: 'b', type: 'training', source: 'published_existing', isLocked: true }],
        'T4-6': [{ studentId: 'OFF', trainerId: 't', branchId: 'b', type: 'off', source: 'manual_v2', isLocked: true }],
      } }
    })
    await page.goto('/tests/schedule-ui/index.html')
    await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
    if (nextWeek) {
      await page.getByRole('button', { name: 'Tuần sau', exact: true }).click()
      await expect.poll(() => page.evaluate(() => (window as any).__scheduleCalls.filter((call: any) => call.operation === 'weekly-view').length)).toBe(2)
      await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
    }
    const loadedWeek = await page.evaluate(() => (window as any).__scheduleCalls.filter((call: any) => call.operation === 'weekly-view').at(-1).input.weekId)
    await page.getByLabel('Mở thêm công cụ').click()
    await page.getByRole('button', { name: /Đặt lại draft/ }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Xếp lại từ đầu tuần này?' })
    await expect(dialog).toContainText('Xóa 2 buổi nháp của 2 học viên')
    await expect(dialog).toContainText('bao gồm buổi xếp tay, tự động và buổi nháp đã khóa')
    await expect(dialog).toContainText('2 ca OFF hoặc buổi đã publish vẫn được giữ nguyên')
    await dialog.getByRole('button', { name: 'Đặt lại draft', exact: true }).click()
    await expect(dialog).toBeHidden()
    await page.getByRole('tab', { name: 'Lịch PT', exact: true }).click()
    await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(0)
    await expect(page.locator('.schedule-cell').filter({ hasText: 'Bình' })).toHaveCount(0)
    await expect(page.locator('.schedule-cell').filter({ hasText: 'Ngọc' })).toHaveCount(1)
    await expect(page.locator('.schedule-cell').filter({ hasText: 'OFF' })).toHaveCount(1)
    const commands = await page.evaluate(() => (window as any).__scheduleCalls.filter((call: any) => call.operation === 'command'))
    expect(commands).toHaveLength(1)
    expect(commands[0].input).toMatchObject({ command: 'reset_draft', branchId: 'b', weekId: loadedWeek, expectedDraftRevision: 1, payload: {} })
    await page.getByLabel('Mở thêm công cụ').click()
    await expect(page.getByRole('button', { name: /Đặt lại draft/ })).toBeDisabled()
  })
}

test('reset remains available when every unpublished manual booking is locked', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as any).__workspaceOverride = { schedule: {
      'T2-6': [{ studentId: 'a', trainerId: 't', contractId: 'c-a', branchId: 'b', type: 'training', source: 'manual_v2', isLocked: true }],
    } }
  })
  await page.goto('/tests/schedule-ui/index.html')
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
  await page.getByLabel('Mở thêm công cụ').click()
  await expect(page.getByRole('button', { name: /Đặt lại draft/ })).toBeEnabled()
  await page.getByRole('button', { name: /Đặt lại draft/ }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Xếp lại từ đầu tuần này?' })
  await expect(dialog).toContainText('Xóa 1 buổi nháp của 1 học viên')
  await dialog.getByRole('button', { name: 'Đặt lại draft', exact: true }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('tab', { name: 'Lịch PT', exact: true }).click()
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(0)
})
