import { expect, test, type Page } from '@playwright/test'

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }))
  expect(overflow.document).toBeLessThanOrEqual(1)
  expect(overflow.body).toBeLessThanOrEqual(1)
}

test.describe('Eat Clean customer journey', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.keys(window.localStorage)
        .filter((key) => key.startsWith('aura:eat-clean:cart:'))
        .forEach((key) => window.localStorage.removeItem(key))
    })
  })

  test('keeps the storefront and sticky cart usable on a 320px phone', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto('/#/eat-clean')

    await expect(page.getByTestId('eat-clean-storefront')).toBeVisible()
    await expect(page.getByRole('heading', { name: /Bữa ngon đúng mục tiêu/i })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.locator('.eat-clean-meal-card').filter({ has: page.getByRole('button', { name: 'Thêm', exact: true }) }).first()
      .getByRole('button', { name: 'Thêm', exact: true }).click()
    const cartDock = page.locator('.eat-clean-cart-dock')
    await expect(cartDock).toBeVisible()

    const [dockBounds, navBounds] = await Promise.all([
      cartDock.boundingBox(),
      page.locator('.mobile-bottom-nav').boundingBox(),
    ])
    expect(dockBounds).not.toBeNull()
    expect(navBounds).not.toBeNull()
    expect(dockBounds!.y + dockBounds!.height).toBeLessThanOrEqual(navBounds!.y + 1)
    await expectNoHorizontalOverflow(page)
  })

  test('completes the demo cart, quote and COD order flow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/#/eat-clean')
    await page.locator('.eat-clean-meal-card').first().getByRole('button', { name: 'Thêm', exact: true }).click()
    await page.getByRole('button', { name: /Xem giỏ/i }).click()

    await expect(page.getByTestId('eat-clean-cart')).toBeVisible()
    await page.getByRole('button', { name: /Tiếp tục giao hàng/i }).click()
    await expect(page.getByTestId('eat-clean-checkout')).toBeVisible()

    await page.getByLabel('Họ và tên').fill('Tân Aura')
    await page.getByLabel('Số điện thoại').fill('0905410812')
    await page.getByLabel('Số nhà, tên đường').fill('28 Nguyễn Chí Thanh')
    await page.getByLabel('Phường/xã').fill('Hải Châu 1')
    await expect(page.getByText(/Thanh toán khi nhận hàng/i)).toBeVisible()
    await page.getByRole('button', { name: /Cập nhật báo giá/i }).click()
    await expect(page.getByRole('button', { name: /Đặt món ngay/i })).toBeEnabled()
    await page.getByRole('button', { name: /Đặt món ngay/i }).click()

    await expect(page.getByTestId('eat-clean-order-detail')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Đã xác nhận', exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
