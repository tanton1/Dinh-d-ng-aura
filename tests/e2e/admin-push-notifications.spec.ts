import { expect, test, type Page } from '@playwright/test'

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }))
  expect(overflow.document).toBeLessThanOrEqual(1)
  expect(overflow.body).toBeLessThanOrEqual(1)
}

test.describe('Admin Push Notifications mobile', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/#/admin-notifications')
    await expect(page.getByRole('heading', { name: 'Push Notifications' })).toBeVisible()
  })

  test('uses five fixed tabs without horizontal overflow', async ({ page }) => {
    const tabList = page.getByRole('tablist', { name: 'Quản trị Push Notifications' })
    await expect(tabList.getByRole('tab')).toHaveCount(5)
    await expect(page.getByTestId('push-overview')).toBeVisible()

    const bounds = await tabList.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      top: element.getBoundingClientRect().top,
    }))
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth + 1)
    expect(bounds.top).toBeLessThan(250)
    await expectNoPageOverflow(page)
  })

  test('can scroll the final overview card completely above the mobile dock', async ({ page }) => {
    const finalCard = page.locator('[data-testid="push-overview"] .push-overview-grid .push-card').last()
    const bottomNav = page.locator('.admin-mobile-nav')

    await finalCard.scrollIntoViewIfNeeded()
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))

    const scrollState = await page.evaluate(() => ({
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: document.documentElement.clientHeight,
    }))
    expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.viewportHeight)
    expect(scrollState.scrollY).toBeGreaterThan(0)

    const [cardBox, navBox] = await Promise.all([finalCard.boundingBox(), bottomNav.boundingBox()])
    expect(cardBox).not.toBeNull()
    expect(navBox).not.toBeNull()
    expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(navBox!.y - 16)
    await expectNoPageOverflow(page)
  })

  test('blocks an empty individual audience and keeps send action above the dock', async ({ page }) => {
    await page.getByRole('tab', { name: 'Gửi' }).click()
    await expect(page.getByTestId('push-composer')).toBeVisible()

    await page.getByLabel('Nhóm người nhận').selectOption('individual')
    await expect(page.getByText('Nhóm này hiện không có người nhận. Hãy chọn nhóm khác.')).toBeVisible()
    await expect(page.getByRole('button', { name: /Kiểm tra trước khi gửi/ })).toBeDisabled()

    const sendBar = page.locator('.push-send-bar')
    const bottomNav = page.locator('.admin-mobile-nav')
    await sendBar.scrollIntoViewIfNeeded()
    const [sendBox, navBox] = await Promise.all([sendBar.boundingBox(), bottomNav.boundingBox()])
    expect(sendBox).not.toBeNull()
    expect(navBox).not.toBeNull()
    expect(sendBox!.y + sendBox!.height).toBeLessThanOrEqual(navBox!.y + 1)
    await expectNoPageOverflow(page)
  })

  test('shows one automation switch and keeps infrastructure collapsed', async ({ page }) => {
    await page.getByRole('tab', { name: 'Tự động' }).click()
    const panel = page.getByTestId('push-automation')
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('checkbox', { name: 'Bật nhắc nhật ký bữa ăn tự động' })).toHaveCount(1)
    await expect(panel.locator('.push-infrastructure')).not.toHaveAttribute('open', '')
    await expectNoPageOverflow(page)
  })

  for (const width of [320, 360, 430]) {
    test(`has no page-level overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await page.reload()
      await expect(page.getByRole('tablist', { name: 'Quản trị Push Notifications' })).toBeVisible()
      await expectNoPageOverflow(page)
    })
  }
})
