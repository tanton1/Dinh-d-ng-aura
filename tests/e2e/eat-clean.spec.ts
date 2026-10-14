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

  test('shows sourced weekly plans without mixing them into the Aura cart', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 })
    const externalRequests: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).hostname === 'fitfood.vn') externalRequests.push(request.url())
    })
    await page.goto('/#/eat-clean')
    await page.getByRole('button', { name: 'Sản phẩm Fitfood tham khảo', exact: true }).click()
    const catalog = page.getByTestId('eat-clean-reference-catalog')
    const products = catalog.getByTestId('eat-clean-reference-product')
    await expect(catalog).toBeVisible()
    await expect(products).toHaveCount(15)
    await expect(catalog.getByText('Sản phẩm Fitfood, không phải món Aura đang bán.')).toBeVisible()
    await expect(catalog.getByText(/14\/10\/2026/)).toBeVisible()
    await expect(catalog.getByRole('button', { name: 'Thêm', exact: true })).toHaveCount(0)

    await catalog.getByRole('button', { name: 'Gói tuần', exact: true }).click()
    await expect(products).toHaveCount(9)
    await expect(catalog.getByRole('button', { name: 'Gói tuần', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const fit3 = catalog.locator('[data-product-id="fitfood-fit3"]')
    await expect(fit3.getByText('5 ngày / 10 bữa', { exact: true })).toBeVisible()
    await expect(fit3.getByRole('link')).toHaveAttribute('href', 'https://fitfood.vn/san-pham/fit3')
    await expect(fit3.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer')
    await expectNoHorizontalOverflow(page)

    await catalog.getByRole('button', { name: 'Tất cả', exact: true }).click()
    await catalog.getByRole('searchbox', { name: 'Tìm sản phẩm Fitfood' }).fill('sua hat')
    await expect(products).toHaveCount(1)
    await expect(catalog.getByRole('heading', { name: 'Sữa hạt Fitfood' })).toBeVisible()
    await catalog.getByRole('searchbox', { name: 'Tìm sản phẩm Fitfood' }).fill('khong-tim-thay')
    await expect(products).toHaveCount(0)
    await catalog.getByRole('button', { name: 'Xóa bộ lọc' }).click()
    await expect(products).toHaveCount(15)

    await page.getByRole('button', { name: 'Thực đơn Aura', exact: true }).click()
    await expect(page.locator('.eat-clean-meal-card')).toHaveCount(6)
    await expect(page.getByRole('heading', { name: 'Chọn bữa phù hợp' })).toBeVisible()
    await expect(page.locator('.eat-clean-cart-dock')).not.toBeVisible()
    expect(externalRequests).toEqual([])
    await expectNoHorizontalOverflow(page)
  })
})
