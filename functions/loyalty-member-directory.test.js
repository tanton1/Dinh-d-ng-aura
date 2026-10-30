'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { memberSearchPrefixes, directorySourceChanged, directoryValue, normalizeDirectoryInput } = require('./loyalty-member-directory')

test('member search supports accent-free word and phrase prefixes and bounded phone prefixes', () => {
  const values = memberSearchPrefixes({ name: 'Phạm Đỗ Mai', phone: '090 123 4567' })
  for (const query of ['pham', 'do mai', 'mai', '090123']) assert.ok(values.includes(query))
  assert.ok(!values.includes('am do'), 'search is a word prefix, not an unbounded substring scan')
  assert.equal(new Set(values).size, values.length)
  assert.ok(memberSearchPrefixes({ name: 'a '.repeat(500), phone: '1'.repeat(500) }).length <= 2440)
  const input = normalizeDirectoryInput({ query: '090 (123)-45' }, { uid: 'admin', accessRole: 'admin' })
  assert.equal(input.query, '09012345')
  assert.ok(values.includes(input.query))
})

test('directory never enrolls a historic wallet and removes inactive/deleted profiles', () => {
  const student = { name: 'Mai', branchId: 'a', loyaltyMembership: { managed: true } }
  assert.equal(directoryValue('s', null, { tierQualifyingValue: 90_000_000 }), null)
  assert.equal(directoryValue('s', {}, {}), null)
  assert.equal(directoryValue('s', { ...student, status: 'inactive' }, {}), null)
  assert.equal(directoryValue('s', { ...student, accountDeletedAt: '2026-01-01' }, {}), null)
  assert.equal(directoryValue('s', student, { tier: 'member', tierQualifyingValue: 25_000_000 }).tier, 'gold')
  assert.equal(directoryValue('s', student, null).tier, 'member')
})

test('only directory-relevant changes trigger synchronization', () => {
  const student = { name: 'Mai', loyaltyMembership: { managed: true } }
  assert.equal(directorySourceChanged('students', student, { ...student, revision: 2 }), false)
  assert.equal(directorySourceChanged('students', student, { ...student, name: 'Ngọc Mai' }), true)
  assert.equal(directorySourceChanged('students', { name: 'A' }, { name: 'B' }), false)
  assert.equal(directorySourceChanged('loyaltyAccounts', { tierQualifyingValue: 1 }, { tierQualifyingValue: 2 }), true)
  assert.equal(directorySourceChanged('loyaltyAccounts', { availablePoints: 1 }, { availablePoints: 2 }), false)
})

test('cursor is bound to actor, access, branch, tier and normalized query', () => {
  const actor = { uid: 'a', accessRole: 'staff', authzVersion: 3, branchIds: ['b', 'a'] }
  const data = { tier: 'gold', query: 'Đỗ Mai' }
  const input = normalizeDirectoryInput(data, actor)
  const cursor = Buffer.from(JSON.stringify({ v: 2, scope: input.scope, id: 'student-1001' })).toString('base64url')
  assert.equal(normalizeDirectoryInput({ ...data, cursor }, actor).after, 'student-1001')
  for (const different of [{ ...actor, uid: 'other' }, { ...actor, branchIds: ['a'] }, { ...actor, authzVersion: 4 }]) {
    assert.throws(() => normalizeDirectoryInput({ ...data, cursor }, different), { code: 'invalid-argument' })
  }
  assert.throws(() => normalizeDirectoryInput({ ...data, tier: 'silver', cursor }, actor), { code: 'invalid-argument' })
  assert.throws(() => normalizeDirectoryInput({ pageSize: 101 }, actor), { code: 'invalid-argument' })
  assert.throws(() => normalizeDirectoryInput({ query: 'a'.repeat(81) }, actor), { code: 'invalid-argument' })
})
