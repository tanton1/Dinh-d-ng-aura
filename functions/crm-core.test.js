'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const core = require('./crm-core')

test('Vietnamese phones normalise to E.164 and back to a readable local form', () => {
  for (const raw of ['0901234567', '090 123 4567', '+84 901-234-567', '84901234567', '(090) 123.4567']) {
    assert.equal(core.normalizePhone(raw), '+84901234567', raw)
  }
  assert.equal(core.normalizePhone('02838123456'), '+842838123456')
  assert.equal(core.normalizePhone('+6591234567'), '+6591234567')
  for (const raw of ['', '12345', '0101234567', 'abc0901234567', '09012345678']) assert.equal(core.normalizePhone(raw), null, raw)
  assert.equal(core.displayPhone('+84901234567'), '0901 234 567')
  assert.equal(core.localPhone('+84901234567'), '0901234567')
  assert.ok(core.phoneLookupVariants('+84901234567').includes('0901 234 567'))
  assert.ok(core.phoneLookupVariants('+84901234567').includes('0901234567'))
})

test('phones typed in a chat message are found without inventing others', () => {
  assert.deepEqual(core.phonesInText('Số em 0901 234 567 nha, hoặc +84 912-345-678'), ['+84901234567', '+84912345678'])
  assert.deepEqual(core.phonesInText('Gói 12 buổi giá 3.500.000đ'), [])
})

test('search tokens match name prefixes without accents and phone endings', () => {
  const tokens = core.searchTokens('Nguyễn Thị Lan', ['+84901234567'])
  for (const token of ['ng', 'nguyen', 'th', 'thi', 'la', 'lan', '0901234567', '#4567']) assert.ok(tokens.includes(token), token)
  assert.deepEqual(core.searchQuery('Lan nguy'), { token: 'nguy', words: ['lan', 'nguy'] })
  assert.deepEqual(core.searchQuery('090 123 4567'), { token: '0901234567', words: [] })
  assert.deepEqual(core.searchQuery('4567'), { token: '#4567', words: [] })
  assert.equal(core.matchesSearch({ displayName: 'Nguyễn Thị Lan' }, core.searchQuery('lan ng')), true)
  assert.equal(core.matchesSearch({ displayName: 'Nguyễn Thị Lan' }, core.searchQuery('lan tran')), false)
  assert.equal(core.searchQuery('  '), null)
})

test('Pancake times, HTML bodies and attachments are read defensively', () => {
  assert.equal(core.pancakeTime('2026-11-08T13:14:00'), Date.parse('2026-11-08T13:14:00Z'))
  assert.equal(core.pancakeTime('2026-11-08T13:14:00+07:00'), Date.parse('2026-11-08T06:14:00Z'))
  assert.equal(core.pancakeTime(1_762_600_000), 1_762_600_000_000)
  assert.equal(core.pancakeTime(1_762_600_000_123), 1_762_600_000_123)
  assert.equal(core.pancakeTime('not a date'), 0)
  assert.equal(core.plainText('<div>Chào em<br>Gói &amp; giá?</div>'), 'Chào em\nGói & giá?')
  const message = core.normalizePancakeMessage({
    id: 'm_1', from: { id: '9001', name: 'Lan' }, message: '<p>Cho chị xin giá</p>', inserted_at: '2026-11-08T13:14:00',
    attachments: [{ type: 'photo', url: 'https://cdn.example/a.jpg' }, { type: 'sticker', url: 'http://insecure/s.png' }, {}],
  }, { pageId: '123', externalCustomerId: '9001' })
  assert.equal(message.direction, 'in')
  assert.equal(message.text, 'Cho chị xin giá')
  assert.deepEqual(message.attachments.map((item) => [item.type, item.url]), [['image', 'https://cdn.example/a.jpg'], ['sticker', '']])
  const reply = core.normalizePancakeMessage({ id: 'm_2', from: { id: '123', admin_id: 'u-7' }, original_message: 'Dạ chào chị', inserted_at: 1_762_600_100 }, { pageId: '123', externalCustomerId: '9001' })
  assert.equal(reply.direction, 'out')
  assert.equal(reply.senderPancakeUserId, 'u-7')
  assert.equal(core.normalizePancakeMessage({ message: 'no id' }, { pageId: '123' }), null)
})

test('a Pancake conversation yields the customer id, phones, tags and assignees', () => {
  const conversation = core.normalizePancakeConversation({
    id: '123_9001', type: 'INBOX', customers: [{ id: 'pc-1', fb_id: '9001', name: 'Lan' }],
    tags: [{ id: 5 }, 7], assignee_ids: ['u-7'], recent_phone_numbers: [{ phone_number: '0901234567' }, 'bad'],
    snippet: '<b>Giá</b> gói?', updated_at: '2026-11-08T13:14:00', seen: false, last_sent_by: { id: '9001' },
  }, '123')
  assert.equal(conversation.externalCustomerId, '9001')
  assert.equal(conversation.pageCustomerId, 'pc-1')
  assert.deepEqual(conversation.tagIds, ['5', '7'])
  assert.deepEqual(conversation.assigneeIds, ['u-7'])
  assert.deepEqual(conversation.phones, ['+84901234567'])
  assert.equal(conversation.snippet, 'Giá gói?')
  assert.equal(conversation.unread, true)
  assert.equal(conversation.lastSentByPage, false)
  assert.equal(core.normalizePancakeConversation({ id: '123_42' }, '123').externalCustomerId, '42')
})

test('webhook bodies of several shapes still name the conversation', () => {
  assert.deepEqual(
    pick(core.webhookRefs({ event_type: 'messaging', page_id: '123', data: { conversation: { id: '123_9' }, message: { id: 'm_1' } } })),
    { topic: 'messaging', pageId: '123', conversationId: '123_9', messageId: 'm_1' },
  )
  assert.deepEqual(pick(core.webhookRefs({ type: 'conversation', conversation_id: '123_9' })), { topic: 'conversation', pageId: '', conversationId: '123_9', messageId: '' })
  assert.equal(core.webhookRefs({ message: { id: 'm', conversation_id: 'c' } }).topic, 'messaging')
  assert.equal(core.webhookRefs(null).topic, 'unknown')
})

function pick({ topic, pageId, conversationId, messageId }) {
  return { topic, pageId, conversationId, messageId }
}

test('reply state finds the unanswered stretch and the first response', () => {
  const at = (minute) => Date.UTC(2026, 10, 8, 3, minute)
  const state = core.replyState([
    { direction: 'in', sentAt: at(0) },
    { direction: 'in', sentAt: at(1) },
    { direction: 'out', sentAt: at(4) },
    { direction: 'in', sentAt: at(10) },
    { direction: 'in', sentAt: at(12) },
  ])
  assert.equal(state.awaitingSince, at(10))
  assert.equal(state.firstInboundAt, at(0))
  assert.equal(state.firstResponseAt, at(4))
  assert.equal(state.lastOutboundAt, at(4))
  assert.equal(core.replyState([{ direction: 'in', sentAt: at(0) }, { direction: 'out', sentAt: at(2) }]).awaitingSince, null)
})

test('reply SLA counts from opening hours in Vietnam time', () => {
  const vn = (hour, minute = 0) => Date.UTC(2026, 10, 8, hour - 7, minute)
  assert.equal(core.slaDueAt(vn(10, 0), 5), vn(10, 5))
  assert.equal(core.slaDueAt(vn(6, 30), 5), vn(8, 5))
  assert.equal(core.slaDueAt(vn(22, 15), 5), Date.UTC(2026, 10, 9, 8 - 7, 5))
  assert.equal(core.vietnamDateKey(vn(23, 30)), '2026-11-08')
})

test('stage rules require a reason to lose and a student to win', () => {
  assert.match(core.stageIssue({ stage: 'consulting' }, 'lost'), /lý do/)
  assert.equal(core.stageIssue({ stage: 'consulting' }, 'lost', { lostReason: 'price' }), '')
  assert.match(core.stageIssue({ stage: 'quote_sent' }, 'won'), /học viên/)
  assert.equal(core.stageIssue({ stage: 'quote_sent', studentId: 's1' }, 'won'), '')
  assert.match(core.stageIssue({ stage: 'won', studentId: 's1' }, 'consulting'), /sau bán/)
  assert.match(core.stageIssue({ stage: 'new_inbox' }, 'unknown'), /không hợp lệ/)
})

test('CRM scope keeps sales in their branch and care owners after the signing date', () => {
  const sales = core.crmScope({ uid: 'sales-1', accessRole: 'staff', positions: ['sales'], branchIds: ['q7'], capabilities: ['crm.customers.branch.view', 'crm.customers.self.manage', 'crm.messages.presale.read', 'crm.messages.postsale.read', 'crm.steps.assigned.manage'] })
  assert.deepEqual(core.customerAccess(sales, { branchId: 'q7' }), { view: true, manage: true, presale: true, postsale: true })
  assert.deepEqual(core.customerAccess(sales, { branchId: 'q1' }), { view: false })
  const care = core.crmScope({ uid: 'care-1', accessRole: 'staff', positions: ['customer_care'], branchIds: ['q7'], capabilities: ['crm.messages.postsale.read', 'crm.steps.assigned.manage'] })
  assert.equal(core.customerAccess(care, { branchId: 'q7', studentId: 's1', careOwnerUid: 'care-2' }).view, false)
  assert.deepEqual(core.customerAccess(care, { branchId: 'q7', studentId: 's1', careOwnerUid: 'care-1' }), { view: true, manage: false, presale: false, postsale: true, care: true })
  const trainer = core.crmScope({ uid: 'uid-pt', legacyStaffId: 'trainer-9', accessRole: 'staff', positions: ['trainer_pt'], branchIds: ['q7'], capabilities: ['crm.messages.postsale.read', 'crm.steps.assigned.manage'] })
  assert.equal(core.customerAccess(trainer, { branchId: 'q7', studentId: 's1', careOwnerStaffId: 'trainer-9' }).care, true)
  assert.equal(core.customerAccess(trainer, { branchId: 'q7', careOwnerStaffId: 'trainer-9' }).view, false, 'no student, no post-sale access')
  const coach = core.crmScope({ uid: 'c', accessRole: 'staff', positions: ['coach_online'], branchIds: ['q7'], capabilities: [] })
  assert.equal(core.usesCrm(coach), false)
  const admin = core.crmScope({ uid: 'a', accessRole: 'admin', positions: [], branchIds: [], capabilities: ['crm.integration.manage', 'crm.customers.erase'] })
  assert.equal(admin.integration && admin.erase && admin.manage, true)
  assert.equal(core.crmScope({ uid: 'x', accessRole: 'staff', capabilities: ['crm.integration.manage'] }).integration, false, 'integration is admin-only')
})

test('page tokens are encrypted with authentication and webhook secrets compare by hash', () => {
  const key = 'k'.repeat(32)
  const sealed = core.encryptToken('page-token-123', key)
  assert.equal(JSON.stringify(sealed).includes('page-token-123'), false)
  assert.equal(core.decryptToken(sealed, key), 'page-token-123')
  assert.throws(() => core.decryptToken({ ...sealed, ciphertext: Buffer.from('tampered').toString('base64') }, key))
  assert.throws(() => core.decryptToken(sealed, 'x'.repeat(32)))
  assert.throws(() => core.encryptToken('t', 'short'))
  const secret = core.newWebhookSecret()
  assert.ok(secret.length >= 30)
  assert.equal(core.webhookSecretMatches(secret, core.webhookSecretHash(secret)), true)
  assert.equal(core.webhookSecretMatches(`${secret}x`, core.webhookSecretHash(secret)), false)
  assert.equal(core.webhookSecretMatches(secret, ''), false)
})

test('identifiers are deterministic and safe as Firestore document ids', () => {
  assert.equal(core.conversationKey('123', '123_9001'), '123__123_9001')
  assert.match(core.conversationKey('123', 'a/b'), /^h_[0-9a-f]{40}$/)
  assert.equal(core.customerIdForLink('facebook__123__9001'), core.customerIdForLink('facebook__123__9001'))
  assert.match(core.messageDocId('m_abc$%'), /^m_[0-9a-f]{32}$/)
  assert.equal(core.channelLinkId({ platform: 'facebook', pageId: '123', externalCustomerId: '9001' }), 'facebook__123__9001')
  assert.equal(core.platformForPage('igo_17841'), 'instagram')
  assert.equal(core.platformForPage('pzl_123'), 'zalo')
  assert.equal(core.platformForPage('123456'), 'facebook')
  assert.equal(core.platformForPage('123456', 'tiktok'), 'tiktok')
  assert.equal(core.pageIdValid('123'), true)
  assert.equal(core.pageIdValid('../x'), false)
})
