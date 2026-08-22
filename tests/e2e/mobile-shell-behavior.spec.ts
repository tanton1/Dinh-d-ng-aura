import { expect, test } from '@playwright/test'

test.describe('Aura mobile shell behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
  })

  test('hides the dock while scrolling down and restores it when scrolling up', async ({ page }) => {
    await page.goto('/#/home')
    const dock = page.locator('.student-mobile-nav')
    await expect(dock).toBeVisible()

    await page.evaluate(() => window.scrollTo(0, Math.min(700, document.documentElement.scrollHeight - innerHeight)))
    await expect(dock).toHaveClass(/is-scroll-hidden/)
    await expect(dock).toHaveCSS('pointer-events', 'none')

    await page.evaluate(() => window.scrollBy(0, -120))
    await expect(dock).not.toHaveClass(/is-scroll-hidden/)
    await expect(dock).toHaveCSS('pointer-events', 'auto')
  })

  test('keeps search text clear of its leading icon', async ({ page }) => {
    await page.goto('/#/admin-roles')
    const field = page.locator('.roles-directory-toolbar .course-search')
    await expect(field).toBeVisible()
    const geometry = await field.evaluate((element) => {
      const icon = element.querySelector('svg')!.getBoundingClientRect()
      const input = element.querySelector('input')!
      const inputBox = input.getBoundingClientRect()
      const style = getComputedStyle(input)
      return {
        iconRight: icon.right,
        textStart: inputBox.left + Number.parseFloat(style.paddingLeft),
        paddingLeft: Number.parseFloat(style.paddingLeft),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    expect(geometry.paddingLeft).toBeGreaterThanOrEqual(42)
    expect(geometry.textStart).toBeGreaterThanOrEqual(geometry.iconRight + 7)
    expect(geometry.overflow).toBeLessThanOrEqual(1)
  })
})
