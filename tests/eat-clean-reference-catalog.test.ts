import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { DEMO_EAT_CLEAN_MEALS, createDemoQuote } from '../src/features/eat-clean/demoCatalog'
import {
  EAT_CLEAN_REFERENCE_GROUPS,
  FITFOOD_REFERENCE_PRODUCTS,
  FITFOOD_REFERENCE_SOURCE,
  filterEatCleanReferenceProducts,
  referenceImagePath,
  referencePricePerMeal,
  type EatCleanReferenceProduct,
} from '../src/features/eat-clean/referenceCatalog'

test('reference catalog has nine weekly plans and six add-ons with verified source URLs', () => {
  assert.equal(FITFOOD_REFERENCE_PRODUCTS.length, 15)
  assert.equal(FITFOOD_REFERENCE_PRODUCTS.filter((item) => item.group === 'weekly').length, 9)
  assert.equal(new Set(FITFOOD_REFERENCE_PRODUCTS.map((item) => item.id)).size, 15)
  assert.equal(FITFOOD_REFERENCE_SOURCE.checkedOn, '2026-10-14')
  const groups = new Set(EAT_CLEAN_REFERENCE_GROUPS.map((group) => group.id))
  for (const product of FITFOOD_REFERENCE_PRODUCTS) {
    const source = new URL(product.sourceUrl)
    assert.equal(source.protocol, 'https:')
    assert.equal(source.hostname, 'fitfood.vn')
    assert.match(source.pathname, /^\/san-pham\//)
    assert.ok(groups.has(product.group))
    assert.ok(product.name && product.description && product.unitLabel)
    assert.ok(Number.isInteger(product.referencePrice) && product.referencePrice > 0)
    if (product.weeklyPlan) {
      assert.equal(product.group, 'weekly')
      assert.equal(product.weeklyPlan.days, 5)
      assert.ok(product.weeklyPlan.meals.length > 0)
    }
  }
})

test('weekly price comparison divides by all meals, not just the number of days', () => {
  const fit3 = FITFOOD_REFERENCE_PRODUCTS.find((item) => item.id === 'fitfood-fit3')!
  const full = FITFOOD_REFERENCE_PRODUCTS.find((item) => item.id === 'fitfood-full')!
  const lunch = FITFOOD_REFERENCE_PRODUCTS.find((item) => item.id === 'fitfood-lunch')!
  assert.equal(referencePricePerMeal(fit3), 65000)
  assert.equal(referencePricePerMeal(full), 55000)
  assert.equal(referencePricePerMeal(lunch), 75000)
  assert.equal(referencePricePerMeal(FITFOOD_REFERENCE_PRODUCTS.find((item) => item.id === 'fitfood-nut-milk')!), undefined)
  const invalid = { ...fit3, weeklyPlan: { days: 0, meals: [] } } satisfies EatCleanReferenceProduct
  assert.equal(referencePricePerMeal(invalid), undefined)
})

test('reference products can be filtered and searched without Vietnamese accents', () => {
  assert.equal(filterEatCleanReferenceProducts('weekly', '').length, 9)
  assert.equal(filterEatCleanReferenceProducts('drinks', '').length, 2)
  assert.equal(filterEatCleanReferenceProducts('snacks', '').length, 2)
  assert.equal(filterEatCleanReferenceProducts('all', '  SUA HAT  ')[0]?.id, 'fitfood-nut-milk')
  assert.equal(filterEatCleanReferenceProducts('all', 'ức gà')[0]?.id, 'fitfood-chicken-150')
  assert.equal(filterEatCleanReferenceProducts('weekly', 'sua hat').length, 0)
  assert.equal(filterEatCleanReferenceProducts('all', 'unknown-product').length, 0)
})

test('reference data does not masquerade as Aura meals or enter demo quotes', () => {
  const auraIds = new Set(DEMO_EAT_CLEAN_MEALS.map((meal) => meal.id))
  for (const product of FITFOOD_REFERENCE_PRODUCTS) {
    assert.equal(auraIds.has(product.id), false)
    assert.equal('available' in product, false)
    assert.equal('nutrition' in product, false)
    assert.equal('imageUrl' in product, false)
    assert.equal(createDemoQuote([{ mealId: product.id, quantity: 1 }]).lines.length, 0)
  }
})

test('catalog keeps provider caveats and does not invent nutrition values', () => {
  const vegetarian = FITFOOD_REFERENCE_PRODUCTS.find((item) => item.id === 'fitfood-veg')!
  const rice = FITFOOD_REFERENCE_PRODUCTS.find((item) => item.id === 'fitfood-brown-rice')!
  const snack = FITFOOD_REFERENCE_PRODUCTS.find((item) => item.id === 'fitfood-seaweed-snack')!
  const chicken = FITFOOD_REFERENCE_PRODUCTS.find((item) => item.id === 'fitfood-chicken-150')!
  assert.match(vegetarian.caution!, /không thuần chay/)
  assert.match(rice.caution!, /không mặc định.*chay/)
  assert.equal(rice.nutritionNote, undefined)
  assert.equal(snack.nutritionNote, undefined)
  assert.equal(chicken.referencePrice, 370000)
  assert.match(chicken.caution!, /trang chi tiết/)
})

test('catalog view is read-only and uses Aura-hosted illustration images', () => {
  const component = readFileSync(new URL('../src/features/eat-clean/EatCleanReferenceCatalog.tsx', import.meta.url), 'utf8')
  assert.match(component, /Sản phẩm tham khảo, không phải món Aura đang bán/)
  assert.match(component, /referenceImagePath\(product\)/)
  assert.match(component, /Ảnh minh họa/)
  assert.doesNotMatch(component, /target="_blank"|href=\{product\.sourceUrl\}/)
  assert.doesNotMatch(component, /onAdd|httpsCallable|\bfetch\(/)
  for (const product of FITFOOD_REFERENCE_PRODUCTS) {
    assert.match(referenceImagePath(product), /^\/images\/eat-clean\/reference\//)
  }
})
