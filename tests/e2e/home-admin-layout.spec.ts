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

test.describe('Home V3 mobile layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(mobileViewport)
    await page.addInitScript(() => {
      window.localStorage.setItem('aura:nutrition-profile:demo-admin', JSON.stringify({
        goal: 'lose-fat',
        age: 31,
        biologicalSex: 'male',
        heightCm: 173,
        weightKg: 84,
        targetWeightDeltaKg: -6,
        targetTimeframeMonths: 4,
        targetSpeedPace: 'standard',
        activityLevel: 'moderate',
        trainingSessions: 4,
        eatingStyle: 'Không giới hạn',
        allergies: '',
        mealsPerDay: 3,
        targetCalories: 2084,
      }))
      window.localStorage.setItem('aura:nutrition:meals:v2:demo-admin', '[]')
      window.localStorage.setItem('aura:progress:weight-records:demo-admin', '[]')
    })
    await page.goto('/#/home')
    await expect(page.locator('.aura-today-flow')).toBeVisible()
  })

  test('shows the full-bleed Today Flow without Academy content', async ({ page }) => {
    const todayFlow = page.locator('.aura-today-flow')
    const statusCards = todayFlow.locator('.aura-today-flow__status')

    await expect(statusCards).toHaveCount(3)
    await expect(page.getByTestId('today-status-schedule')).toContainText('PT Minh')
    await expect(todayFlow.getByRole('heading', { name: /Hôm nay của/i })).toBeVisible()
    await expect(todayFlow.getByText(/AURA DAILY PULSE/i)).toHaveCount(0)
    await expect(statusCards.filter({ hasText: /phút hôm nay/i })).toHaveCount(1)
    await expect(statusCards.filter({ hasText: /phút tuần này/i })).toHaveCount(0)
    await expect(statusCards.filter({ hasText: /chuỗi/i })).toHaveCount(0)
    await expect(page.locator('.today-workout, .home-academy-hero, .academy-feature-hero, .home-v3-academy')).toHaveCount(0)
    await expect(page.getByTestId('today-status-learning')).toHaveCount(0)

    const sectionOrder = await page.evaluate(() => {
      const nextAction = document.querySelector('.aura-today-flow__next')
      const rhythm = document.querySelector('.aura-today-flow__rhythm-grid')
      const week = document.querySelector('.home-v3-week')
      if (!nextAction || !rhythm || !week) return null

      const follows = (first: Element, second: Element) => Boolean(
        first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
      )

      return {
        nextBeforeRhythm: follows(nextAction, rhythm),
        rhythmBeforeWeek: follows(rhythm, week),
      }
    })

    expect(sectionOrder).toEqual({ nextBeforeRhythm: true, rhythmBeforeWeek: true })

    const flowBounds = await todayFlow.boundingBox()
    expect(flowBounds).not.toBeNull()
    expect(flowBounds!.x).toBeLessThanOrEqual(1)
    expect(Math.abs(flowBounds!.width - mobileViewport.width)).toBeLessThanOrEqual(1)
    await expectNoPageOverflow(page)

    await expect(page.getByRole('heading', { name: 'Học tiếp cùng Aura' })).toHaveCount(0)
    await expect(page.getByText(/Tiến độ học tập|Tiếp tục hành trình|Thành tích đạt được/i)).toHaveCount(0)
    await page.getByRole('tab', { name: 'Lịch sắp tới' }).click()
    await expect(page.getByRole('tabpanel')).toBeVisible()

    await expectVisibleTargetsAtLeast(page.locator([
      '.aura-today-flow__status',
      '.aura-today-flow__next > button',
      '.aura-today-flow__empty',
      '.home-v3-week__tabs button',
      '.home-v3-schedule__item',
      '.home-v3-schedule__empty',
      '.home-v3-milestone > button',
    ].join(', ')))

    await page.getByTestId('today-status-schedule').click()
    await expect(page).toHaveURL(/#\/schedule$/)
  })

  test('uses the same remaining kcal on Home and Nutrition and ignores a legacy target override', async ({ page }) => {
    const homeValue = (await page.getByTestId('today-status-nutrition').locator('strong').first().textContent())?.trim()
    expect(homeValue).toBeTruthy()
    expect(homeValue).not.toBe('2.084')

    await page.getByTestId('today-status-nutrition').click()
    await expect(page).toHaveURL(/#\/nutrition/)
    const nutritionValue = page.getByTestId('nutrition-calories-value')
    await expect(nutritionValue).toHaveAttribute('data-mode', 'remaining')
    await expect(nutritionValue).toHaveText(homeValue!)
  })

  for (const width of [375, 430]) {
    test(`keeps the ${width}px mobile viewport free of page-level overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await page.reload()
      const flowBounds = await page.locator('.aura-today-flow').boundingBox()
      expect(flowBounds).not.toBeNull()
      expect(flowBounds!.x).toBeLessThanOrEqual(1)
      expect(Math.abs(flowBounds!.width - width)).toBeLessThanOrEqual(1)
      await expectNoPageOverflow(page)
    })
  }
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
