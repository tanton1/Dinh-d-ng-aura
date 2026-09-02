import { expect, test } from '@playwright/test'

test('nutrition scan result stays responsive and does not expose Coach/PT suggestions', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('aura:nutrition-profile:demo-admin', JSON.stringify({
      goal: 'maintain',
      age: 28,
      biologicalSex: 'female',
      heightCm: 162,
      weightKg: 58,
      activityLevel: 'moderate',
      trainingSessions: 4,
      eatingStyle: 'Không giới hạn',
      allergies: '',
      mealsPerDay: 3,
      dislikes: '',
      budget: 'medium',
      prepTime: 'medium',
      favoriteCuisine: 'Đa dạng',
      reminders: { water: false, breakfast: false, lunch: false, dinner: false },
    }))
  })
  await page.goto('/#/nutrition?section=scan')
  await page.getByTestId('nutrition-demo-scan').click()

  const result = page.getByTestId('nutrition-scan-result')
  await expect(result).toBeVisible()
  await expect(result.getByText('Gợi ý từ Coach/PT', { exact: false })).toHaveCount(0)
  await expect(result.getByText('Dữ liệu minh họa chưa sử dụng hồ sơ và mục tiêu thực tế của bạn.')).toBeVisible()
  await expect(result.getByText(/điều chỉnh khẩu phần phù hợp với mục tiêu calo/i)).toBeVisible()
  await expect(result.getByText(/đánh giá lượng đạm, carb, béo và chất xơ/i)).toBeVisible()
  await expect(result.getByRole('heading', { name: 'Giúp Aura tính sát bữa ăn thực tế' })).toBeVisible()
  await expect(result.getByText('0/1 đã rõ')).toBeVisible()
  await result.getByRole('button', { name: 'Cần sửa' }).click()
  await result.getByPlaceholder(/thêm 1 trứng/i).fill('chỉ ăn một nửa phần sốt')
  await expect(result.getByText(/Đã ghi nhận mô tả.*Aura tính lại/i)).toBeVisible()
  await expect(result.getByRole('button', { name: /Aura tính lại từ phần sửa/i })).toBeDisabled()
  await expect(result.getByText(/Ảnh gốc không còn trong phiên này/i)).toBeVisible()
  await result.getByRole('button', { name: 'Không rõ' }).click()
  await expect(result.getByText(/giữ số liệu AI ban đầu.*mở rộng khoảng ước tính/i)).toBeVisible()
  await result.getByRole('button', { name: 'Đúng' }).click()
  await expect(result.getByText('1/1 đã rõ')).toBeVisible()

  const macroGrid = result.locator('.nutrition-scan-result__macro-grid')
  const ingredient = result.locator('.nutrition-scan-result__ingredient').first()
  const stepper = result.locator('.nutrition-scan-result__gram-stepper').first()

  await expect(macroGrid).toHaveCSS('display', 'grid')
  await expect(ingredient).toHaveCSS('display', 'grid')
  await expect(stepper).toHaveCSS('display', 'flex')

  const layout = await result.evaluate((element) => {
    const root = element.getBoundingClientRect()
    const grid = element.querySelector('.nutrition-scan-result__macro-grid')?.getBoundingClientRect()
    const ingredientCard = element.querySelector('.nutrition-scan-result__ingredient')?.getBoundingClientRect()
    const gramStepper = element.querySelector('.nutrition-scan-result__gram-stepper')?.getBoundingClientRect()
    return {
      rootWidth: root.width,
      gridWidth: grid?.width ?? 0,
      ingredientWidth: ingredientCard?.width ?? 0,
      stepperWidth: gramStepper?.width ?? 0,
    }
  })

  expect(layout.rootWidth).toBeGreaterThan(300)
  expect(layout.gridWidth).toBeGreaterThan(280)
  expect(layout.ingredientWidth).toBeGreaterThan(280)
  expect(layout.stepperWidth).toBeGreaterThan(95)

  if (process.env.SCAN_SCREENSHOT) {
    await result.locator('.nutrition-scan-result__hero').scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'test-results/nutrition-scan-mobile-top.png' })
    await ingredient.scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'test-results/nutrition-scan-mobile-ingredients.png' })
  }

  await result.getByRole('button', { name: /Xem chi tiết/i }).click()
  await expect(result.getByText('Cơ sở dự đoán Khối lượng & Kcal')).toBeVisible()
  await expect(result.getByText('Gợi ý từ Coach/PT', { exact: false })).toHaveCount(0)

  if (process.env.SCAN_SCREENSHOT) {
    await page.screenshot({ path: 'test-results/nutrition-scan-mobile-detail.png' })
  }

  await result.getByRole('button', { name: /Lưu vào nhật ký/i }).click()
  await page.getByRole('heading', { name: /Cơm gạo lứt đỏ, Ức gà áp chảo/i }).click()

  const mealDetail = page.getByTestId('captured-meal-detail-page')
  await expect(mealDetail).toBeVisible()
  await expect(mealDetail.getByRole('heading', { name: 'Phân tích từ Aura AI' })).toBeVisible()
  await expect(mealDetail.getByText('🎯 Mức độ phù hợp với mục tiêu')).toBeVisible()
  await expect(mealDetail.getByText('🔥 Mẹo tối ưu calo')).toBeVisible()
  await expect(mealDetail.getByText('⚖️ Cân bằng Macro')).toBeVisible()
  await expect(mealDetail.getByText('🍽️ Phương pháp chế biến & Định lượng')).toBeVisible()
  await expect(mealDetail.getByText('📏 Cơ sở dự đoán Khối lượng & Kcal')).toBeVisible()
  await expect(mealDetail.getByText('Tư vấn từ AI Coach', { exact: false })).toHaveCount(0)

  if (process.env.SCAN_SCREENSHOT) {
    await mealDetail.getByRole('heading', { name: 'Phân tích từ Aura AI' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'test-results/nutrition-meal-detail-mobile.png' })
  }
})
