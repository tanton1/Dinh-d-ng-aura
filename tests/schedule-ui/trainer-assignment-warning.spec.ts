import { expect, test } from '@playwright/test'

// Lan's contract lists Mai as PT chính and Vy as PT phụ. Placing her with An
// must be visible on An's matrix itself, not only inside the slot inspector.
test('matrix warns where a learner sits outside their PT chính/phụ', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as any).__workspaceOverride = { schedule: {
      'T2-6': [{ studentId: 'a', trainerId: 't-part-time', contractId: 'c-a', branchId: 'b', type: 'training', source: 'auto_v4', trainerAssignmentWarning: true }],
      // A stale flag on Ngọc's row: Mai is her contract's PT chính today.
      'T3-6': [{ studentId: 'b', trainerId: 't', contractId: 'c-b', branchId: 'b', type: 'training', source: 'auto_v4', trainerAssignmentWarning: true }],
    } }
  })
  await page.goto('/tests/schedule-ui/index.html')
  const trainerPicker = page.getByRole('combobox', { name: 'Huấn luyện viên' })
  await expect(trainerPicker.locator('option[value="t-part-time"]')).toHaveText('An · ⚠ 1 buổi sai PT')
  await expect(trainerPicker.locator('option[value="t"]')).toHaveText('Mai')

  await trainerPicker.selectOption('t')
  const ngoc = page.locator('.schedule-cell__student').filter({ hasText: 'Ngọc' })
  await expect(ngoc).toHaveCount(1)
  await expect(ngoc).not.toHaveClass(/has-assignment-warning/)
  await expect(page.locator('.schedule-assignment-alert')).toHaveCount(0)

  await trainerPicker.selectOption('t-part-time')
  await expect(page.locator('.schedule-assignment-alert')).toHaveText('1 buổi không đúng PT chính/phụ')
  const lan = page.locator('.schedule-cell__student').filter({ hasText: 'Lan' })
  await expect(lan).toHaveClass(/has-assignment-warning/)
  await expect(lan.locator('svg[aria-label^="Cảnh báo"]')).toHaveAttribute('aria-label', 'Cảnh báo: Không đúng PT chính/phụ (PT chính Mai, PT phụ Vy)')
  const cell = page.locator('.schedule-cell').filter({ has: lan })
  await expect(cell).toHaveClass(/has-assignment-warning/)
  await expect(cell).toHaveAttribute('aria-label', /1 không đúng PT chính\/phụ/)
})
