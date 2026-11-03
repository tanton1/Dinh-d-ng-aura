import { expect, test, type Locator, type Page } from '@playwright/test'

test.skip(({ browserName }) => browserName !== 'chromium', 'Viewport-specific layout checks only need one engine.')

async function box(locator: Locator) {
  await expect(locator).toBeVisible()
  const value = await locator.boundingBox()
  if (!value) throw new Error('Element has no bounding box')
  return value
}

function intersects(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

async function openHome(page: Page, width: number, height = 812) {
  await page.setViewportSize({ width, height })
  await page.goto('/#/home')
  await expect(page.locator('#aura-today-flow-title')).toBeVisible()
}

test('closed mobile menu stays out of the tab order', async ({ page }) => {
  await openHome(page, 375)
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('#app-sidebar')))).toBe(false)
  }
})

test('mobile menu takes focus, traps Tab, closes with Escape and restores focus', async ({ page }) => {
  await openHome(page, 375)
  const opener = page.getByRole('button', { name: 'Mở menu' })
  await opener.click()
  await expect(page.locator('#app-sidebar .sidebar-close')).toBeFocused()

  for (let index = 0; index < 25; index += 1) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('#app-sidebar')))).toBe(true)
  }

  await page.keyboard.press('Escape')
  await expect(page.locator('#app-sidebar')).not.toHaveClass(/\bopen\b/)
  await expect(opener).toBeFocused()
})

for (const width of [768, 800, 900, 1000, 1199]) {
  test(`tablet rail does not cover the page at ${width}px`, async ({ page }) => {
    await openHome(page, width, 900)
    const rail = await box(page.locator('#app-sidebar'))
    const main = await box(page.locator('.app-main'))
    const heading = await box(page.locator('#aura-today-flow-title'))
    expect(main.x).toBeGreaterThanOrEqual(rail.x + rail.width)
    expect(heading.x).toBeGreaterThanOrEqual(rail.x + rail.width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
  })
}

for (const width of [320, 375, 420]) {
  test(`nutrition date strip keeps all seven days at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 })
    await page.goto('/#/nutrition')
    const pills = page.locator('.nutrition-date-pill')
    await expect(pills).toHaveCount(7)
    for (const pill of await pills.all()) {
      const value = await box(pill)
      expect(value.width).toBeGreaterThanOrEqual(24)
      expect(value.x + value.width).toBeLessThanOrEqual(width)
    }
    await box(page.locator('.nutrition-date-pill[aria-current="date"]'))
  })
}

for (const width of [375, 600, 800, 1440]) {
  test(`coach launcher stays clear of the nutrition FAB at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/#/nutrition')
    const launcher = await box(page.getByTestId('ai-coach-launcher'))
    const fabs = page.locator('.nutrition-pink-fab:visible')
    await expect(fabs.first()).toBeVisible()
    for (const fab of await fabs.all()) expect(intersects(launcher, await box(fab))).toBe(false)
  })
}

test('coach launcher stays clear of course progress and CTA on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/#/courses')
  const launcher = await box(page.getByTestId('ai-coach-launcher'))
  const progress = await box(page.locator('.academy-single-course__progress'))
  expect(intersects(launcher, progress)).toBe(false)
})

const memberViews = ['home', 'schedule', 'nutrition', 'pt-workout', 'progress', 'aura-club', 'courses', 'eat-clean', 'profile', 'student-availability']

for (const view of memberViews) {
  test(`${view} keeps member text at 12px or larger with no sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto(`/#/${view}`)
    await expect(page.locator('main').first()).toBeVisible()
    await page.waitForTimeout(800)
    const tooSmall = await page.evaluate(() => [...document.querySelectorAll('main *')].filter((element) => {
      const style = getComputedStyle(element)
      const size = parseFloat(style.fontSize)
      const rect = element.getBoundingClientRect()
      const hasText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > 1)
      return hasText && size > 1 && size < 12 && rect.width > 0 && style.visibility !== 'hidden' && !element.closest('.aura-visually-hidden')
    }).map((element) => `${parseFloat(getComputedStyle(element).fontSize)}px ${(element.textContent ?? '').trim().slice(0, 30)}`))
    expect(tooSmall).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
  })
}

for (const view of ['home', 'nutrition', 'schedule']) {
  test(`${view} exposes one page heading before its sections`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto(`/#/${view}`)
    await expect(page.locator('main h1').first()).toBeAttached()
    const levels = await page.locator('main :is(h1, h2)').evaluateAll((headings) => headings.map((heading) => heading.tagName))
    expect(levels[0]).toBe('H1')
    expect(levels.filter((level) => level === 'H1')).toHaveLength(1)
  })
}

test('schedule week strip appears on the first phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/#/schedule')
  const strip = await box(page.locator('.week-strip'))
  expect(strip.y + strip.height).toBeLessThan(812)
})

test('primary action keeps the accessible gradient', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/#/home')
  const background = await page.locator('.aura-today-flow__next button').first().evaluate((button) => getComputedStyle(button).backgroundImage)
  expect(background).toContain('rgb(214, 24, 110)')
  expect(background).toContain('rgb(194, 65, 12)')
})

for (const width of [375, 1440]) {
  test(`schedule hero headline stays clear of its metric at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/#/schedule')
    const slide = page.locator('.student-schedule-hero__slide.is-contract')
    await slide.scrollIntoViewIfNeeded()
    const title = await box(slide.locator('h2'))
    const metric = await box(slide.locator('.student-schedule-hero__metric'))
    expect(intersects(title, metric)).toBe(false)
  })
}
