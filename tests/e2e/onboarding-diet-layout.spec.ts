import { expect, test, type Page } from '@playwright/test'

test('untouched onboarding defaults are committed when the member skips setup', async ({ page }) => {
  await page.goto('/#/profile')
  await page.getByRole('button', { name: /Cập nhật/i }).first().click()
  await page.getByRole('button', { name: 'Thiết lập hồ sơ' }).click()
  await expect(page.getByRole('heading', { name: /Giới tính sinh học/i })).toBeVisible()
  await page.getByRole('button', { name: 'Để sau' }).click()
  await expect(page).toHaveURL(/#\/courses$/)

  const saved = await page.evaluate(() => JSON.parse(
    window.localStorage.getItem('aura:profile:demo-admin') ?? '{}',
  ))
  expect(saved.birthYear).toBe(1995)
  expect(saved.heightCm).toBe(165)
  expect(saved.weightKg).toBe(60)
  expect(saved.onboardingData).toMatchObject({ birthYear: 1995, heightCm: 165, weightKg: 60 })
})

async function reachDietStep(page: Page) {
  await page.goto('/#/profile')
  await page.getByRole('button', { name: /Cập nhật/i }).first().click()
  await page.getByRole('button', { name: 'Thiết lập hồ sơ' }).click()

  await page.getByText('Nữ giới', { exact: true }).click()
  await page.getByRole('button', { name: 'Tiếp tục' }).click()
  await page.getByRole('button', { name: 'Tiếp tục' }).click()
  await page.getByRole('button', { name: 'Tiếp tục' }).click()
  await page.getByRole('button', { name: 'Tiếp tục' }).click()
  await page.getByText('Duy trì vóc dáng', { exact: true }).click()
  await page.getByRole('button', { name: 'Tiếp tục' }).click()
  await page.getByRole('button', { name: 'Tiếp tục' }).click()
  await page.getByText('Ít vận động', { exact: true }).click()
  await page.getByRole('button', { name: 'Tiếp tục' }).click()
  await page.getByText('Tốt', { exact: true }).click()
  await page.getByRole('button', { name: 'Tiếp tục' }).click()
  await page.getByText('😌 Ít', { exact: true }).click()

  const onboarding = page.locator('.onboarding-content')
  await onboarding.evaluate((element) => { element.scrollTop = element.scrollHeight })
  await page.getByRole('button', { name: 'Tiếp tục' }).click()

  await expect(page.getByRole('heading', { name: 'Chế độ ăn uống?' })).toBeVisible()
  await expect(onboarding).toHaveClass(/onboarding-content--diet/)
}

for (const viewport of [
  { name: 'portrait', width: 390, height: 844 },
  { name: 'landscape', width: 844, height: 390 },
]) {
  test(`diet onboarding stays inside a ${viewport.name} mobile viewport`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await reachDietStep(page)

    const layout = await page.evaluate(() => {
      const content = document.querySelector<HTMLElement>('.onboarding-content')!
      const heading = document.querySelector<HTMLElement>('.diet-step-heading')!
      const cta = document.querySelector<HTMLElement>('.diet-step-cta')!
      return {
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        contentOverflow: content.scrollWidth - content.clientWidth,
        contentScrollTop: content.scrollTop,
        headingTop: heading.getBoundingClientRect().top,
        ctaBottom: cta.getBoundingClientRect().bottom,
        viewportHeight: window.innerHeight,
      }
    })

    expect(layout.documentOverflow).toBeLessThanOrEqual(1)
    expect(layout.contentOverflow).toBeLessThanOrEqual(1)
    expect(layout.contentScrollTop).toBe(0)
    expect(layout.headingTop).toBeGreaterThanOrEqual(44)
    expect(layout.ctaBottom).toBeLessThanOrEqual(layout.viewportHeight)

    await page.getByText('Cân bằng', { exact: true }).click()
    const selectedOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(selectedOverflow).toBeLessThanOrEqual(1)
  })
}
