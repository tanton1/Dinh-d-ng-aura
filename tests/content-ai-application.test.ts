import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendGeneratedItems, appendGeneratedText } from '../src/utils/contentAiApplication'

test('replaying a quiz or memory generation preserves edits and never adds its items twice', () => {
  const first = appendGeneratedItems([{ id: 'manual', question: 'Manual' }], [{ question: 'AI question' }], 'receipt_a', 'quiz')
  const edited = first.map(item => ({ ...item, question: item.id === 'manual' ? item.question : 'Edited by teacher' }))
  const replay = appendGeneratedItems(edited, [{ question: 'AI question' }], 'receipt_a', 'quiz')
  assert.deepEqual(replay, edited)
  assert.equal(replay.length, 2)
  const next = appendGeneratedItems(replay, [{ question: 'Another result' }], 'receipt_b', 'quiz')
  assert.equal(next.length, 3)
  assert.equal(next[1].question, 'Edited by teacher')
  assert.notEqual(next[1].id, next[2].id)
})

test('text recovery adds each generated takeaway once while preserving preexisting content', () => {
  const previous = ['Manual note', 'Existing', 'Existing']
  const once = appendGeneratedText(previous, ['Existing', 'New', 'New'])
  assert.deepEqual(once, ['Manual note', 'Existing', 'Existing', 'New'])
  assert.deepEqual(appendGeneratedText(once, ['Existing', 'New', 'New']), once)
  assert.deepEqual(previous, ['Manual note', 'Existing', 'Existing'])
})
