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
    }))
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1)
    expect(dimensions.buttonBottom).toBeGreaterThan(0)
    expect(dimensions.buttonBottom).toBeLessThanOrEqual(dimensions.viewportHeight)
  })
}
