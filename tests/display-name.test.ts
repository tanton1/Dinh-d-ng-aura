import assert from 'node:assert/strict'
import test from 'node:test'
import { greetingName } from '../src/utils/displayName'

test('greets Vietnamese-ordered names by the given name', () => {
  assert.equal(greetingName('Nguyễn Minh An'), 'An')
  assert.equal(greetingName('Nguyễn An'), 'An')
  assert.equal(greetingName('  Trần   Thị  Mai '), 'Mai')
})

test('greets two-word Western-ordered names by the given name', () => {
  assert.equal(greetingName('An Nguyễn'), 'An')
  assert.equal(greetingName('Minh TRẦN'), 'Minh')
})

test('keeps the last word when both words could be family names or the name is single', () => {
  assert.equal(greetingName('Nguyễn Mai'), 'Mai')
  assert.equal(greetingName('Linh'), 'Linh')
  assert.equal(greetingName('John Smith'), 'Smith')
})

test('falls back when the name is empty', () => {
  assert.equal(greetingName('   '), 'bạn')
  assert.equal(greetingName('', 'học viên'), 'học viên')
})
