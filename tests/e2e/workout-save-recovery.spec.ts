import { expect, test, type Page } from '@playwright/test'

async function openWorkout(page: Page, behavior = { failCount: 0, hold: false, navigationThrows: false }) {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(behavior => Object.assign(window, { workoutOwner: 'member-one', workoutFailCount: behavior.failCount, workoutHold: behavior.hold, workoutNavigationThrows: behavior.navigationThrows }), behavior)
  await page.route('**/src/contexts/AuthContext.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: `
    import React from '/node_modules/.vite/deps/react.js';
    const { useState, useEffect } = React;
    export function useAuth() {
      const [uid, setUid] = useState(window.workoutOwner);
      useEffect(() => { const update = () => setUid(window.workoutOwner); window.addEventListener('fixture-owner', update); return () => window.removeEventListener('fixture-owner', update); }, []);
      return { user: { uid, displayName: uid }, backendMode: 'demo' };
    }
  ` }))
  await page.goto('/tests/e2e/fixtures/workout-save.html')
  await expect(page.getByRole('button', { name: 'Lưu kết quả & về lịch tập', exact: true })).toBeVisible()
}

test('workout double click sends once and navigation failure cannot turn server success into another save', async ({ page }) => {
  await openWorkout(page, { failCount: 0, hold: true, navigationThrows: true })
  await page.getByRole('button', { name: 'Lưu kết quả & về lịch tập', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  expect(await page.evaluate(() => (window as any).workoutSaves.length)).toBe(1)
  await page.evaluate(() => (window as any).workoutRelease())
  await expect(page.getByTestId('workout-save-status')).toHaveText('Đã ghi nhận kết quả trên máy chủ.')
  await expect(page.getByRole('alert')).toContainText('Kết quả đã lưu thành công')
  await expect(page.getByRole('button', { name: 'Đã lưu kết quả', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('aura-workout-draft:v2')))).toEqual([])
})

test('workout lost response freezes all submitted values and reload replays the same command', async ({ page }) => {
  await openWorkout(page, { failCount: 1, hold: false, navigationThrows: false })
  await page.getByRole('button', { name: 'Lưu kết quả & về lịch tập', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Thử lưu lại', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Rất khó/ })).toBeDisabled()
  const first = await page.evaluate(() => (window as any).workoutSaves[0])
  await page.reload()
  await expect(page.getByRole('button', { name: 'Thử lưu lại', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Rất khó/ })).toBeDisabled()
  await page.evaluate(() => { (window as any).workoutFailCount = 0 })
  await page.getByRole('button', { name: 'Thử lưu lại', exact: true }).click()
  await expect(page.getByTestId('workout-save-status')).toHaveText('Đã ghi nhận kết quả trên máy chủ.')
  expect(await page.evaluate(() => (window as any).workoutSaves)).toEqual([first])
})

test('owner switch while saving cannot copy old draft or navigate the new member when acknowledgement arrives', async ({ page }) => {
  await openWorkout(page, { failCount: 0, hold: true, navigationThrows: false })
  await page.getByRole('button', { name: 'Lưu kết quả & về lịch tập', exact: true }).click()
  await page.evaluate(() => { (window as any).workoutOwner = 'member-two'; window.dispatchEvent(new Event('fixture-owner')) })
  await expect(page.getByRole('button', { name: 'Bắt đầu buổi tập', exact: true })).toBeVisible()
  await page.evaluate(() => (window as any).workoutRelease())
  expect(await page.evaluate(() => (window as any).workoutExits)).toBe(0)
  expect(await page.evaluate(() => (window as any).workoutSaves.map((entry: any) => entry.owner))).toEqual(['member-one'])
  const secondDraft = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.endsWith(':member-two'))?.[1])
  if (secondDraft) { expect(secondDraft).not.toContain('Private note'); expect(JSON.parse(secondDraft).completedSets).toEqual({}) }
})
