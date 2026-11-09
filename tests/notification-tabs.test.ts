import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mergeNotifications,
  notificationTabFor,
  notificationTabFromHash,
  pickDefaultTab,
  relativeTimeLabel,
  sortNotifications,
  unreadCountsByTab,
} from '../src/features/notifications/notificationTabs'
import type { AppNotification } from '../src/types'

function item(overrides: Partial<AppNotification>): AppNotification {
  return { id: 'n', userId: 'u', title: 't', message: 'm', type: 'INFO', read: false, ...overrides }
}

test('category decides the tab; legacy items fall back to kind and type', () => {
  assert.equal(notificationTabFor(item({ category: 'workout' })), 'schedule')
  assert.equal(notificationTabFor(item({ category: 'payment' })), 'payment')
  assert.equal(notificationTabFor(item({ category: 'availability' })), 'availability')
  assert.equal(notificationTabFor(item({ category: 'loyalty' })), 'other')
  assert.equal(notificationTabFor(item({ kind: 'availability_remind' })), 'availability')
  assert.equal(notificationTabFor(item({ type: 'WORKOUT' })), 'schedule')
  assert.equal(notificationTabFor(item({ type: 'PAYMENT' })), 'payment')
  assert.equal(notificationTabFor(item({})), 'other')
})

test('unread badges count per tab and the default tab prefers a deep link, then urgency', () => {
  const counts = unreadCountsByTab([
    item({ id: 'a', category: 'workout' }),
    item({ id: 'b', category: 'availability' }),
    item({ id: 'c', category: 'payment', read: true }),
  ])
  assert.deepEqual(counts, { schedule: 1, payment: 0, availability: 1, other: 0 })
  assert.equal(pickDefaultTab({ hashTab: 'other', unread: counts, lastTab: null }), 'other')
  assert.equal(pickDefaultTab({ hashTab: null, unread: counts, lastTab: 'other' }), 'schedule')
  assert.equal(pickDefaultTab({ hashTab: null, unread: { schedule: 0, payment: 0, availability: 0, other: 0 }, lastTab: 'payment' }), 'payment')
  assert.equal(notificationTabFromHash('#/notifications?tab=availability'), 'availability')
  assert.equal(notificationTabFromHash('#/notifications?tab=nope'), null)
})

test('time labels are short like a chat inbox', () => {
  const now = new Date('2026-11-10T19:30:00+07:00')
  assert.equal(relativeTimeLabel(null, now), 'Vừa xong')
  assert.equal(relativeTimeLabel(new Date('2026-11-10T19:29:40+07:00'), now), 'Vừa xong')
  assert.equal(relativeTimeLabel(new Date('2026-11-10T19:05:00+07:00'), now), '25 phút')
  assert.equal(relativeTimeLabel(new Date('2026-11-10T08:00:00+07:00'), now), '11 giờ')
  assert.equal(relativeTimeLabel(new Date('2026-11-09T23:50:00+07:00'), now), 'Hôm qua')
  assert.equal(relativeTimeLabel(new Date('2026-11-07T10:00:00+07:00'), now), '3 ngày')
  assert.equal(relativeTimeLabel(new Date('2026-10-30T10:00:00+07:00'), now), '30/10')
})

test('merging keeps the freshest copy and sorting puts pending server timestamps first', () => {
  const merged = mergeNotifications([item({ id: 'a', read: true })], [item({ id: 'a', read: false }), item({ id: 'b' })])
  assert.deepEqual(merged.map((value) => [value.id, value.read]), [['a', true], ['b', false]])
  const sorted = sortNotifications([
    item({ id: 'old', createdAt: new Date('2026-11-01T00:00:00Z') }),
    item({ id: 'pending' }),
    item({ id: 'new', createdAt: { seconds: Date.parse('2026-11-09T00:00:00Z') / 1000 } }),
  ])
  assert.deepEqual(sorted.map((value) => value.id), ['pending', 'new', 'old'])
})
