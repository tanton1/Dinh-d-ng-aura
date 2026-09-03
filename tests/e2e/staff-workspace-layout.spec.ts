import { expect, test } from '@playwright/test'

test('staff dock prioritizes work modules and schedule tools share one weekly workspace', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/home')

  await page.getByRole('button', { name: /Tài khoản/ }).click()
  await page.getByRole('button', { name: 'PT Gym' }).click()

  await expect(page).toHaveURL(/#\/staff-dashboard$/)

  const dock = page.getByRole('navigation', { name: 'Điều hướng Staff' })
  await expect(dock).toBeVisible()
  await expect(dock.getByRole('button')).toHaveCount(6)
  expect(await dock.getByRole('button').allTextContents()).toEqual([
    'Tổng quan',
    'Học viên',
    'Lịch',
    'Giáo án',
    'Duyệt món',
    'Lương',
  ])

  await dock.getByRole('button', { name: 'Tổng quan' }).click()
  await expect(page).toHaveURL(/#\/staff-dashboard$/)
  await expect(page.getByTestId('staff-dashboard-page')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Tổng quan công việc Staff' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Biểu đồ lương và hoa hồng ca dạy trong tháng' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Truy cập nhanh' })).toHaveCount(0)
  await expect(page.locator('.staff-dashboard__timeline > button')).toHaveCount(7)

  await page.getByRole('button', { name: 'Mở menu' }).click()
  const sidebar = page.locator('#app-sidebar')
  await expect(sidebar.getByText('CÔNG VIỆC', { exact: true })).toBeVisible()
  for (const label of ['Tổng quan Staff', 'Học viên phụ trách', 'Lịch làm việc', 'Giáo án & mức tạ', 'Duyệt món', 'Tái ký', 'Lương của tôi']) {
    await expect(sidebar.getByRole('button', { name: new RegExp(label) })).toBeVisible()
  }
  await expect(sidebar.getByRole('button', { name: /Báo giá/ })).toHaveCount(0)
  await expect(sidebar.getByRole('button', { name: /Lịch rảnh/ })).toHaveCount(0)
  await expect(sidebar.getByRole('button', { name: /Yêu cầu lịch/ })).toHaveCount(0)

  await sidebar.getByRole('button', { name: /Lịch làm việc/ }).click()
  await expect(page).toHaveURL(/#\/staff-schedule$/)
  await expect(page.getByTestId('staff-schedule-workspace')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Các phần lịch làm việc' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Ma trận lịch dạy chi tiết cả tuần' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Lịch rảnh/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Yêu cầu/ })).toBeVisible()
  await expect(sidebar.getByText('Trợ giúp', { exact: true })).toHaveCount(0)
  await expect(sidebar.getByText('Cài đặt', { exact: true })).toHaveCount(0)
  await expect(sidebar.getByText('Mở trang quản trị', { exact: true })).toHaveCount(0)

  await dock.getByRole('button', { name: 'Giáo án' }).click()
  await expect(page).toHaveURL(/#\/staff-workouts$/)
  await expect(page.getByRole('heading', { name: 'Giáo án & mức tạ' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Nội dung giáo án' })).toBeVisible()
  await page.getByRole('button', { name: /Thư viện/ }).click()
  await expect(page.getByRole('region', { name: 'Quản lý thư viện bài tập' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Kho bài tập Aura' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Thêm bài tập/ })).toBeVisible()

  await dock.getByRole('button', { name: 'Học viên' }).click()
  await expect(page).toHaveURL(/#\/staff-students$/)
  await expect(page.getByRole('heading', { name: 'Học viên phụ trách' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Tìm học viên' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Lọc theo chi nhánh' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Lọc theo phân công' })).toBeVisible()
  await expect(page.getByText('buổi được phân công')).toHaveCount(0)

  await page.getByRole('button', { name: 'Xem hồ sơ & lịch sử' }).first().click()
  await expect(page.getByRole('dialog', { name: /Nguyễn Minh Anh/ })).toBeVisible()
  const studentDetail = page.getByRole('dialog', { name: /Nguyễn Minh Anh/ })
  await expect(studentDetail.getByRole('button', { name: /Lịch sử/ })).toBeVisible()
  await expect(studentDetail.getByRole('button', { name: /Giáo án/ })).toBeVisible()
  await expect(studentDetail.getByText('Lịch đã xếp trong tuần')).toBeVisible()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)

  await studentDetail.getByRole('button', { name: /Lịch sử/ }).click()
  await expect(studentDetail.getByText(/Lịch sử tập · Nguyễn Minh Anh/)).toBeVisible()
  await expect(studentDetail.getByText(/Firebase Functions chưa/)).toHaveCount(0)

  await studentDetail.getByRole('button', { name: /Giáo án/ }).click()
  await studentDetail.locator('summary').first().click()
  await expect(studentDetail.getByText('Đẩy hông với tạ đòn')).toBeVisible()

  await studentDetail.getByRole('button', { name: 'Tổng quan' }).click()
  await studentDetail.getByRole('button', { name: /Mở giáo án/ }).click()
  await expect(page).toHaveURL(/#\/staff-workouts$/)
  await expect(page.getByRole('combobox', { name: 'Học viên' })).toHaveValue('student-a')
})
