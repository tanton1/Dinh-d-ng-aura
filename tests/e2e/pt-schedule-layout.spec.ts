import { expect, test } from '@playwright/test'

for (const width of [360, 390, 430]) {
  test(`PT schedule uses a compact two-day matrix at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/#/admin-pt-schedule')
    await expect(page.getByRole('heading', { name: /Xếp Lịch Tập/i })).toBeVisible()

    const publishButton = page.getByRole('button', { name: /^Publish$/i })
    await expect(publishButton).toBeVisible()
    await expect(publishButton).toBeDisabled()

    const tabs = page.locator('.schedule-workspace__tabs')
    await expect(tabs.getByRole('button', { name: /^Lịch PT$/i })).toBeVisible()
    await expect(tabs.getByRole('button', { name: /^Học viên$/i })).toBeVisible()
    await expect(tabs.getByRole('button', { name: /^Đổi \/ Hủy/i })).toBeVisible()
    await expect(tabs.getByRole('button', { name: /^OFF \/ Bảo lưu/i })).toBeVisible()
    await expect(tabs.getByRole('button', { name: /^Cảnh báo/i })).toBeVisible()

    const dockStyle = await page.evaluate(() => {
      const dock = document.querySelector<HTMLElement>('.admin-mobile-nav')!
      const active = dock.querySelector<HTMLElement>('button.active')!
      return {
        radius: Number.parseFloat(getComputedStyle(dock).borderRadius),
        background: getComputedStyle(dock).backgroundColor,
        activeGradient: getComputedStyle(active, '::before').backgroundImage,
        activeColor: getComputedStyle(active).color,
      }
    })
    expect(dockStyle.radius).toBeGreaterThanOrEqual(28)
    expect(dockStyle.background).toContain('255, 255, 255')
    expect(dockStyle.activeGradient).toContain('linear-gradient')
    expect(dockStyle.activeColor).toBe('rgb(17, 13, 20)')

    const dayPager = page.locator('.pt-schedule-matrix__day-tabs')
    await expect(dayPager).toBeVisible()
    await expect(dayPager.getByRole('button', { name: 'T2 – T3' })).toHaveAttribute('aria-current', 'page')

    const visibleDayHeaders = page.locator('.pt-schedule-matrix__grid thead th:not(:first-child):visible')
    await expect(visibleDayHeaders).toHaveCount(2)
    await expect(visibleDayHeaders.nth(0)).toContainText('T2')
    await expect(visibleDayHeaders.nth(1)).toContainText('T3')

    await dayPager.getByRole('button', { name: 'Hai ngày sau' }).click()
    await expect(dayPager.getByRole('button', { name: 'T4 – T5' })).toHaveAttribute('aria-current', 'page')
    await expect(visibleDayHeaders).toHaveCount(2)
    await expect(visibleDayHeaders.nth(0)).toContainText('T4')
    await expect(visibleDayHeaders.nth(1)).toContainText('T5')

    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      buttonBottom: document.querySelector<HTMLButtonElement>('.schedule-publish-trigger')?.getBoundingClientRect().bottom ?? 0,
      viewportHeight: window.innerHeight,
      frameWidth: document.querySelector<HTMLElement>('.aura-operations-page--schedule')?.getBoundingClientRect().width ?? 0,
      pageWidth: document.querySelector<HTMLElement>('.page-content')?.getBoundingClientRect().width ?? 0,
      framePaddingLeft: getComputedStyle(document.querySelector<HTMLElement>('.aura-operations-page--schedule')!).paddingLeft,
      matrixRadius: Number.parseFloat(getComputedStyle(document.querySelector<HTMLElement>('.pt-schedule-matrix__table-shell')!).borderRadius),
      matrixShadow: getComputedStyle(document.querySelector<HTMLElement>('.pt-schedule-matrix__table-shell')!).boxShadow,
      controlsHeight: document.querySelector<HTMLElement>('.schedule-workspace__header')?.getBoundingClientRect().height ?? 0,
    }))
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1)
    expect(dimensions.buttonBottom).toBeGreaterThan(0)
    expect(dimensions.buttonBottom).toBeLessThanOrEqual(dimensions.viewportHeight)
    expect(Math.abs(dimensions.frameWidth - dimensions.pageWidth)).toBeLessThanOrEqual(1)
    expect(dimensions.framePaddingLeft).toBe('0px')
    expect(dimensions.matrixRadius).toBeGreaterThanOrEqual(20)
    expect(dimensions.matrixShadow).not.toBe('none')
    expect(dimensions.controlsHeight).toBeLessThanOrEqual(180)

    await tabs.getByRole('button', { name: /^Cảnh báo/i }).click()
    await expect(page.getByRole('heading', { name: /Cảnh báo cần xử lý/i })).toBeVisible()
    await expect(page.locator('.schedule-alerts')).toHaveCSS('background-image', /linear-gradient/)
  })
}

test('PT schedule shows T2-T7 on the full desktop operations canvas', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/#/admin-pt-schedule')
  await expect(page.getByRole('heading', { name: /Xếp Lịch Tập/i })).toBeVisible()
  await expect(page.locator('.pt-schedule-matrix__day-tabs')).toBeHidden()

  const desktopDayHeaders = page.locator('.pt-schedule-matrix__grid thead th:not(:first-child):visible')
  await expect(desktopDayHeaders).toHaveCount(6)
  for (const [index, label] of ['T2', 'T3', 'T4', 'T5', 'T6', 'T7'].entries()) {
    await expect(desktopDayHeaders.nth(index)).toContainText(label)
  }

  const geometry = await page.evaluate(() => {
    const pageContent = document.querySelector<HTMLElement>('.page-content')!.getBoundingClientRect()
    const frame = document.querySelector<HTMLElement>('.aura-operations-page--schedule')!.getBoundingClientRect()
    const workspace = document.querySelector<HTMLElement>('.schedule-workspace')!.getBoundingClientRect()
    const matrix = document.querySelector<HTMLElement>('.pt-schedule-matrix__table-shell')!
    return {
      frameWidth: frame.width,
      pageWidth: pageContent.width,
      workspaceWidth: workspace.width,
      radius: Number.parseFloat(getComputedStyle(matrix).borderRadius),
      shadow: getComputedStyle(matrix).boxShadow,
    }
  })
  expect(Math.abs(geometry.frameWidth - geometry.pageWidth)).toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.workspaceWidth - geometry.frameWidth)).toBeLessThanOrEqual(1)
  expect(geometry.radius).toBeGreaterThanOrEqual(24)
  expect(geometry.shadow).not.toBe('none')
})
