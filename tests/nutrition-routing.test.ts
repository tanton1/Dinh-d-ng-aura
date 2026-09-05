import assert from 'node:assert/strict'
import test from 'node:test'
import {
  nutritionFoodDetailHash,
  nutritionSectionFromHash,
  nutritionSectionHash,
} from '../src/features/nutrition/routing'

function installHash(hash: string) {
  ;(globalThis as typeof globalThis & { window: unknown }).window = { location: { hash } }
}

test('legacy nutrition routes remain stable when UI 4.0 is off', () => {
  assert.equal(nutritionSectionHash('catalog'), '#/nutrition?section=catalog')
  assert.equal(nutritionSectionHash('insights'), '#/nutrition?section=insights')
  assert.equal(nutritionFoodDetailHash('food/a'), '#/nutrition?section=catalog&foodId=food%2Fa')
})

test('UI 4.0 nests catalog and insights under Explore', () => {
  assert.equal(nutritionSectionHash('catalog', true), '#/nutrition?section=explore&view=catalog')
  assert.equal(nutritionSectionHash('insights', true), '#/nutrition?section=explore&view=insights')
  assert.equal(nutritionFoodDetailHash('food/a', true), '#/nutrition?section=explore&view=catalog&foodId=food%2Fa')
  assert.equal(nutritionSectionHash('classic-diary', true), '#/nutrition?section=explore&view=diary')
  assert.equal(nutritionSectionHash('menu', true), '#/nutrition?section=explore&view=menu')
})

test('both legacy and UI 4.0 nutrition deep links resolve to the same task', () => {
  installHash('#/nutrition?section=catalog')
  assert.equal(nutritionSectionFromHash(), 'catalog')
  installHash('#/nutrition?section=explore&view=catalog')
  assert.equal(nutritionSectionFromHash(), 'catalog')
  installHash('#/nutrition?section=explore&view=insights')
  assert.equal(nutritionSectionFromHash(), 'insights')
  installHash('#/nutrition?section=explore&view=diary')
  assert.equal(nutritionSectionFromHash(), 'classic-diary')
  installHash('#/nutrition?section=explore&view=menu')
  assert.equal(nutritionSectionFromHash(), 'menu')
  installHash('#/nutrition?section=explore')
  assert.equal(nutritionSectionFromHash(), 'explore')
})
