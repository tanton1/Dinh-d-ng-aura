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
})
