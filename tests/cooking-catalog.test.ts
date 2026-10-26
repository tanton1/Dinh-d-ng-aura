import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { cookingHash, cookingRoute, cookingStorageKey, filterCookingRecipes, readSavedRecipes, writeSavedRecipes } from '../src/features/cooking/model'
import type { Cookbook } from '../src/features/cooking/types'
import { getCurrentRoute } from '../src/routing/appRouting'
import { isStaffPersonalRoute } from '../src/routing/staffWorkspace'

const book: Cookbook = JSON.parse(readFileSync('src/features/cooking/data/cookbook.json', 'utf8'))
const recipe = (id: string) => book.recipes.find((item) => item.id === id)!

test('all 60 source IDs, chapters, instructions, photos and unchanged PDFs are present', () => {
  assert.equal(book.recipes.length, 60)
  assert.equal(new Set(book.recipes.map((item) => item.id)).size, 60)
  const prefixes = ['B', 'M', 'V', 'R', 'S', 'C']
  const counts = [10, 14, 8, 10, 8, 10]
  book.chapters.forEach((chapter, index) => {
    assert.equal(chapter.count, counts[index])
    const items = book.recipes.filter((item) => item.chapterId === chapter.id)
    assert.deepEqual(items.map((item) => item.id), Array.from({ length: counts[index] }, (_, i) => `${prefixes[index]}${String(i + 1).padStart(2, '0')}`))
    const pdf = readFileSync(resolve('public', chapter.pdf))
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
    assert.equal(createHash('sha256').update(pdf).digest('hex'), chapter.sourceSha256)
  })
  for (const item of book.recipes) {
    assert.ok(item.ingredients.length >= 3 && item.ingredients.every((ingredient) => ingredient.name && ingredient.amount), item.id)
    assert.equal(item.steps.length, item.chapterId === '6' ? 3 : 4, item.id)
    assert.ok(item.steps.every((step) => step.title && step.text.length > 20), item.id)
    assert.ok(item.timeLabels.length && item.portionNote && item.allergenNote && item.tip, item.id)
    assert.ok(existsSync(resolve('public', item.image)) && existsSync(resolve('public', item.thumbnail)), item.id)
    assert.equal(item.servings, item.chapterId === '6' ? 4 : 2)
    assert.equal(item.kcalPerServing % 5, 0)
    assert.equal('protein' in item, false)
  }
})

test('source-specific portions, waiting times, raw/cooked units and sauce rounding survive import', () => {
  assert.equal(recipe('B01').kcalPerServing, 265)
  assert.match(recipe('B01').portionNote, /Kcal cho 1\/2 công thức/)
  assert.match(recipe('B08').timeLabels.join(' '), /6-12 giờ/)
  assert.match(recipe('S06').timeLabels.join(' '), /4-6 giờ/)
  assert.match(recipe('M01').timeNote, /Ướp 15 phút/)
  assert.match(recipe('M01').steps[2].text, /74°C/)
  assert.match(recipe('S05').portionDetail, /sáu bánh.*hai phần/)
  assert.match(recipe('V08').ingredients[0].name, /chín/)
  assert.equal(recipe('V07').ingredients.at(-1)?.amount, '40 ml + nước trụng bún')
  assert.deepEqual(recipe('C07').timeLabels, ['Chuẩn bị 10 phút', 'Nấu 20 phút'])
  assert.deepEqual(recipe('C08').timeLabels, ['Chuẩn bị 10 phút', 'Nấu 8 phút'])
  assert.equal(recipe('C05').kcalPerServing, 65)
  assert.equal(recipe('C05').batchKcal, 270)
  assert.match(recipe('C08').ingredients[0].amount, /không đường/)
  for (const id of ['C09', 'C10']) {
    assert.equal(recipe(id).requiresCooking, true)
    assert.match(recipe(id).steps[2].text, /không dùng để chấm/)
    assert.match(recipe(id).timeNote, /15-30 phút/)
  }
})

test('search composes accent-insensitive name/ingredient matching with chapter and saved filters', () => {
  const find = (query: string, chapter = '', savedOnly = false) => filterCookingRecipes(book.recipes, query, chapter, savedOnly, new Set(['V01', 'B01']))
  assert.ok(find('DAU HU CA CHUA').some((item) => item.id === 'V01'))
  assert.ok(find('nấm mỡ').some((item) => item.id === 'V01'))
  assert.deepEqual(find('', '', true).map((item) => item.id), ['B01', 'V01'])
  assert.deepEqual(find('', '3', true).map((item) => item.id), ['V01'])
  assert.equal(find('khongco123').length, 0)
})

test('bookmarks stay actor-scoped; corrupt or blocked storage never blocks reading', () => {
  const map = new Map<string, string>()
  const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value) } }
  assert.equal(writeSavedRecipes(storage, 'a', new Set(['B01'])), true)
  assert.deepEqual([...readSavedRecipes(storage, 'a')], ['B01'])
  assert.equal(readSavedRecipes(storage, 'b').size, 0)
  map.set(cookingStorageKey('a'), '{bad')
  assert.equal(readSavedRecipes(storage, 'a').size, 0)
  map.set(cookingStorageKey('a'), JSON.stringify(['B01', '__proto__', 42]))
  assert.deepEqual([...readSavedRecipes(storage, 'a')], ['B01'])
  const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('full') } }
  assert.equal(readSavedRecipes(blocked, 'a').size, 0)
  assert.equal(writeSavedRecipes(blocked, 'a', new Set(['B01'])), false)
})

test('direct links reach the cooking route and stay in the staff personal workspace', () => {
  const oldWindow = globalThis.window
  Object.assign(globalThis, { window: { location: { hash: cookingHash('C09', true) } } })
  try {
    assert.equal(getCurrentRoute().view, 'cooking')
    assert.deepEqual(cookingRoute(window.location.hash), { recipeId: 'C09', cooking: true })
    assert.equal(cookingHash(), '#/cooking')
    assert.equal(isStaffPersonalRoute({ view: 'cooking', studentId: null }), true)
  } finally { Object.assign(globalThis, { window: oldWindow }) }
})
