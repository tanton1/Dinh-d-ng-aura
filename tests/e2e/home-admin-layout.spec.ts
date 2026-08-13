import { expect, test, type Locator, type Page } from '@playwright/test'

const mobileViewport = { width: 390, height: 844 }

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }))

  expect(overflow.document).toBeLessThanOrEqual(1)
  expect(overflow.body).toBeLessThanOrEqual(1)
}

async function expectVisibleTargetsAtLeast(locator: Locator, minimum = 44) {
  const targets = await locator.evaluateAll((elements) => elements
    .filter((element) => {
      const style = window.getComputedStyle(element)
      const bounds = element.getBoundingClientRect()
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && bounds.width > 0
        && bounds.height > 0
    })
    .map((element) => {
      const bounds = element.getBoundingClientRect()
      return {
        label: element.getAttribute('aria-label')
          || element.getAttribute('title')
          || element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80)
          || element.tagName,
        width: Math.round(bounds.width * 10) / 10,
        height: Math.round(bounds.height * 10) / 10,
      }
    }))

  expect(targets.length).toBeGreaterThan(0)
  expect(
    targets.filter((target) => target.width < minimum || target.height < minimum),
    `Expected visible touch targets to be at least ${minimum}x${minimum}px`,
  ).toEqual([])
}

test.describe('Home V2 mobile layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(mobileViewport)
    await page.goto('/#/home')
    await expect(page.locator('.aura-today-flow')).toBeVisible()
  })

  test('shows three health statuses and keeps the decision flow before Academy', async ({ page }) => {
    const todayFlow = page.locator('.aura-today-flow')
    const statusCards = todayFlow.locator('.aura-today-flow__status')

    await expect(statusCards).toHaveCount(3)
    await expect(statusCards.filter({ hasText: /chuỗi/i })).toHaveCount(0)
    await expect(page.locator('.today-workout, .home-academy-hero, .academy-feature-hero')).toHaveCount(0)

    const sectionOrder = await page.evaluate(() => {
      const nextAction = document.querySelector('.aura-today-flow__next')
      const rhythm = document.querySelector('.aura-today-flow__rhythm-grid')
      const learning = document.querySelector('.home-v2-section')
      if (!nextAction || !rhythm || !learning) return null

      const follows = (first: Element, second: Element) => Boolean(
        first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
      )

      return {
        nextBeforeRhythm: follows(nextAction, rhythm),
        rhythmBeforeLearning: follows(rhythm, learning),
      }
    })

    expect(sectionOrder).toEqual({ nextBeforeRhythm: true, rhythmBeforeLearning: true })
    await expectNoPageOverflow(page)

    await expectVisibleTargetsAtLeast(page.locator([
      '.aura-today-flow__status',
      '.aura-today-flow__next > button',
      '.aura-today-flow__empty',
      '.aura-today-flow__schedule',
      '.home-v2-card-action',
      '.home-v2-milestone > button',
    ].join(', ')))
  })
})

test.describe('Academy admin mobile workspaces', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(mobileViewport)
  })

  test('renders the course list as cards without page-level overflow', async ({ page }) => {
    await page.goto('/#/admin-courses')
    await expect(page.getByRole('heading', { name: 'Khóa học & Đào tạo' })).toBeVisible()

    const list = page.locator('.admin-course-list')
    const rows = list.locator('.admin-course-row')
    await expect(list).toBeVisible()
    expect(await rows.count()).toBeGreaterThan(0)
    await expect(list.locator('.admin-course-list__head')).toBeHidden()

    const firstCardStyle = await rows.first().evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        display: style.display,
        borderRadius: Number.parseFloat(style.borderRadius),
        minWidth: Number.parseFloat(style.minWidth),
      }
    })
    expect(firstCardStyle.display).toBe('grid')
    expect(firstCardStyle.borderRadius).toBeGreaterThanOrEqual(16)
    expect(firstCardStyle.minWidth).toBe(0)

    await expectNoPageOverflow(page)
    await expectVisibleTargetsAtLeast(page.locator('.admin-hero-btn, .admin-course-row .row-actions button'))
  })

  test('keeps Course Studio actions above the admin bottom navigation', async ({ page }) => {
    await page.goto('/#/admin-course-editor')
    await expect(page.locator('.course-editor-page')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Thông tin cơ bản' })).toBeVisible()

    const footer = page.locator('.course-editor-page .editor-footer')
    const bottomNav = page.locator('.admin-mobile-nav')
    await expect(footer).toBeVisible()
    await expect(bottomNav).toBeVisible()

    const [footerBox, navBox] = await Promise.all([footer.boundingBox(), bottomNav.boundingBox()])
    expect(footerBox).not.toBeNull()
    expect(navBox).not.toBeNull()
    expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(navBox!.y + 1)

    await page.locator('#course-requirements').scrollIntoViewIfNeeded()
    const stickyLayout = await page.evaluate(() => {
      const topbar = document.querySelector<HTMLElement>('.topbar')!.getBoundingClientRect()
      const editorHeader = document.querySelector<HTMLElement>('.course-editor-page .editor-header')!.getBoundingClientRect()
      const stepper = document.querySelector<HTMLElement>('.course-editor-page .editor-mobile-stepper')!.getBoundingClientRect()
      return {
        topbarBottom: topbar.bottom,
        headerTop: editorHeader.top,
        headerBottom: editorHeader.bottom,
        stepperTop: stepper.top,
      }
    })
    expect(stickyLayout.headerTop).toBeGreaterThanOrEqual(stickyLayout.topbarBottom - 1)
    expect(stickyLayout.stepperTop).toBeGreaterThanOrEqual(stickyLayout.headerBottom - 1)

    await expectNoPageOverflow(page)
    await expectVisibleTargetsAtLeast(page.locator([
      '.course-editor-page .editor-header > .back-button',
      '.course-editor-page .editor-header .primary-button',
      '.course-editor-page .mobile-step-btn',
      '.course-editor-page .editor-footer button',
    ].join(', ')))
  })
})
