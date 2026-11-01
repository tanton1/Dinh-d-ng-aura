import { expect, test } from '@playwright/test'

for (const off of [false, true]) {
  test(`schedule matrix renders complete weekly PT availability and preserves booked sessions (OFF=${off})`, async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-21T04:00:00Z'))
    await page.addInitScript((off) => {
      const workingDays = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7']
      const workingHours = [6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 19, 20]
      ;(window as any).__weeklyViewOverride = {
        trainers: [{ id: 't', name: 'Mai', status: 'active', branchId: 'b', slotCapacity: 2, availabilityMode: 'configured', availabilityRevision: 3,
          availabilitySource: 'weekly', availabilityWeekId: '2026-10-19', offDates: off ? ['2026-10-19'] : [],
          availableSlots: workingDays.filter((day) => !off || day !== 'T2').flatMap((day) => workingHours.map((hour) => `${day}-${hour}`)) }],
        scheduleConfig: { workingDays, workingHours, holidays: [] },
      }
    }, off)
    await page.goto('/tests/schedule-ui/index.html')
    await expect(page.locator('.schedule-cell.is-trainer-available')).toHaveCount(off ? 65 : 78)
    await expect(page.locator('.trainer-availability-chip')).toContainText('Lịch tuần')
    await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
    await expect(page.locator('.schedule-cell').filter({ hasText: 'Bình' })).toHaveCount(1)
    await expect(page.locator('.schedule-cell.is-off')).toHaveCount(off ? 11 : 0)
  })
}

test('matrix labels inherited trainer hours with their source week', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-21T04:00:00Z'))
  await page.addInitScript(() => {
    ;(window as any).__weeklyViewOverride = {
      trainers: [{ id: 't', name: 'Mai', status: 'active', branchId: 'b', slotCapacity: 2, availabilityMode: 'configured', availabilityRevision: 3,
        availabilitySource: 'inherited_weekly', availabilitySourceWeekId: '2026-10-12', availabilityWeekId: '2026-10-19', offDates: [], availableSlots: ['T3-6'] }],
    }
  })
  await page.goto('/tests/schedule-ui/index.html')
  await expect(page.locator('.trainer-availability-chip')).toContainText('Kế thừa tuần 2026-10-12')
  await expect(page.locator('.schedule-cell.is-trainer-available')).toHaveCount(1)
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
})
