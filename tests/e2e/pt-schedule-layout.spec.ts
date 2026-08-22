import { expect, test } from '@playwright/test'

for (const width of [360, 390, 430]) {
  test(`PT schedule publish controls stay mobile-safe at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/#/admin-pt-schedule')
    await expect(page.getByRole('heading', { name: /Xếp Lịch Tập/i })).toBeVisible()
    const publishButton = page.getByRole('button', { name: /Kiểm tra & Publish/i })
    await expect(publishButton).toBeVisible()
    await expect(publishButton).toBeDisabled()

    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      buttonBottom: document.querySelector<HTMLButtonElement>('.schedule-publish-trigger')?.getBoundingClientRect().bottom ?? 0,
      viewportHeight: window.innerHeight,
      frameWidth: document.querySelector<HTMLElement>('.aura-operations-page--schedule')?.getBoundingClientRect().width ?? 0,
      pageWidth: document.querySelector<HTMLElement>('.page-content')?.getBoundingClientRect().width ?? 0,
      framePaddingLeft: getComputedStyle(document.querySelector<HTMLElement>('.aura-operations-page--schedule')!).paddingLeft,
      matrixRadius: getComputedStyle(document.querySelector<HTMLElement>('.pt-schedule-matrix-workspace, .pt-schedule-matrix-empty')!).borderRadius,
    }))
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1)
    expect(dimensions.buttonBottom).toBeGreaterThan(0)
    expect(dimensions.buttonBottom).toBeLessThanOrEqual(dimensions.viewportHeight)
    expect(Math.abs(dimensions.frameWidth - dimensions.pageWidth)).toBeLessThanOrEqual(1)
    expect(dimensions.framePaddingLeft).toBe('0px')
    expect(dimensions.matrixRadius).toBe('0px')
  })
}

test('PT schedule uses the whole desktop operations canvas', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/#/admin-pt-schedule')
  await expect(page.getByRole('heading', { name: /Xếp Lịch Tập/i })).toBeVisible()

  const geometry = await page.evaluate(() => {
    const pageContent = document.querySelector<HTMLElement>('.page-content')!.getBoundingClientRect()
    const frame = document.querySelector<HTMLElement>('.aura-operations-page--schedule')!.getBoundingClientRect()
    const workspace = document.querySelector<HTMLElement>('.schedule-workspace')!.getBoundingClientRect()
    return {
      frameWidth: frame.width,
      pageWidth: pageContent.width,
      workspaceWidth: workspace.width,
      radius: getComputedStyle(document.querySelector<HTMLElement>('.pt-schedule-matrix-workspace, .pt-schedule-matrix-empty')!).borderRadius,
    }
  })
  expect(Math.abs(geometry.frameWidth - geometry.pageWidth)).toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.workspaceWidth - geometry.frameWidth)).toBeLessThanOrEqual(1)
  expect(geometry.radius).toBe('0px')
})
