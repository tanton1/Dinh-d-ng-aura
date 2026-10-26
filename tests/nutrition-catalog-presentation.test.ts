import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, statSync } from 'node:fs'
import { catalogServingLabel, uniqueCatalogItems } from '../src/features/nutrition/catalogPresentation'
import { getIngredientArtwork } from '../src/features/nutrition/ingredientArtwork'
import type { NutritionFoodCatalogItem } from '../src/features/nutrition/types'

const food: NutritionFoodCatalogItem = { id: 'source-a', kind: 'dish', name: 'Bánh bao chay', servingGrams: null, servingLabel: 'Trang nguồn không nêu rõ khẩu phần chuẩn', calories: 133, protein: 3, carbs: 24, fat: 3 }

test('duplicates keep the first complete source record and its original nutrition', () => {
  const duplicate = { ...food, id: 'source-b', name: '  BÁNH  BAO CHAY.', calories: 145 }
  assert.deepEqual(uniqueCatalogItems([food, duplicate]), [food])
})

test('accent, preparation, kind and known portion differences remain separate', () => {
  const items = [food, { ...food, name: 'Bánh bao thịt' }, { ...food, kind: 'food' as const },
    { ...food, servingLabel: '1 phần', servingGrams: 100 }, { ...food, servingLabel: '1 phần', servingGrams: 200 },
    { ...food, name: 'Cá' }, { ...food, name: 'Cà' }]
  assert.equal(uniqueCatalogItems(items).length, items.length)
})

test('source placeholders disappear while known grams and serving labels survive', () => {
  assert.equal(catalogServingLabel(food.servingLabel), '')
  assert.equal(catalogServingLabel('Khẩu phần tham chiếu theo nguồn'), '')
  assert.equal(catalogServingLabel(food.servingLabel, 100), '100 g')
  assert.equal(catalogServingLabel('100 g phần ăn được, sống/sạch', 100), '100 g phần ăn được, sống/sạch')
  assert.equal(catalogServingLabel('1 chén'), '1 chén')
})

test('all 853 source ingredients resolve to a valid image without fetching nutrition', () => {
  const source = JSON.parse(readFileSync(new URL('../data/nutrition/viendinhduong.records.json', import.meta.url), 'utf8'))
  const ingredients = source.records.filter((item: { kind: string }) => item.kind === 'food')
  assert.equal(ingredients.length, 853)
  const atlasFiles = new Set<string>()
  for (const ingredient of ingredients) {
    const image = getIngredientArtwork(ingredient.code)
    assert.ok(image, ingredient.nameVi)
    if (image.tile !== undefined) {
      assert.ok(image.tile >= 0 && image.tile < 36)
      atlasFiles.add(image.src)
    } else {
      assert.match(image.src, /^https:\/\/viendinhduong\.vn\/storage\//)
    }
  }
  assert.equal(atlasFiles.size, 17)
  for (const path of atlasFiles) {
    const file = new URL('../public' + path, import.meta.url)
    const bytes = readFileSync(file)
    assert.equal(bytes.subarray(8, 12).toString(), 'WEBP')
    assert.ok(statSync(file).size < 256 * 1024, path + ' exceeds thumbnail budget')
  }
  assert.equal(getIngredientArtwork('unmatched-code'), null)
})
