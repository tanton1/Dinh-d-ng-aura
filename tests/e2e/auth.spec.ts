import { expect, test } from '@playwright/test'

test('phone OTP signup is friendly, testable and responsive', async ({ page }) => {
  await page.goto('/#/auth-preview')

  await expect(page.getByTestId('auth-page')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible()
  await expect(page.getByAltText('Aura Fit')).toBeVisible()
  await expect(page.getByRole('button', { name: /Tiếp tục với Google/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Đăng nhập bằng số điện thoại' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Đăng nhập bằng Email' })).toBeVisible()
  await expect(page.locator('#aura-recaptcha-container')).toHaveCount(1)

  await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click()
  await page.getByRole('button', { name: 'Tạo tài khoản bằng số điện thoại' }).click()
  await expect(page.locator('#phone-otp-button')).toHaveCount(1)
  await expect(page.getByText(/reCAPTCHA/)).toBeVisible()
  await expect(page.locator('.auth-recaptcha-disclosure a')).toHaveCount(2)
  await page.getByPlaceholder('Nguyễn Minh Anh').fill('Minh Anh')
  await page.getByPlaceholder('0912 345 678').fill('0912 345 678')
  await page.getByRole('button', { name: 'Nhận mã OTP' }).click()

  await expect(page.getByText('Mã thử nghiệm')).toBeVisible()
  const otpText = await page.locator('.auth-feedback--success strong').innerText()
  const otp = otpText.replace(/\D/g, '')
  await page.getByLabel('Mã OTP').fill(otp)
  // A complete one-time code must submit itself. This is essential on iOS
  // landscape where the software keyboard leaves very little vertical space.
  await expect(page.getByText(/Xác thực thành công/i)).toBeVisible()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

for (const viewport of [
  { name: 'iPhone SE portrait', width: 375, height: 667 },
  { name: 'iPhone portrait', width: 390, height: 844 },
  { name: 'large iPhone portrait', width: 430, height: 932 },
  { name: 'iPhone landscape', width: 844, height: 390 },
]) {
  test(`OTP action remains inside the fixed ${viewport.name} viewport`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/#/auth-preview')
    await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click()
    await page.getByRole('button', { name: 'Tạo tài khoản bằng số điện thoại' }).click()
    await page.getByPlaceholder('Nguyễn Minh Anh').fill('Minh Anh')
    await page.getByPlaceholder('0912 345 678').fill('0912 345 678')
    await page.getByRole('button', { name: 'Nhận mã OTP' }).click()

    const action = page.getByRole('button', { name: 'Xác minh và tiếp tục' })
    await expect(action).toBeVisible()
    const layout = await page.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>('.auth-primary-button')!
      const bounds = button.getBoundingClientRect()
      return {
        bodyScrollHeight: document.body.scrollHeight,
        bodyScrollWidth: document.body.scrollWidth,
        viewportWidth: window.visualViewport?.width ?? window.innerWidth,
        viewportHeight: window.visualViewport?.height ?? window.innerHeight,
        buttonLeft: bounds.left,
        buttonRight: bounds.right,
        buttonTop: bounds.top,
        buttonBottom: bounds.bottom,
        scrollY: window.scrollY,
        textSizeAdjust: getComputedStyle(document.documentElement).webkitTextSizeAdjust,
      }
    })
    expect(layout.bodyScrollHeight).toBeLessThanOrEqual(layout.viewportHeight + 1)
    expect(layout.bodyScrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 1)
    expect(layout.buttonLeft).toBeGreaterThanOrEqual(0)
    expect(layout.buttonRight).toBeLessThanOrEqual(layout.viewportWidth + 1)
    expect(layout.buttonTop).toBeGreaterThanOrEqual(0)
    expect(layout.buttonBottom).toBeLessThanOrEqual(layout.viewportHeight + 1)
    expect(layout.scrollY).toBe(0)
    expect(layout.textSizeAdjust).toBe('100%')
  })
}

test('email remains available as an alternate sign-in method', async ({ page }) => {
  await page.goto('/#/auth-preview')
  await page.getByRole('button', { name: 'Đăng nhập bằng Email' }).click()
  await expect(page.getByPlaceholder('ban@aurafitness.vn')).toBeVisible()
  await expect(page.getByPlaceholder('Tối thiểu 6 ký tự')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Quên mật khẩu?' })).toBeVisible()
})
