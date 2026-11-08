'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createCrmSync } = require('./crm-sync')
const { PancakeApiError } = require('./crm-pancake-client')
const { channelLinkId, conversationKey, customerIdForLink } = require('./crm-core')
const { createMemoryFirestore } = require('./test-support/crm-memory-firestore')

const T0 = Date.UTC(2026, 10, 8, 6, 14) // 13:14 in Vietnam, inside opening hours
const MINUTE = 60_000
const DAY = 86_400_000
const PAGE = { name: 'Aura Q7', platform: 'facebook', branchId: 'q7', enabled: true, status: 'active', staffMap: { 'u-7': { uid: 'sales-1', name: 'Minh Sales' } }, tagMap: { quote_sent: '11', won: '12' } }
const naive = (ms) => new Date(ms).toISOString().replace('Z', '').replace(/\.\d+$/, '')

function fakePancake() {
  const state = { conversations: [], messages: {}, calls: [], failWith: null }
  const client = {
    async listConversations({ since, until, lastConversationId } = {}) {
      state.calls.push(['list', { since, until, lastConversationId }])
      let rows = [...state.conversations]
        .filter((row) => (!since || Date.parse(`${row.updated_at}Z`) >= since) && (!until || Date.parse(`${row.updated_at}Z`) <= until))
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      if (lastConversationId) rows = rows.slice(rows.findIndex((row) => row.id === lastConversationId) + 1)
      return rows.slice(0, 60)
    },
    async getMessages({ conversationId, currentCount = 0 }) {
      state.calls.push(['messages', { conversationId, currentCount }])
      if (state.failWith) throw state.failWith
      const all = state.messages[conversationId] || []
      const end = all.length - currentCount
      return { messages: end > 0 ? all.slice(Math.max(0, end - 25), end) : [], customers: [] }
    },
    async setTag(args) { state.calls.push(['tag', args]) },
    async assign(args) { state.calls.push(['assign', args]) },
    async listTags() { return [] },
    async listUsers() { return [] },
  }
  return { state, client }
}

function setup(seed = {}, { now = T0 + 2 * MINUTE } = {}) {
  const db = createMemoryFirestore({ 'crmPancakePages/123': PAGE, ...seed })
  const pancake = fakePancake()
  let clock = now
  const pages = {
    page: async (pageId) => (db.data(`crmPancakePages/${pageId}`) ? { ...db.data(`crmPancakePages/${pageId}`), pageId } : null),
    client: async () => pancake.client,
    forget() {},
  }
  const sync = createCrmSync({ db, pages, nowMs: () => clock, logger: { warn() {}, info() {} } })
  return { db, pancake, sync, pages, setNow: (value) => { clock = value } }
}

function addConversation(pancake, { id = '123_9001', name = 'Chị Lan', psid = '9001', updatedAt = T0 + MINUTE, assignees = ['u-7'] } = {}) {
  const raw = { id, type: 'INBOX', customers: [{ id: `pc-${psid}`, fb_id: psid, name }], assignee_ids: assignees, updated_at: naive(updatedAt), tags: [] }
  pancake.state.conversations = pancake.state.conversations.filter((row) => row.id !== id).concat(raw)
  return raw
}

function say(pancake, conversationId, id, fromCustomer, at, message, psid = '9001') {
  pancake.state.messages[conversationId] = [...(pancake.state.messages[conversationId] || []), {
    id, from: { id: fromCustomer ? psid : '123', name: fromCustomer ? 'Chị Lan' : 'Aura Q7', admin_id: fromCustomer ? undefined : 'u-7' }, message, inserted_at: naive(at),
  }]
}

const CUSTOMER_ID = customerIdForLink(channelLinkId({ platform: 'facebook', pageId: '123', externalCustomerId: '9001' }))
const KEY = conversationKey('123', '123_9001')

async function firstContact(context) {
  const raw = addConversation(context.pancake)
  say(context.pancake, '123_9001', 'm1', true, T0, 'Gói giảm mỡ 3 tháng bao nhiêu em?')
  say(context.pancake, '123_9001', 'm2', true, T0 + MINUTE, 'Số chị 0901 234 567 nha')
  return context.sync.syncConversation({ page: { ...PAGE, pageId: '123' }, client: context.pancake.client, conversationId: '123_9001', conversation: raw, mode: 'live' })
}

test('a first inbox message creates the customer, the thread and a 5-minute reply step', async () => {
  const context = setup()
  const outcome = await firstContact(context)
  const { db } = context
  assert.equal(outcome.createdCustomer, true)
  const customer = db.data(`crmCustomers/${CUSTOMER_ID}`)
  assert.equal(customer.stage, 'new_inbox')
  assert.equal(customer.branchId, 'q7')
  assert.equal(customer.displayName, 'Chị Lan')
  assert.equal(customer.ownerUid, 'sales-1', 'the Pancake assignee becomes the sales owner')
  assert.deepEqual(customer.phones, [], 'a phone typed in chat is only a suggestion')
  assert.deepEqual(customer.suggestedPhones, ['+84901234567'])
  assert.equal(customer.openStepCount, 1)
  assert.equal(db.data(`crmChannelLinks/facebook__123__9001`).customerId, CUSTOMER_ID)
  const conversation = db.data(`crmConversations/${KEY}`)
  assert.equal(conversation.awaitingReply, true)
  assert.equal(conversation.awaitingSince, T0)
  assert.equal(conversation.messageCount, 2)
  assert.equal(conversation.lastMessageFrom, 'customer')
  assert.equal(conversation.ownerUid, 'sales-1')
  assert.equal(conversation.customerStage, 'new_inbox')
  assert.equal(db.paths('crmMessages/').length, 2)
  const [stepPath] = db.paths('crmCareSteps/')
  const step = db.data(stepPath)
  assert.equal(step.kind, 'inbox_reply')
  assert.equal(step.status, 'open')
  assert.equal(step.ownerUid, 'sales-1')
  assert.equal(step.dueAt, T0 + 5 * MINUTE)
  assert.equal(step.escalateAt, T0 + 15 * MINUTE)
  assert.equal(step.customerName, 'Chị Lan')
})

test('the page reply closes the step and records the first response time', async () => {
  const context = setup()
  await firstContact(context)
  say(context.pancake, '123_9001', 'm3', false, T0 + 3 * MINUTE, 'Dạ chào chị, gói 3 tháng có 2 lựa chọn ạ')
  context.setNow(T0 + 4 * MINUTE)
  await context.sync.syncConversation({ page: { ...PAGE, pageId: '123' }, client: context.pancake.client, conversationId: '123_9001', mode: 'live' })
  const { db } = context
  const step = db.data(db.paths('crmCareSteps/')[0])
  assert.equal(step.status, 'done')
  assert.equal(step.autoClosed, true)
  assert.equal(step.completedAt, T0 + 3 * MINUTE)
  const conversation = db.data(`crmConversations/${KEY}`)
  assert.equal(conversation.awaitingReply, false)
  assert.equal(conversation.messageCount, 3)
  assert.equal(conversation.lastMessageFrom, 'page')
  const customer = db.data(`crmCustomers/${CUSTOMER_ID}`)
  assert.equal(customer.firstResponseSeconds, 180)
  assert.equal(customer.openStepCount, 0)
  assert.equal(db.paths('crmMessages/').length, 3)
  assert.equal(context.pancake.state.calls.filter(([name]) => name === 'list').length, 0, 'a known thread needs no conversation lookup')

  // A rerun of the same state changes nothing.
  await context.sync.syncConversation({ page: { ...PAGE, pageId: '123' }, client: context.pancake.client, conversationId: '123_9001', mode: 'live' })
  assert.equal(db.data(`crmConversations/${KEY}`).messageCount, 3)
  assert.equal(db.paths('crmMessages/').length, 3)
  assert.equal(db.paths('crmCareSteps/').length, 1)
})

test('a student writing to the page opens a 15-minute step for the care owner', async () => {
  const context = setup()
  await firstContact(context)
  say(context.pancake, '123_9001', 'm3', false, T0 + 3 * MINUTE, 'Dạ chị')
  context.setNow(T0 + 4 * MINUTE)
  await context.sync.syncConversation({ page: { ...PAGE, pageId: '123' }, client: context.pancake.client, conversationId: '123_9001', mode: 'live' })
  await context.db.doc(`crmCustomers/${CUSTOMER_ID}`).update({ studentId: 's1', stage: 'won', wonAt: T0 + 10 * MINUTE, careOwnerUid: 'care-1', careOwnerName: 'Hà CSKH', careOwnerKind: 'customer_care' })
  say(context.pancake, '123_9001', 'm4', true, T0 + 60 * MINUTE, 'Mai em xin dời lịch tập nhé')
  context.setNow(T0 + 61 * MINUTE)
  await context.sync.syncConversation({ page: { ...PAGE, pageId: '123' }, client: context.pancake.client, conversationId: '123_9001', mode: 'live' })
  const open = context.db.paths('crmCareSteps/').map((path) => context.db.data(path)).filter((step) => step.status === 'open')
  assert.equal(open.length, 1)
  assert.equal(open[0].kind, 'student_reply')
  assert.equal(open[0].ownerUid, 'care-1')
  assert.equal(open[0].ownerRole, 'care_owner')
  assert.equal(open[0].dueAt, T0 + 75 * MINUTE)
  assert.equal(context.db.data(`crmConversations/${KEY}`).studentId, 's1')
})

test('a webhook event is processed through the API and a dead token pauses the page', async () => {
  const context = setup()
  addConversation(context.pancake)
  say(context.pancake, '123_9001', 'm1', true, T0, 'Chào shop')
  const payloadJson = JSON.stringify({ event_type: 'messaging', page_id: '123', data: { conversation: { id: '123_9001' }, message: { id: 'm1' } } })
  await context.db.doc('crmInboundEvents/pe_1').set({ pageId: '123', payloadJson, status: 'pending', attempts: 0 })
  await context.sync.processInboundEvent('pe_1', context.db.data('crmInboundEvents/pe_1'))
  const event = context.db.data('crmInboundEvents/pe_1')
  assert.equal(event.status, 'processed')
  assert.equal(event.customerId, CUSTOMER_ID)
  assert.ok(context.pancake.state.calls.some(([name]) => name === 'list'), 'an event without customer ids looks the thread up')

  context.pancake.state.failWith = new PancakeApiError('Token Pancake không còn hợp lệ.', { reconnect: true })
  await context.db.doc('crmInboundEvents/pe_2').set({ pageId: '123', payloadJson, status: 'pending', attempts: 0 })
  await context.sync.processInboundEvent('pe_2', context.db.data('crmInboundEvents/pe_2'))
  assert.equal(context.db.data('crmInboundEvents/pe_2').status, 'failed')
  assert.equal(context.db.data('crmPancakePages/123').status, 'needs_reconnect')

  await context.db.doc('crmInboundEvents/pe_3').set({ pageId: '123', payloadJson: JSON.stringify({ event_type: 'messaging' }), status: 'pending' })
  await context.sync.processInboundEvent('pe_3', context.db.data('crmInboundEvents/pe_3'))
  assert.equal(context.db.data('crmInboundEvents/pe_3').reason, 'no_conversation')
})

test('reconciliation syncs only changed threads and notices a silent webhook', async () => {
  const context = setup({}, { now: T0 + 30 * MINUTE })
  await firstContact(context)
  addConversation(context.pancake, { id: '123_9002', psid: '9002', name: 'Anh Phúc', updatedAt: T0 + 20 * MINUTE, assignees: [] })
  say(context.pancake, '123_9002', 'p1', true, T0 + 20 * MINUTE, 'Còn suất tập thử không?', '9002')
  context.pancake.state.calls.length = 0
  const page = { ...context.db.data('crmPancakePages/123'), pageId: '123', lastReconcileAt: T0 + 25 * MINUTE, webhookLastReceivedAt: T0 - 60 * MINUTE }
  const outcome = await context.sync.reconcilePage(page, context.pancake.client)
  assert.equal(outcome.synced, 1, 'the unchanged first thread is skipped')
  assert.equal(outcome.suspected, true)
  const pageAfter = context.db.data('crmPancakePages/123')
  assert.equal(pageAfter.webhookSuspectedDown, true)
  assert.equal(pageAfter.lastReconcileAt, T0 + 30 * MINUTE)
  assert.equal(context.pancake.state.calls.filter(([name, args]) => name === 'messages' && args.conversationId === '123_9001').length, 0)
  const newcomer = context.db.data(`crmConversations/${conversationKey('123', '123_9002')}`)
  assert.equal(newcomer.awaitingReply, true)
})

test('backfill walks 7-day windows back to the start date without opening tasks', async () => {
  const now = T0
  const context = setup({}, { now })
  addConversation(context.pancake, { id: '123_7001', psid: '7001', updatedAt: now - 2 * DAY })
  say(context.pancake, '123_7001', 'b1', true, now - 2 * DAY, 'Hỏi giá', '7001')
  addConversation(context.pancake, { id: '123_7002', psid: '7002', updatedAt: now - 9 * DAY })
  say(context.pancake, '123_7002', 'b2', true, now - 9 * DAY, 'Tư vấn giúp mình', '7002')
  say(context.pancake, '123_7002', 'b3', false, now - 9 * DAY + MINUTE, 'Dạ vâng', '7002')
  const page = { ...PAGE, pageId: '123', backfill: { status: 'running', sinceMs: now - 10 * DAY, cursorUntil: now, conversations: 0 } }
  const outcome = await context.sync.advanceBackfill(page, context.pancake.client)
  assert.equal(outcome.finished, true)
  assert.equal(outcome.conversations, 2)
  assert.equal(context.db.data('crmPancakePages/123').backfill.status, 'done')
  assert.deepEqual(context.db.paths('crmCareSteps/'), [], 'history never creates overdue work')
  const imported = context.db.paths('crmCustomers/').map((path) => context.db.data(path))
  assert.equal(imported.length, 2)
  assert.ok(imported.every((customer) => customer.fromBackfill === true))
  assert.equal(context.db.paths('crmMessages/').length, 3)
})

test('overdue steps notify the owner, then the branch manager, once each', async () => {
  const context = setup({
    'roleAssignments/mgr-1': { accessRole: 'staff', status: 'active', positions: ['branch_manager'], branchIds: ['q7'] },
    'roleAssignments/mgr-2': { accessRole: 'staff', status: 'active', positions: ['branch_manager'], branchIds: ['q1'] },
    'crmCareSteps/due': { customerId: 'c1', title: 'Phản hồi inbox', status: 'open', kind: 'inbox_reply', branchId: 'q7', ownerUid: 'sales-1', ownerName: 'Minh', dueAt: T0, escalateAt: T0 + 10 * MINUTE },
    'crmCareSteps/late': { customerId: 'c2', title: 'Phản hồi inbox', status: 'open', kind: 'inbox_reply', branchId: 'q7', ownerUid: '', ownerName: '', dueAt: T0 - 20 * MINUTE, escalateAt: T0 - 10 * MINUTE },
    'crmCareSteps/future': { customerId: 'c3', title: 'Gọi lại', status: 'open', kind: 'manual', branchId: 'q7', ownerUid: 'sales-1', dueAt: T0 + DAY, escalateAt: T0 + 2 * DAY },
  }, { now: T0 + MINUTE })
  const first = await context.sync.escalateSteps()
  assert.equal(first.scanned, 2)
  assert.ok(context.db.data('users/sales-1/notifications/crm-due-due'))
  assert.ok(context.db.data('users/mgr-1/notifications/crm-due-late'), 'an unowned step goes straight to the manager')
  assert.ok(context.db.data('users/mgr-1/notifications/crm-esc-late'))
  assert.equal(context.db.data('users/mgr-2/notifications/crm-esc-late'), undefined, 'other branches are not told')
  assert.equal(context.db.data('crmCareSteps/due').escalatedAt, undefined)
  const second = await context.sync.escalateSteps()
  assert.equal(second.ownerNotices + second.escalations, 0)
  assert.equal(context.db.data('users/sales-1/notifications/crm-due-due').actionUrl, '#/staff-crm?focus=c1')
})

test('a new contract wins the customer, names the main PT as care owner and mirrors the tag', async () => {
  const context = setup({
    'students/s1': { name: 'Nguyễn Thị Lan', phone: '0901 234 567', branchId: 'q7' },
    'roleAssignments/uid-pt': { accessRole: 'staff', status: 'active', positions: ['trainer_pt'], branchIds: ['q7'], crmProfileId: 'trainer-9' },
    'trainers/trainer-9': { name: 'PT Minh' },
  })
  await firstContact(context)
  await context.db.doc(`crmCustomers/${CUSTOMER_ID}`).update({ phones: ['+84901234567'], stage: 'quote_sent' })
  const signedAt = T0 + 30 * MINUTE
  context.setNow(T0 + 31 * MINUTE)
  const outcome = await context.sync.syncContract('contract-1', null, { studentId: 's1', trainerId: 'trainer-9', packageName: 'PT 1:1 · 3 tháng', branchId: 'q7', createdAt: { _seconds: signedAt / 1000 } })
  assert.equal(outcome.stageChanged, true)
  const customer = context.db.data(`crmCustomers/${CUSTOMER_ID}`)
  assert.equal(customer.stage, 'won')
  assert.equal(customer.studentId, 's1')
  assert.equal(customer.wonAt, signedAt)
  assert.equal(customer.careOwnerKind, 'trainer')
  assert.equal(customer.careOwnerUid, 'uid-pt')
  assert.equal(customer.careOwnerStaffId, 'trainer-9')
  assert.equal(customer.careOwnerName, 'PT Minh')
  const handover = context.db.data('crmCareSteps/handover__contract-1')
  assert.equal(handover.ownerUid, 'uid-pt')
  assert.deepEqual(handover.ownerKeys, ['uid-pt', 'trainer-9'])
  assert.equal(context.db.data(`crmConversations/${KEY}`).customerStage, 'won')
  const tags = context.pancake.state.calls.filter(([name]) => name === 'tag').map(([, args]) => [args.action, args.tagId])
  assert.deepEqual(tags, [['remove', '11'], ['add', '12']])

  // A CSKH assigned later takes over on the renewal, without a second handover.
  await context.db.doc('crmCareAssignments/s1').set({ studentId: 's1', branchId: 'q7', careOwnerUid: 'care-1', careOwnerName: 'Hà CSKH' })
  await context.sync.syncContract('contract-2', null, { studentId: 's1', trainerId: 'trainer-9', packageName: 'Gia hạn', createdAt: { _seconds: (T0 + DAY) / 1000 } })
  const renewed = context.db.data(`crmCustomers/${CUSTOMER_ID}`)
  assert.equal(renewed.careOwnerKind, 'customer_care')
  assert.equal(renewed.careOwnerUid, 'care-1')
  assert.equal(renewed.wonAt, signedAt, 'the first signing date stays')
  assert.deepEqual(renewed.contractIds, ['contract-1', 'contract-2'])
  assert.equal(context.db.data('crmCareSteps/handover__contract-2'), undefined)
  assert.equal(context.db.data('crmCareSteps/handover__contract-1').ownerUid, 'care-1', 'open care steps follow the new owner')

  // A trainer change does not override an assigned CSKH; unrelated writes are ignored.
  await context.sync.syncContract('contract-2', { studentId: 's1', trainerId: 'trainer-9' }, { studentId: 's1', trainerId: 'trainer-10' })
  assert.equal(context.db.data(`crmCustomers/${CUSTOMER_ID}`).careOwnerUid, 'care-1')
  assert.deepEqual(await context.sync.syncContract('contract-2', { studentId: 's1', trainerId: 'trainer-10', paidAmount: 1 }, { studentId: 's1', trainerId: 'trainer-10', paidAmount: 2 }), { skipped: 'unchanged' })
})

test('a contract for a student nobody spoke to in the inbox is ignored', async () => {
  const context = setup({ 'students/s9': { name: 'Học viên cũ', phone: '0912 000 111' } })
  assert.deepEqual(await context.sync.syncContract('contract-9', null, { studentId: 's9' }), { skipped: 'no_crm_customer' })
})
