import { expect, test } from '@playwright/test'

test('phone OTP signup is friendly, testable and responsive', async ({ page }) => {
  await page.goto('/#/auth-preview')

  await expect(page.getByTestId('auth-page')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Đăng nhập để tiếp tục hành trình' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Tiếp tục với Google/ })).toBeVisible()
  await expect(page.getByText('Google sẵn sàng')).toBeVisible()
  await expect(page.getByText('OTP Việt Nam')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Số điện thoại' })).toHaveClass(/is-active/)
  await expect(page.locator('#aura-recaptcha-container')).toHaveCount(1)

  await page.getByRole('tab', { name: 'Tạo tài khoản' }).click()
  await page.getByPlaceholder('Nguyễn Minh Anh').fill('Minh Anh')
  await page.getByPlaceholder('0912 345 678').fill('0912 345 678')
  await page.getByRole('button', { name: 'Nhận mã OTP' }).click()

  await expect(page.getByText('Mã thử nghiệm')).toBeVisible()
  const otp = await page.locator('.auth-demo-otp strong').innerText()
  await page.getByLabel('Mã OTP').fill(otp)
  await page.getByRole('button', { name: 'Xác minh và tiếp tục' }).click()
  await expect(page.getByText(/Xác thực thành công/i)).toBeVisible()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('email remains available as an alternate sign-in method', async ({ page }) => {
  await page.goto('/#/auth-preview')
  await page.getByRole('button', { name: 'Email' }).click()
  await expect(page.getByPlaceholder('ban@aurafitness.vn')).toBeVisible()
  await expect(page.getByPlaceholder('Tối thiểu 6 ký tự')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Quên mật khẩu?' })).toBeVisible()
})
