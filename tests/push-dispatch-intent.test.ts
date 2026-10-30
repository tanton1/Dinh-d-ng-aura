import test from 'node:test'
import assert from 'node:assert/strict'
import { clearPushIntent, readPushIntent, savePushIntent, type PendingPushIntent } from '../src/services/pushDispatchIntent'

const storage = () => {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
}
const intent: PendingPushIntent = { version: 1, actorId: 'admin-a', requestId: 'intent_12345',
  payload: { requestId: 'intent_12345', title: 'Title', message: 'Message', type: 'INFO', targetType: 'individual', targetUserIds: ['member-a'] },
  draft: { title: 'Title', message: 'Message', type: 'INFO', category: 'general', audience: 'individual', userId: 'member-a', actionUrl: '/home' } }

test('pending intent survives reload with the same request ID, content and audience', () => {
  const store = storage(); savePushIntent(store, intent)
  assert.deepEqual(readPushIntent(store, 'admin-a'), intent)
  assert.equal(readPushIntent(store, 'admin-b'), null)
  clearPushIntent(store, 'admin-a'); assert.equal(readPushIntent(store, 'admin-a'), null)
})
test('refuse dispatch setup when storage cannot retain recovery intent', () => {
  assert.throws(() => savePushIntent({ setItem: () => {}, getItem: () => null }, intent), /Chưa gửi thông báo nào/)
  assert.throws(() => savePushIntent({ setItem: () => { throw Error('quota') }, getItem: () => null }, intent), /Chưa gửi thông báo nào/)
})
test('ignore malformed, cross-actor or mismatched recovery records', () => {
  const store = storage()
  for (const value of ['{', JSON.stringify({ ...intent, actorId: 'admin-b' }), JSON.stringify({ ...intent, payload: { ...intent.payload, requestId: 'different' } })]) {
    store.setItem('aura:push-intent:v1:admin-a', value)
    assert.equal(readPushIntent(store, 'admin-a'), null)
  }
})
