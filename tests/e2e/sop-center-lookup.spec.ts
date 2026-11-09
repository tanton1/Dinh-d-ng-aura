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

const steps = (page: Page) => page.locator('.sop-center-path-steps > li')
const openDetail = (page: Page) => page.locator('.sop-center-path-steps > li.is-open > .sop-center-path-detail')
const skillTabs = (page: Page) => openDetail(page).locator('.sop-center-path-skill-tabs button')

test('opening a step shows its skill, its content and the next step in place, and survives a reload', async ({ page }) => {
  await openSopCenter(page, '#/admin-sop?section=lookup&sop=sop02')
  await expect(steps(page)).toHaveCount(8)
  await expect(page.locator('.sop-center-path-detail')).toHaveCount(0)
  await expect(steps(page).nth(4).locator('.sop-center-path-step-tags em.is-primary')).toHaveText('Thiết kế trải nghiệm')
  await expect(steps(page).nth(4).locator('.sop-center-path-step-tags em.is-support')).toHaveText(['Khám phá & đánh giá', 'An toàn & bàn giao'])

  await steps(page).nth(4).getByRole('button', { expanded: false }).click()
  await expect(page).toHaveURL(/section=lookup&sop=sop02&step=4$/)
  await expect(steps(page).nth(4).getByRole('button').first()).toHaveAttribute('aria-expanded', 'true')
  const detail = openDetail(page)
  await expect(detail.locator('.sop-center-path-skill strong')).toHaveText('Thiết kế trải nghiệm')
  await expect(detail.locator('.sop-center-path-rows > button')).toHaveCount(2)
  await expect(detail.locator('.sop-center-path-done')).toContainText('Hoàn thành khi')
  await expect(detail.getByRole('button', { name: /Tiếp theo · Bước 06/ })).toBeVisible()

  await page.reload()
  await expect(openDetail(page).locator('.sop-center-path-skill strong')).toHaveText('Thiết kế trải nghiệm')

  // The next-step link walks the path; a second click on the open step closes it.
  await openDetail(page).getByRole('button', { name: /Tiếp theo · Bước 06/ }).click()
  await expect(page).toHaveURL(/sop=sop02&step=5$/)
  await expect(openDetail(page).locator('.sop-center-path-skill strong')).toHaveText('Lộ trình cá nhân hóa')
  await steps(page).nth(5).getByRole('button', { expanded: true }).click()
  await expect(page).toHaveURL(/section=lookup&sop=sop02$/)
  await expect(page.locator('.sop-center-path-detail')).toHaveCount(0)
})

test('a step switches between the skills it works with and hands off to another SOP', async ({ page }) => {
  await openSopCenter(page, '#/admin-sop?section=lookup&sop=sop02&step=4')
  await expect(skillTabs(page)).toHaveText(['Thiết kế trải nghiệm 2', 'Khám phá & đánh giá 4', 'An toàn & bàn giao 1'])
  await expect(skillTabs(page).first()).toHaveAttribute('aria-pressed', 'true')

  await skillTabs(page).nth(2).click()
  await expect(page).toHaveURL(/sop=sop02&step=4&skill=11$/)
  await expect(openDetail(page).locator('.sop-center-path-skill strong')).toHaveText('An toàn & bàn giao')
  await expect(openDetail(page).locator('.sop-center-path-rows > button')).toHaveCount(1)
  await page.reload()
  await expect(openDetail(page).locator('.sop-center-path-skill strong')).toHaveText('An toàn & bàn giao')
  await skillTabs(page).first().click()
  await expect(page).toHaveURL(/sop=sop02&step=4$/)

  const handoff = openDetail(page).locator('.sop-center-path-handoffs button')
  await expect(handoff).toHaveCount(1)
  await expect(handoff).toContainText('SOP 06')
  await handoff.click()
  await expect(page).toHaveURL(/section=lookup&sop=sop06$/)
  await expect(page.locator('.sop-center-path-head h2')).toHaveText('An toàn tập luyện & xử lý sự cố')
})

test('reference material and shared standards stay below the steps, never inside them', async ({ page }) => {
  await openSopCenter(page, '#/admin-sop?section=lookup&sop=sop04')
  await expect(steps(page)).toHaveCount(5)
  for (let index = 0; index < 5; index += 1) await expect(steps(page).nth(index).locator('.sop-center-path-step-tags em.is-primary')).toHaveText('Giữ chân & phục hồi')
  await expect(page.locator('.sop-center-path-facts')).toContainText('Tham chiếu')
  const groups = page.locator('.sop-center-path-groups summary')
  await expect(groups).toHaveText(['KPI 2', 'Giọng Aura 6', 'Escalation 11'])
  await expect(page.locator('.sop-center-path-steps')).not.toContainText('KPI')

  await steps(page).nth(2).getByRole('button', { expanded: false }).click()
  await expect(openDetail(page).locator('.sop-center-path-note')).toHaveText('Cùng kỹ năng với bước 01.')
  await expect(openDetail(page).locator('.sop-center-path-rows > button')).toHaveCount(6)
})

test('every skill of an SOP sits on a step; the pricing skill is reached from the step that proposes', async ({ page }) => {
  await openSopCenter(page, '#/admin-sop?section=lookup&sop=sop01')
  await expect(page.locator('.sop-center-path-facts')).toContainText('Kỹ năng')
  await expect(page.locator('.sop-center-path-skills')).toHaveCount(0)
  await steps(page).nth(3).getByRole('button', { expanded: false }).click()
  await expect(skillTabs(page)).toHaveText(['Ghép dịch vụ 7', 'Báo giá & ưu đãi 18', 'Xử lý băn khoăn 7'])
  await skillTabs(page).nth(1).click()
  await expect(page).toHaveURL(/sop=sop01&step=3&skill=5$/)
  await expect(openDetail(page).locator('.sop-center-path-rows > button')).toHaveCount(18)
})

test('a skill page lists its content and links back into the tree without naming itself', async ({ page }) => {
  await openSopCenter(page, '#/admin-sop?section=skills&resource=skill__19')
  const relations = page.locator('.sop-center-relations')
  await expect(relations).toContainText('11 nội dung dùng kỹ năng này')
  await expect(relations.getByRole('button', { name: /Member Onboarding/ })).toHaveCount(0)
  await relations.getByRole('button', { name: 'Xem trên cây' }).click()
  await expect(page).toHaveURL(/section=lookup&sop=sop03&skill=19/)
  // The addressed skill opens the first step that applies it.
  await expect(steps(page).first()).toHaveClass(/is-open/)
  await expect(openDetail(page).locator('.sop-center-path-skill strong')).toHaveText('Kích hoạt hội viên')

  await page.evaluate(() => { location.hash = '#/admin-sop?section=skills&resource=skill__9' })
  await expect(page.locator('.sop-center-relations')).toContainText('Phối hợp ở 1 bước')
  await expect(page.locator('.sop-center-relations')).toContainText('chưa có mẫu câu, hội thoại hay tình huống nào')
})

test('the lookup tree stays readable on a phone', async ({ page }) => {
  await openSopCenter(page, '#/admin-sop?section=lookup&sop=sop01&step=0', 375)
  await expect(openDetail(page).locator('.sop-center-path-rows > button').first()).toBeVisible()
  const result = await page.evaluate(() => {
    const tree = document.querySelector('.sop-center-lookup')!
    const tooSmall = [...tree.querySelectorAll('*')].filter((element) => {
      const hasText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim())
      return hasText && element.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(element).fontSize) < 12
    }).map((element) => `${getComputedStyle(element).fontSize} ${(element.textContent ?? '').trim().slice(0, 20)}`)
    const row = document.querySelector('.sop-center-path-steps > li.is-open .sop-center-path-rows > button')!
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
  await expect(panel.locator('.sop-center-step-skill-support button')).toHaveText(['Khám phá & đánh giá 4', 'An toàn & bàn giao 1'])
  await expect(panel.locator('.sop-center-step-skill-handoffs button')).toContainText('SOP 06')

  await panel.locator('.sop-center-step-skill-name').click()
  await expect(page).toHaveURL(/resource=skill__16/)
  const relations = page.locator('.sop-center-relations')
  await expect(relations).toContainText('Dùng ở 1 bước')
  await relations.getByRole('button', { name: /SOP 02 · B05/ }).click()
  await expect(page).toHaveURL(/resource=sop__sop02&step=4/)
  await expect(page.locator('.sop-center-process-rail li.is-active em')).toHaveText('Thiết kế trải nghiệm')

  // A skill no step applies as its own still shows where it works alongside others.
  await page.evaluate(() => { location.hash = '#/admin-sop?section=skills&resource=skill__5' })
  await expect(page.locator('.sop-center-relations')).toContainText('Phối hợp ở 6 bước')
  await page.locator('.sop-center-relations').getByRole('button', { name: /SOP 01 · B04/ }).click()
  await expect(page).toHaveURL(/resource=sop__sop01&step=3/)
})

test('the centre opens on the tree, old overview links land there, and a library narrows by kind chips', async ({ page }) => {
  await openSopCenter(page, '#/admin-sop?section=overview')
  await expect(page.locator('.sop-center-path-rail')).toBeVisible()
  await expect(page.locator('.sop-center-nav button.is-active')).toHaveText(/Tra cứu/)
  // One row of tabs, nothing before the tree.
  await expect(page.locator('.sop-center-nav button')).toHaveText([/Tra cứu/, /SOP/, /Kỹ năng/, /Mẫu câu/, /Tham chiếu/, /Chờ duyệt/])
  await expect(page.locator('.sop-center-ledger, .sop-center-coverage, .sop-center-help, .sop-center-filter-trigger, .sop-center-governance')).toHaveCount(0)

  await page.locator('.sop-center-nav').getByRole('button', { name: /Mẫu câu/ }).click()
  await expect(page).toHaveURL(/section=scripts$/)
  const chips = page.locator('.sop-center-chips button')
  await expect(chips).toHaveText(['Tất cả 166', 'Kịch bản 104', 'Hội thoại mẫu 41', 'Xử lý băn khoăn 21'])
  await chips.nth(3).click()
  await expect(page.locator('.sop-center-resource-row')).toHaveCount(21)
  await page.locator('.sop-center-sop-select select').selectOption('sop02')
  await expect(chips.nth(3)).toContainText('Xử lý băn khoăn')
  await expect(page.locator('.sop-center-library > header span').first()).toContainText('tài liệu')

  // A document page carries its status line in the header, not a side panel.
  await page.locator('.sop-center-resource-row').first().click()
  await expect(page.locator('.sop-center-detail-meta')).toContainText('Trạng thái')
  await expect(page.locator('.sop-center-workspace--single')).toBeVisible()
  await expect(page.locator('.sop-center-document-heading')).toHaveCount(0)
})

test('a step reads as four tabs, keeps the open tab across steps and in the address, and the tree opens the right tab', async ({ page }) => {
  await openSopCenter(page, '#/admin-sop?section=sops&resource=sop__sop02&step=4')
  const tabs = page.locator('.sop-center-step-tabs button')
  await expect(tabs).toHaveText([/Hướng dẫn/, /Mẫu câu\s*\d+/, /Tình huống\s*\d+/, /Kiểm tra\s*2/])
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#sop-step-panel-guide .sop-center-step-skill-name strong')).toHaveText('Thiết kế trải nghiệm')
  await expect(page.locator('#sop-step-panel-guide .sop-center-example blockquote.is-good')).toHaveCount(1)
  await expect(page.locator('.sop-center-quote-stack')).toHaveCount(0)

  await tabs.nth(2).click()
  await expect(page).toHaveURL(/resource=sop__sop02&step=4&view=cases$/)
  const groups = page.locator('.sop-center-case-groups button')
  await expect(groups.first()).toContainText('Tất cả')
  const total = Number((await groups.first().locator('small').textContent()) ?? '0')
  await expect(page.locator('#sop-step-panel-cases .sop-center-case-list article')).toHaveCount(total)
  await groups.nth(1).click()
  expect(await page.locator('#sop-step-panel-cases .sop-center-case-list article').count()).toBeLessThan(total)

  // The next step opens on the same tab; a reload keeps it.
  await page.locator('.sop-center-process-rail li').nth(5).getByRole('button').click()
  await expect(page).toHaveURL(/step=5&view=cases$/)
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true')
  await page.reload()
  await expect(page.locator('.sop-center-step-tabs button').nth(2)).toHaveAttribute('aria-selected', 'true')

  await openSopCenter(page, '#/admin-sop?section=lookup&sop=sop02&step=4')
  await openDetail(page).locator('.sop-center-path-open button').nth(1).click()
  await expect(page).toHaveURL(/resource=sop__sop02&step=4&view=say$/)
  await expect(page.locator('.sop-center-step-tabs button').nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#sop-step-panel-say .sop-center-quote-stack blockquote').first()).toBeVisible()
})

