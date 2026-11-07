import { expect, test, type Page } from '@playwright/test'

test.skip(({ browserName }) => browserName !== 'chromium', 'The lookup tree is engine-independent; one engine covers it.')

async function openSopCenter(page: Page, hash: string, width = 1440) {
  // The admin switch lives in the desktop sidebar; enter there, then resize.
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/home')
  await expect(page.locator('#aura-today-flow-title')).toBeVisible()
  await page.getByRole('button', { name: 'Mở trang quản trị' }).click()
  await expect(page).toHaveURL(/#\/admin-dashboard/)
  await page.setViewportSize({ width, height: 900 })
  await page.evaluate((target) => { location.hash = target }, hash)
}

const knowledgeRows = (page: Page) => page.locator('.sop-center-tree-knowledge > .sop-center-tree-results > button')

test('choosing a step narrows the content to its skill in place and survives a reload', async ({ page }) => {
  await openSopCenter(page, '#/admin-sop?section=lookup&sop=sop02')
  const steps = page.locator('.sop-center-tree-steps button')
  await expect(steps).toHaveCount(8)
  await expect(page.locator('.sop-center-tree-knowledge .sop-center-tree-label strong')).toHaveText('Nội dung riêng của SOP 02')

  await steps.nth(4).click()
  await expect(page).toHaveURL(/section=lookup&sop=sop02&skill=16/)
  await expect(page.locator('.sop-center-lookup')).toBeVisible()
  await expect(page.locator('.sop-center-tree-knowledge .sop-center-tree-label strong')).toHaveText('Thiết kế trải nghiệm')
  await expect(knowledgeRows(page)).toHaveCount(2)

  await page.reload()
  await expect(page.locator('.sop-center-tree-knowledge .sop-center-tree-label strong')).toHaveText('Thiết kế trải nghiệm')
  await page.getByRole('button', { name: 'Bỏ lọc kỹ năng' }).click()
  await expect(page).toHaveURL(/section=lookup&sop=sop02$/)
})

test('every SOP shows only its own content, with shared guidance kept apart', async ({ page }) => {
  await openSopCenter(page, '#/admin-sop?section=lookup&sop=sop04')
  await expect(page.locator('.sop-center-tree-knowledge .sop-center-tree-label small')).toHaveText('8 tài liệu')
  await expect(page.locator('.sop-center-tree-shared summary')).toContainText('Áp dụng mọi SOP')
  await expect(page.locator('.sop-center-tree-filters')).not.toContainText('Giọng Aura')
})

test('a skill page lists its content and links back into the tree without naming itself', async ({ page }) => {
  await openSopCenter(page, '#/admin-sop?section=skills&resource=skill__19')
  const relations = page.locator('.sop-center-relations')
  await expect(relations).toContainText('11 nội dung dùng kỹ năng này')
  await expect(relations.getByRole('button', { name: /Member Onboarding/ })).toHaveCount(0)
  await relations.getByRole('button', { name: 'Xem trên cây' }).click()
  await expect(page).toHaveURL(/section=lookup&sop=sop03&skill=19/)
  await expect(page.locator('.sop-center-tree-note')).toContainText('nội dung ở SOP khác')

  await page.evaluate(() => { location.hash = '#/admin-sop?section=skills&resource=skill__9' })
  await expect(page.locator('.sop-center-relations')).toContainText('chưa có mẫu câu, hội thoại hay tình huống nào')
})

test('the lookup tree stays readable on a phone', async ({ page }) => {
  await openSopCenter(page, '#/admin-sop?section=lookup&sop=sop01', 375)
  await expect(knowledgeRows(page).first()).toBeVisible()
  const result = await page.evaluate(() => {
    const tree = document.querySelector('.sop-center-lookup')!
    const tooSmall = [...tree.querySelectorAll('*')].filter((element) => {
      const hasText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim())
      return hasText && element.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(element).fontSize) < 12
    }).map((element) => `${getComputedStyle(element).fontSize} ${(element.textContent ?? '').trim().slice(0, 20)}`)
    const row = document.querySelector('.sop-center-tree-knowledge > .sop-center-tree-results > button')!
    const mark = row.querySelector('.sop-center-kind-mark')!.getBoundingClientRect()
    const title = row.querySelector('strong')!.getBoundingClientRect()
    return { tooSmall, overflow: document.documentElement.scrollWidth - innerWidth, overlap: mark.bottom > title.top + 1 && mark.right > title.left }
  })
  expect(result.tooSmall).toEqual([])
  expect(result.overflow).toBe(0)
  expect(result.overlap).toBe(false)
})

test('each SOP step names its skill, and a skill page opens the steps that use it', async ({ page }) => {
  await openSopCenter(page, '#/admin-sop?section=sops&resource=sop__sop02')
  const rail = page.locator('.sop-center-process-rail')
  await expect(rail.locator('li button em')).toHaveCount(8)
  await expect(rail.locator('li').nth(4).locator('em')).toHaveText('Thiết kế trải nghiệm')

  await rail.locator('li').nth(4).locator('button').click()
  await expect(page).toHaveURL(/resource=sop__sop02&step=4/)
  const panel = page.getByRole('region', { name: 'Kỹ năng áp dụng cho bước này' })
  await expect(panel.locator('.sop-center-step-skill-name strong')).toHaveText('Thiết kế trải nghiệm')
  await expect(panel).toContainText('2 nội dung của kỹ năng này trong SOP 02')

  await panel.locator('.sop-center-step-skill-name').click()
  await expect(page).toHaveURL(/resource=skill__16/)
  const relations = page.locator('.sop-center-relations')
  await expect(relations).toContainText('Dùng ở 1 bước')
  await relations.getByRole('button', { name: /SOP 02 · B05/ }).click()
  await expect(page).toHaveURL(/resource=sop__sop02&step=4/)
  await expect(page.locator('.sop-center-process-rail li.is-active em')).toHaveText('Thiết kế trải nghiệm')

  // A skill only declared on an SOP, with no step of its own, says so.
  await page.evaluate(() => { location.hash = '#/admin-sop?section=skills&resource=skill__5' })
  await expect(page.locator('.sop-center-relations')).toContainText('Kỹ năng hỗ trợ xuyên suốt SOP 01, không gắn vào bước cụ thể.')
})
