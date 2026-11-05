import { expect, test, type Page } from '@playwright/test'

test.skip(({ browserName }) => browserName !== 'chromium', 'Viewport-specific layout checks only need one engine.')

async function openAdmin(page: Page, view: string, width = 1440) {
  // The admin switch lives in the desktop sidebar; enter there, then resize.
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/home')
  await expect(page.locator('#aura-today-flow-title')).toBeVisible()
  await page.getByRole('button', { name: 'Mở trang quản trị' }).click()
  await expect(page).toHaveURL(/#\/admin-dashboard/)
  await page.setViewportSize({ width, height: 900 })
  await page.evaluate((target) => { location.hash = `#/${target}` }, view)
  await expect(page).toHaveURL(new RegExp(`#/${view}`))
}

test('student roster keeps every row action inside its visible area', async ({ page }) => {
  await openAdmin(page, 'admin-pt-students')
  const roster = page.locator('.student-roster')
  await expect(roster).toBeVisible()
  const area = await roster.boundingBox()
  const actions = await page.locator('.student-roster__actions button').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().right))
  expect(actions.length).toBeGreaterThan(0)
  for (const right of actions) expect(right).toBeLessThanOrEqual((area?.x ?? 0) + (area?.width ?? 0) + 1)
})

test('student roster header uses the bundled brand mark and labelled search', async ({ page }) => {
  await openAdmin(page, 'admin-pt-students')
  const brand = page.locator('.student-management__brand')
  await expect(brand).toHaveAttribute('src', '/icons/aura-icon.svg')
  expect(await brand.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  await expect(page.getByRole('textbox', { name: 'Tìm học viên theo tên hoặc số điện thoại' })).toBeVisible()
})

test('every visible admin control on the phone roster has an accessible name', async ({ page }) => {
  await openAdmin(page, 'admin-pt-students', 375)
  await expect(page.locator('.student-management')).toBeVisible()
  const unnamed = await page.locator('main button').evaluateAll((buttons) => buttons
    .filter((button) => button.getBoundingClientRect().width > 0 && getComputedStyle(button).visibility !== 'hidden')
    .filter((button) => !(button.getAttribute('aria-label') || button.getAttribute('title') || (button.textContent ?? '').trim()))
    .map((button) => button.className))
  expect(unnamed).toEqual([])
})

test('schedule trainer picker and hour header keep icons clear of their text', async ({ page }) => {
  await openAdmin(page, 'admin-pt-schedule')
  const picker = page.getByRole('combobox', { name: 'Chọn PT để xem lịch' })
  await expect(picker).toBeVisible()
  const gap = await picker.evaluate((select) => {
    const icon = select.parentElement?.querySelector('svg')?.getBoundingClientRect()
    return icon ? select.getBoundingClientRect().left + parseFloat(getComputedStyle(select).paddingLeft) - icon.right : 999
  })
  expect(gap).toBeGreaterThanOrEqual(4)
  const header = page.locator('.pt-schedule-matrix__grid thead th').first()
  const overlap = await header.evaluate((th) => {
    const icon = th.querySelector('svg')?.getBoundingClientRect()
    const range = document.createRange()
    const text = [...th.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim())
    if (!icon || !text) return false
    range.selectNodeContents(text)
    const words = range.getBoundingClientRect()
    return !(icon.bottom <= words.top || words.bottom <= icon.top || icon.right <= words.left || words.right <= icon.left)
  })
  expect(overlap).toBe(false)
})

for (const [view, selector] of [['admin-dashboard', '.admin-dashboard__branch-filter select'], ['admin-hr', '.identity-filter select']] as const) {
  test(`${view} filter select is at least 34px tall`, async ({ page }) => {
    await openAdmin(page, view)
    const select = page.locator(selector).first()
    await expect(select).toBeVisible()
    expect((await select.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(34)
  })
}

test('metric carousel dots expose at least 24px tap targets without overlapping', async ({ page }) => {
  await openAdmin(page, 'admin-dashboard', 375)
  const dots = page.locator('.aura-metric-carousel__dots button')
  await expect(dots.first()).toBeVisible()
  const areas = await dots.evaluateAll((buttons) => buttons.map((button) => {
    const box = button.getBoundingClientRect()
    const after = getComputedStyle(button, '::after')
    return { left: box.left - Math.abs(parseFloat(after.left)), right: box.right + Math.abs(parseFloat(after.right)), height: box.height + Math.abs(parseFloat(after.top)) * 2 }
  }))
  for (const area of areas) {
    expect(area.right - area.left).toBeGreaterThanOrEqual(20)
    expect(area.height).toBeGreaterThanOrEqual(24)
  }
  for (let index = 1; index < areas.length; index += 1) expect(areas[index].left).toBeGreaterThanOrEqual(areas[index - 1].right - 0.5)
})

for (const width of [1440, 375]) {
  test(`admin dashboard puts today's work first and keeps attendance readable at ${width}px`, async ({ page }) => {
    await openAdmin(page, 'admin-dashboard', width)
    const tasks = page.locator('.admin-dashboard__tasks')
    await expect(tasks.getByRole('heading', { name: 'Hôm nay cần làm' })).toBeVisible()
    const tasksBox = await tasks.boundingBox()
    const carouselBox = await page.locator('.aura-metric-carousel').boundingBox()
    expect(tasksBox!.y).toBeLessThan(carouselBox!.y)
    expect(tasksBox!.y).toBeLessThan(260)
    await expect(page.locator('.admin-dashboard__syncbar strong')).toHaveText(/^Chào /)
    const metrics = await page.locator('.admin-dashboard__attendance-metrics > span').evaluateAll((items) => items.map((item) => item.getBoundingClientRect().right))
    expect(metrics).toHaveLength(5)
    for (const right of metrics) expect(right).toBeLessThanOrEqual(width)
    const order = await page.locator('.admin-dashboard > *').evaluateAll((items) => items.map((item) => getComputedStyle(item).order))
    expect(new Set(order)).toEqual(new Set(['0']))
    // One title per section: no uppercase eyebrow above the headings.
    await expect(page.locator('.admin-dashboard > section > header small, .admin-dashboard__main-grid > section > header small')).toHaveCount(0)
  })
}

test('admin dashboard counts figures up to their exact values, at once under reduced motion', async ({ page }) => {
  await openAdmin(page, 'admin-dashboard')
  const total = page.locator('.admin-dashboard__attendance-metrics .is-total b')
  await expect(total).toHaveText('42')
  await expect(page.locator('.aura-metric-carousel__slide').first().locator('strong')).toHaveText('219.160.415đ')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Làm mới tổng quan' }).click()
  await page.evaluate(() => { location.hash = '#/admin-pt-students' })
  await page.evaluate(() => { location.hash = '#/admin-dashboard' })
  await expect(total).toBeVisible()
  // No animation frame has to run: the first painted value is already final.
  expect(await total.innerText()).toBe('42')
})

const adminViews = ['admin-dashboard', 'admin-pt-students', 'admin-renewals', 'admin-loyalty', 'admin-pt-schedule', 'admin-training-history', 'admin-pt-workouts', 'admin-performance', 'admin-trainer-quality', 'admin-hr', 'admin-payroll', 'admin-finance', 'admin-eat-clean', 'admin-nutrition-reviews', 'admin-notifications']
const staffViews = ['staff-dashboard', 'staff-students', 'staff-schedule', 'staff-availability', 'staff-requests', 'staff-workouts', 'staff-nutrition-reviews', 'staff-renewals', 'staff-performance', 'staff-payroll']

async function openStaff(page: Page, view: string, width: number) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/home')
  await expect(page.locator('#aura-today-flow-title')).toBeVisible()
  await page.locator('.user-menu').click()
  await page.getByRole('button', { name: 'PT Gym' }).click()
  await expect(page).toHaveURL(/#\/staff-dashboard/)
  await page.setViewportSize({ width, height: 900 })
  await page.evaluate((target) => { location.hash = `#/${target}` }, view)
  await expect(page).toHaveURL(new RegExp(`#/${view}`))
}

const readability = (page: Page) => page.evaluate(() => {
  const main = document.querySelector('main') ?? document.body
  const tooSmall = [...main.querySelectorAll('*')].filter((element) => {
    const style = getComputedStyle(element)
    const size = parseFloat(style.fontSize)
    const rect = element.getBoundingClientRect()
    const hasText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > 0)
    return hasText && size > 1 && size < 12 && rect.width > 0 && style.visibility !== 'hidden' && !element.closest('.aura-visually-hidden, svg')
  }).map((element) => `${parseFloat(getComputedStyle(element).fontSize)}px ${element.className || element.tagName} "${(element.textContent ?? '').trim().slice(0, 24)}"`)
  return { tooSmall: [...new Set(tooSmall)], h1: main.querySelectorAll('h1').length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }
})

for (const width of [1440, 375]) {
  for (const view of adminViews) {
    test(`${view} keeps operations text readable at ${width}px`, async ({ page }) => {
      await openAdmin(page, view, width)
      await page.waitForTimeout(1200)
      const result = await readability(page)
      expect(result.tooSmall).toEqual([])
      expect(result.h1).toBe(1)
      expect(result.overflow).toBe(0)
    })
  }
  for (const view of staffViews) {
    test(`${view} keeps PT workspace text readable at ${width}px`, async ({ page }) => {
      await openStaff(page, view, width)
      await page.waitForTimeout(1200)
      const result = await readability(page)
      expect(result.tooSmall).toEqual([])
      expect(result.overflow).toBe(0)
    })
  }
}
