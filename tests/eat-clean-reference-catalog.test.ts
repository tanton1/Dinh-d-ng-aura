import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { DEMO_EAT_CLEAN_MEALS, createDemoQuote } from '../src/features/eat-clean/demoCatalog'
import {
  EAT_CLEAN_PACKAGE_GROUPS,
  EAT_CLEAN_PACKAGES,
  filterEatCleanPackages,
  packageImagePath,
  packagePricePerMeal,
  type EatCleanPackage,
} from '../src/features/eat-clean/referenceCatalog'

test('combo catalog has nine weekly plans and six add-ons', () => {
  assert.equal(EAT_CLEAN_PACKAGES.length, 15)
  assert.equal(EAT_CLEAN_PACKAGES.filter((item) => item.group === 'weekly').length, 9)
  assert.equal(new Set(EAT_CLEAN_PACKAGES.map((item) => item.id)).size, 15)
  const groups = new Set(EAT_CLEAN_PACKAGE_GROUPS.map((group) => group.id))
  for (const product of EAT_CLEAN_PACKAGES) {
    assert.ok(groups.has(product.group))
    assert.ok(product.name && product.description && product.unitLabel)
    assert.ok(Number.isInteger(product.price) && product.price > 0)
    assert.equal('sourceUrl' in product, false)
    if (product.weeklyPlan) {
      assert.equal(product.group, 'weekly')
      assert.equal(product.weeklyPlan.days, 5)
      assert.ok(product.weeklyPlan.meals.length > 0)
    }
  }
})

test('weekly price comparison divides by all meals, not just the number of days', () => {
  const dual = EAT_CLEAN_PACKAGES.find((item) => item.id === 'aura-weekly-dual')!
  const full = EAT_CLEAN_PACKAGES.find((item) => item.id === 'aura-weekly-full')!
  const lunch = EAT_CLEAN_PACKAGES.find((item) => item.id === 'aura-weekly-lunch')!
  assert.equal(packagePricePerMeal(dual), 65000)
  assert.equal(packagePricePerMeal(full), 55000)
  assert.equal(packagePricePerMeal(lunch), 75000)
  assert.equal(packagePricePerMeal(EAT_CLEAN_PACKAGES.find((item) => item.id === 'aura-drinks-nut')!), undefined)
  const invalid = { ...dual, weeklyPlan: { days: 0, meals: [] } } satisfies EatCleanPackage
  assert.equal(packagePricePerMeal(invalid), undefined)
})

test('combos can be filtered and searched without Vietnamese accents', () => {
  assert.equal(filterEatCleanPackages('weekly', '').length, 9)
  assert.equal(filterEatCleanPackages('drinks', '').length, 2)
  assert.equal(filterEatCleanPackages('snacks', '').length, 2)
  assert.equal(filterEatCleanPackages('all', '  SUA HAT  ')[0]?.id, 'aura-drinks-nut')
  assert.equal(filterEatCleanPackages('all', 'ức gà')[0]?.id, 'aura-prepared-chicken')
  assert.equal(filterEatCleanPackages('weekly', 'sua hat').length, 0)
  assert.equal(filterEatCleanPackages('all', 'unknown-product').length, 0)
})

test('combo data stays separate from the Aura meal catalog', () => {
  const auraIds = new Set(DEMO_EAT_CLEAN_MEALS.map((meal) => meal.id))
  for (const product of EAT_CLEAN_PACKAGES) {
    assert.equal(auraIds.has(product.id), false)
    assert.equal('available' in product, false)
    assert.equal('nutrition' in product, false)
    assert.equal('imageUrl' in product, false)
    assert.equal(createDemoQuote([{ mealId: product.id, quantity: 1 }]).lines.length, 0)
  }
})

test('catalog only uses local images and a clear path into the live menu', () => {
  const component = readFileSync(new URL('../src/features/eat-clean/EatCleanReferenceCatalog.tsx', import.meta.url), 'utf8')
  assert.match(component, /onBrowseMenu/)
  assert.match(component, /Xem món để đặt/)
  assert.match(component, /packageImagePath\(product\)/)
  assert.match(component, /loading=\{index < 2 \? 'eager' : 'lazy'\}/)
  assert.doesNotMatch(component, /target="_blank"|sourceUrl|Nội bộ|tham khảo/)
  for (const product of EAT_CLEAN_PACKAGES) {
    assert.match(packageImagePath(product), /^\/images\/eat-clean\/reference\//)
  }
})
