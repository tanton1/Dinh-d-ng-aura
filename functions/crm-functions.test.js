'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const identityContract = require('./identity-contract.json')
const { createCrmFunctions } = require('./crm-functions')
const { createCrmSync } = require('./crm-sync')
const { decryptToken, webhookSecretMatches } = require('./crm-core')
const { createMemoryFirestore } = require('./test-support/crm-memory-firestore')

const NOW = Date.UTC(2026, 10, 8, 6, 0)
const HOUR = 3_600_000
const KEY = 'k'.repeat(32)

function capabilities(accessRole, positions = []) {
  const result = new Set()
  if (accessRole === 'staff') identityContract.staffCapabilities.forEach((item) => result.add(item))
  positions.forEach((position) => (identityContract.positionCapabilities[position] || []).forEach((item) => result.add(item)))
  if (['admin', 'super_admin'].includes(accessRole)) identityContract.adminCapabilities.forEach((item) => result.add(item))
  return [...result]
}

function actor(uid, accessRole, positions = [], branchIds = [], extra = {}) {
  return { uid, accessRole, positions, branchIds, capabilities: capabilities(accessRole, positions), actorName: extra.actorName || uid, legacyStaffId: extra.legacyStaffId || uid }
}

const SALES = actor('sales-1', 'staff', ['sales'], ['q7'], { actorName: 'Minh Sales' })
const SALES_Q1 = actor('sales-9', 'staff', ['sales'], ['q1'])
const MANAGER = actor('mgr-1', 'staff', ['branch_manager'], ['q7'], { actorName: 'Quản lý Q7' })
const CARE = actor('care-1', 'staff', ['customer_care'], ['q7'], { actorName: 'Hà CSKH' })
const TRAINER = actor('uid-pt', 'staff', ['trainer_pt'], ['q7'], { legacyStaffId: 'trainer-9' })
const COACH = actor('coach-1', 'staff', ['coach_online'], ['q7'])
const ADMIN = actor('admin-1', 'admin', [], [])

function seed() {
  return {
    'branches/q7': { name: 'Aura Q7' },
    'branches/q1': { name: 'Aura Q1' },
    'users/sales-1': { displayName: 'Minh Sales' },
    'users/sales-2': { displayName: 'Lan Sales' },
    'users/care-1': { displayName: 'Hà CSKH' },
    'users/mgr-1': { displayName: 'Quản lý Q7' },
    'roleAssignments/sales-1': { accessRole: 'staff', status: 'active', positions: ['sales'], branchIds: ['q7'] },
    'roleAssignments/sales-2': { accessRole: 'staff', status: 'active', positions: ['sales'], branchIds: ['q7'] },
    'roleAssignments/care-1': { accessRole: 'staff', status: 'active', positions: ['customer_care'], branchIds: ['q7'] },
    'roleAssignments/mgr-1': { accessRole: 'staff', status: 'active', positions: ['branch_manager'], branchIds: ['q7'] },
    'roleAssignments/uid-pt': { accessRole: 'staff', status: 'active', positions: ['trainer_pt'], branchIds: ['q7'], crmProfileId: 'trainer-9' },
    'trainers/trainer-9': { name: 'PT Minh' },
    'crmPancakePages/123': { name: 'Aura Q7', platform: 'facebook', branchId: 'q7', enabled: true, tagMap: { consulting: '21', lost: '29' }, staffMap: { 'u-7': { uid: 'sales-1', name: 'Minh Sales' } }, pancakeTags: [{ id: '21', text: 'AURA: Tư vấn' }, { id: '29', text: 'AURA: Mất' }], pancakeUsers: [{ id: 'u-7', name: 'Minh' }, { id: 'u-8', name: 'Lan' }], revision: 3 },
    'crmCustomers/lan': {
      status: 'active', displayName: 'Chị Lan', phones: ['+84901234567'], suggestedPhones: [], branchId: 'q7', stage: 'qualified', ownerUid: 'sales-1', ownerName: 'Minh Sales',
      source: { platform: 'facebook', pageId: '123' }, studentId: '', wonAt: 0, quoteIds: [], contractIds: [], openStepCount: 1, searchTokens: ['ch', 'chi', 'la', 'lan', '0901234567', '#4567'], revision: 4, updatedAt: NOW - HOUR,
    },
    'crmCustomers/phuc': { status: 'active', displayName: 'Anh Phúc', phones: [], branchId: 'q1', stage: 'new_inbox', ownerUid: '', openStepCount: 0, searchTokens: ['an', 'anh', 'ph', 'phu', 'phuc'], revision: 1, updatedAt: NOW - 2 * HOUR },
    'crmConversations/123__123_9001': { pageId: '123', conversationId: '123_9001', customerId: 'lan', branchId: 'q7', displayName: 'Chị Lan', customerStage: 'qualified', ownerUid: 'sales-1', awaitingReply: true, awaitingSince: NOW - 10 * 60_000, lastMessageAt: NOW - 10 * 60_000, preview: 'Giá gói?', platform: 'facebook' },
    'crmConversations/123__123_9002': { pageId: '123', conversationId: '123_9002', customerId: 'other', branchId: 'q7', displayName: 'Khách khác', customerStage: 'new_inbox', ownerUid: '', awaitingReply: false, awaitingSince: null, lastMessageAt: NOW - 20 * 60_000, preview: 'Cảm ơn', platform: 'facebook' },
    'crmConversations/456__456_1': { pageId: '456', conversationId: '456_1', customerId: 'phuc', branchId: 'q1', displayName: 'Anh Phúc', customerStage: 'new_inbox', ownerUid: '', awaitingReply: true, awaitingSince: NOW - 5 * 60_000, lastMessageAt: NOW - 5 * 60_000, preview: 'Q1', platform: 'facebook' },
    'crmMessages/m_before': { conversationKey: '123__123_9001', direction: 'in', senderKind: 'customer', text: 'Giá gói 3 tháng?', sentAt: NOW - 3 * HOUR, attachments: [] },
    'crmMessages/m_after': { conversationKey: '123__123_9001', direction: 'in', senderKind: 'customer', text: 'Mai em đổi lịch', sentAt: NOW - 10 * 60_000, attachments: [] },
    'crmCareSteps/reply-1': { customerId: 'lan', customerName: 'Chị Lan', kind: 'inbox_reply', title: 'Phản hồi inbox', status: 'open', ownerRole: 'sales', ownerUid: 'sales-1', ownerKeys: ['sales-1'], branchId: 'q7', dueAt: NOW - 5 * 60_000 },
    'students/s1': { name: 'Nguyễn Thị Lan', phone: '0901 234 567', branchId: 'q7' },
    'students/s2': { name: 'Trần Văn Nam', phone: '0912 345 678', branchId: 'q7' },
    'contracts/c1': { studentId: 's1', trainerId: 'trainer-9', startDate: '2026-11-01', packageName: 'PT 1:1' },
    'quotes/quote-1': { code: 'AQ-20261108-ABC', customerName: 'Chị Lan', customerPhone: '0901234567', branchId: 'q7', packageName: 'PT 1:1 · 3 tháng', finalPrice: 9_000_000, status: 'pending' },
  }
}

function fakeClient() {
  const calls = []
  return {
    calls,
    client: {
      async setTag(args) { calls.push(['tag', args]) },
      async assign(args) { calls.push(['assign', args]) },
      async listTags() { calls.push(['tags']); return [{ id: '21', text: 'AURA: Tư vấn', color: '' }] },
      async listUsers() { calls.push(['users']); return [{ id: 'u-7', name: 'Minh', email: '' }] },
      async listConversations() { return [] },
      async getMessages() { return { messages: [], customers: [] } },
    },
  }
}

function setup(caller, extraSeed = {}) {
  const db = createMemoryFirestore({ ...seed(), ...extraSeed })
  const pancake = fakeClient()
  const pages = {
    page: async (pageId) => (db.data(`crmPancakePages/${pageId}`) ? { ...db.data(`crmPancakePages/${pageId}`), pageId } : null),
    client: async () => pancake.client,
    forget() {},
  }
  const sync = createCrmSync({ db, pages, nowMs: () => NOW, logger: { warn() {} } })
  let current = caller
  const functions = createCrmFunctions({
    db,
    onCall: (...args) => args.at(-1),
    sync,
    pages,
    tokenKey: () => KEY,
    webhookBaseUrl: 'https://asia-east1-demo.cloudfunctions.net/pancakeWebhook',
    accessContextResolver: async () => current,
    clientFactory: () => pancake.client,
    nowMs: () => NOW,
  })
  const query = (data) => functions.crmQuery({ data })
  const command = (data) => functions.crmCommand({ data })
  const integration = (data) => functions.crmIntegrationCommand({ data })
  return { db, pancake, query, command, integration, as: (next) => { current = next } }
}

const rejectsWith = (promise, code) => assert.rejects(promise, (error) => error.code === code)

test('roles without CRM capabilities are refused and Sales stays inside its branch', async () => {
  const context = setup(COACH)
  await rejectsWith(context.query({ action: 'inbox' }), 'permission-denied')
  context.as(SALES_Q1)
  await rejectsWith(context.query({ action: 'customer', customerId: 'lan' }), 'permission-denied')
  await rejectsWith(context.query({ action: 'inbox', branchId: 'q7' }), 'permission-denied')
  context.as(SALES)
  await rejectsWith(context.query({ action: 'nope' }), 'invalid-argument')
  await rejectsWith(context.integration({ action: 'connectPage' }), 'permission-denied')
})

test('the inbox lists awaiting threads oldest first and pages with a cursor', async () => {
  const context = setup(SALES)
  const awaiting = await context.query({ action: 'inbox' })
  assert.deepEqual(awaiting.rows.map((row) => row.key), ['123__123_9001'], 'only the own branch')
  assert.match(awaiting.rows[0].pancakeUrl, /pancake\.vn\/123\?c_id=123_9001/)
  const all = await context.query({ action: 'inbox', filter: 'all', pageSize: 5 })
  assert.deepEqual(all.rows.map((row) => row.key), ['123__123_9001', '123__123_9002'])
  const mine = await context.query({ action: 'inbox', filter: 'mine' })
  assert.deepEqual(mine.rows.map((row) => row.customerId), ['lan'])
  context.as(ADMIN)
  const everywhere = await context.query({ action: 'inbox', filter: 'awaiting' })
  assert.deepEqual(everywhere.rows.map((row) => row.key), ['123__123_9001', '456__456_1'])
  const firstPage = await context.query({ action: 'inbox', filter: 'all', pageSize: 5 })
  assert.equal(firstPage.hasMore, false)
  context.as(CARE)
  await rejectsWith(context.query({ action: 'inbox' }), 'permission-denied')
})

test('inbox cursors continue exactly where the previous page stopped', async () => {
  const extra = {}
  for (let index = 0; index < 7; index += 1) {
    extra[`crmConversations/777__777_${index}`] = { pageId: '777', conversationId: `777_${index}`, customerId: `c${index}`, branchId: 'q7', customerStage: 'new_inbox', awaitingReply: true, awaitingSince: NOW - (20 - index) * 60_000, lastMessageAt: NOW - index * 60_000 }
  }
  const context = setup(SALES, extra)
  const first = await context.query({ action: 'inbox', filter: 'awaiting', pageSize: 5 })
  assert.equal(first.rows.length, 5)
  assert.equal(first.hasMore, true)
  const second = await context.query({ action: 'inbox', filter: 'awaiting', pageSize: 5, cursor: first.nextCursor })
  const keys = [...first.rows, ...second.rows].map((row) => row.key)
  assert.equal(keys.length, 8)
  assert.equal(new Set(keys).size, 8)
  assert.equal(second.hasMore, false)
  assert.deepEqual(keys.slice(0, 2), ['777__777_0', '777__777_1'], 'the longest wait comes first')
  await rejectsWith(context.query({ action: 'inbox', cursor: 'not-a-cursor' }), 'invalid-argument')
})

test('pipeline columns count every stage of the branch', async () => {
  const context = setup(SALES)
  const result = await context.query({ action: 'pipeline' })
  assert.equal(result.columns.length, 9)
  const qualified = result.columns.find((column) => column.stage === 'qualified')
  assert.equal(qualified.count, 1)
  assert.equal(qualified.rows[0].displayName, 'Chị Lan')
  assert.equal(result.columns.find((column) => column.stage === 'new_inbox').count, 0, 'the Q1 lead is not counted')
})

test('customer search matches accent-free name prefixes and phone endings', async () => {
  const context = setup(SALES)
  assert.deepEqual((await context.query({ action: 'customers', query: 'lan' })).rows.map((row) => row.id), ['lan'])
  assert.deepEqual((await context.query({ action: 'customers', query: '4567' })).rows.map((row) => row.id), ['lan'])
  assert.deepEqual((await context.query({ action: 'customers', query: 'phuc' })).rows, [], 'another branch')
  assert.deepEqual((await context.query({ action: 'customers' })).rows.map((row) => row.id), ['lan'])
})

test('changing the stage checks the revision, needs a lost reason and mirrors the Pancake tag', async () => {
  const context = setup(SALES)
  await rejectsWith(context.command({ action: 'updateStage', customerId: 'lan', expectedRevision: 3, stage: 'consulting' }), 'aborted')
  await rejectsWith(context.command({ action: 'updateStage', customerId: 'lan', expectedRevision: 4, stage: 'lost' }), 'failed-precondition')
  await rejectsWith(context.command({ action: 'updateStage', customerId: 'lan', expectedRevision: 4, stage: 'won' }), 'failed-precondition')
  const moved = await context.command({ action: 'updateStage', customerId: 'lan', expectedRevision: 4, stage: 'consulting' })
  assert.equal(moved.revision, 5)
  assert.equal(context.db.data('crmCustomers/lan').stage, 'consulting')
  assert.equal(context.db.data('crmConversations/123__123_9001').customerStage, 'consulting')
  assert.deepEqual(context.pancake.calls, [['tag', { conversationId: '123_9001', tagId: '21', action: 'add' }]])
  const lost = await context.command({ action: 'updateStage', customerId: 'lan', expectedRevision: 5, stage: 'lost', lostReason: 'price', note: 'Thấy đắt' })
  assert.equal(lost.revision, 6)
  const customer = context.db.data('crmCustomers/lan')
  assert.equal(customer.lostReason, 'price')
  assert.equal(customer.lostNote, 'Thấy đắt')
  assert.deepEqual(context.pancake.calls.slice(1).map(([, args]) => [args.action, args.tagId]), [['remove', '21'], ['add', '29']])
  const activities = context.db.paths('crmActivities/').map((path) => context.db.data(path))
  assert.deepEqual(activities.map((row) => row.data.toStage).sort(), ['consulting', 'lost'])
})

test('saving a phone normalises it, drops it from suggestions and proposes a merge on a duplicate', async () => {
  const context = setup(SALES, {
    'crmCustomers/lan-zalo': { status: 'active', displayName: 'Lan Zalo', phones: ['+84912345678'], branchId: 'q7', stage: 'new_inbox', revision: 1 },
  })
  await context.db.doc('crmCustomers/lan').update({ suggestedPhones: ['+84912345678'] })
  const result = await context.command({ action: 'updateProfile', customerId: 'lan', expectedRevision: 4, phones: ['0901 234 567', '+84 912 345 678'], goal: 'Giảm 5kg' })
  const customer = context.db.data('crmCustomers/lan')
  assert.deepEqual(customer.phones, ['+84901234567', '+84912345678'])
  assert.deepEqual(customer.suggestedPhones, [])
  assert.ok(customer.searchTokens.includes('0912345678'))
  assert.deepEqual(result.duplicates.map((row) => row.id), ['lan-zalo'])
  await rejectsWith(context.command({ action: 'updateProfile', customerId: 'lan', expectedRevision: 5, phones: ['12345'] }), 'invalid-argument')
})

test('the sales owner must be active Sales of the branch and is mirrored to Pancake', async () => {
  const context = setup(SALES)
  await rejectsWith(context.command({ action: 'assignOwner', customerId: 'lan', expectedRevision: 4, ownerUid: 'care-1' }), 'failed-precondition')
  await context.db.doc('crmPancakePages/123').update({ staffMap: { 'u-8': { uid: 'sales-2', name: 'Lan Sales' } } })
  const result = await context.command({ action: 'assignOwner', customerId: 'lan', expectedRevision: 4, ownerUid: 'sales-2' })
  assert.equal(result.revision, 5)
  assert.equal(context.db.data('crmCustomers/lan').ownerName, 'Lan Sales')
  assert.equal(context.db.data('crmConversations/123__123_9001').ownerUid, 'sales-2')
  assert.equal(context.db.data('crmCareSteps/reply-1').ownerUid, 'sales-2', 'open sales steps follow the owner')
  assert.deepEqual(context.pancake.calls.at(-1), ['assign', { conversationId: '123_9001', assigneeIds: ['u-8'] }])
})

test('care owners read only messages from the signing date and never the sales history', async () => {
  const context = setup(CARE)
  await rejectsWith(context.query({ action: 'customer', customerId: 'lan' }), 'permission-denied')
  await context.db.doc('crmCustomers/lan').update({ studentId: 's1', stage: 'won', wonAt: NOW - HOUR, careOwnerUid: 'care-1', careOwnerKind: 'customer_care', quoteIds: ['quote-1'] })
  const detail = await context.query({ action: 'customer', customerId: 'lan' })
  assert.equal(detail.access.care, true)
  assert.equal(detail.access.presale, false)
  assert.deepEqual(detail.customer.quoteIds, [])
  assert.deepEqual(detail.quotes, [])
  assert.deepEqual(detail.openSteps, [], 'inbox reply steps belong to Sales')
  const messages = await context.query({ action: 'messages', customerId: 'lan' })
  assert.deepEqual(messages.rows.map((row) => row.text), ['Mai em đổi lịch'])
  assert.ok(messages.hiddenBefore)
  await rejectsWith(context.command({ action: 'updateStage', customerId: 'lan', expectedRevision: 5, stage: 'won' }), 'permission-denied')
  assert.equal((await context.command({ action: 'recordActivity', customerId: 'lan', type: 'call', outcome: 'connected', note: 'Hỏi thăm buổi đầu' })).recorded, true)
  context.as(SALES)
  const sales = await context.query({ action: 'messages', customerId: 'lan' })
  assert.deepEqual(sales.rows.map((row) => row.text), ['Mai em đổi lịch', 'Giá gói 3 tháng?'])
  context.as(TRAINER)
  await context.db.doc('crmCustomers/lan').update({ careOwnerUid: '', careOwnerStaffId: 'trainer-9', careOwnerKind: 'trainer' })
  assert.equal((await context.query({ action: 'customers', scope: 'care' })).rows[0].id, 'lan', 'the main PT finds the student through the legacy staff id')
})

test('steps can be completed by their owner or a manager, not by someone else', async () => {
  const context = setup(CARE)
  await rejectsWith(context.command({ action: 'completeStep', stepId: 'reply-1' }), 'permission-denied')
  context.as(MANAGER)
  const done = await context.command({ action: 'completeStep', stepId: 'reply-1', status: 'done', note: 'Đã gọi' })
  assert.equal(done.status, 'done')
  assert.equal(context.db.data('crmCareSteps/reply-1').completedByName, 'Quản lý Q7')
  assert.equal(context.db.data('crmCustomers/lan').openStepCount, 0)
  assert.equal((await context.command({ action: 'completeStep', stepId: 'reply-1' })).unchanged, true)
  context.as(SALES)
  const mine = await context.query({ action: 'steps', scope: 'mine', status: 'done' })
  assert.deepEqual(mine.rows.map((row) => row.id), ['reply-1'])
})

test('a trial appointment books the stage, reminds the owner and follows the visit', async () => {
  const context = setup(SALES)
  const booked = await context.command({ action: 'createAppointment', customerId: 'lan', kind: 'trial', startAt: new Date(NOW + 2 * 24 * HOUR).toISOString(), note: 'PT Minh đón' })
  assert.equal(booked.stage, 'trial_booked')
  const reminder = context.db.paths('crmCareSteps/').map((path) => context.db.data(path)).find((step) => step.appointmentId === booked.appointmentId)
  assert.equal(reminder.ownerUid, 'sales-1')
  assert.equal(reminder.dueAt, NOW + 24 * HOUR)
  const attended = await context.command({ action: 'updateAppointment', appointmentId: booked.appointmentId, status: 'attended' })
  assert.equal(attended.stage, 'trial_done')
  const second = await context.command({ action: 'createAppointment', customerId: 'lan', kind: 'consult', startAt: NOW + HOUR })
  const noShow = await context.command({ action: 'updateAppointment', appointmentId: second.appointmentId, status: 'no_show' })
  assert.equal(noShow.stage, 'trial_done')
  assert.ok(context.db.paths('crmCareSteps/').map((path) => context.db.data(path)).some((step) => step.title === 'Gọi lại khách không đến hẹn' && step.dueAt === NOW + 2 * HOUR))
  await rejectsWith(context.command({ action: 'createAppointment', customerId: 'lan', startAt: NOW + 200 * 24 * HOUR }), 'invalid-argument')
})

test('linking a student with a contract wins the customer and names the main PT', async () => {
  const context = setup(SALES)
  const targets = await context.query({ action: 'linkTargets', query: '0901234567' })
  assert.deepEqual(targets.rows.map((row) => row.studentId), ['s1'])
  const result = await context.command({ action: 'linkStudent', customerId: 'lan', expectedRevision: 4, studentId: 's1' })
  assert.equal(result.stage, 'won')
  const customer = context.db.data('crmCustomers/lan')
  assert.equal(customer.studentId, 's1')
  assert.equal(customer.careOwnerUid, 'uid-pt')
  assert.equal(customer.wonAt, Date.parse('2026-11-01T00:00:00+07:00'))
  assert.deepEqual(customer.contractIds, ['c1'])
  const nameTargets = await context.query({ action: 'linkTargets', query: 'Nguyễn' })
  assert.equal(nameTargets.rows[0].linkedCustomerId, 'lan')
  await context.db.doc('crmCustomers/dup').set({ status: 'active', displayName: 'Lan 2', phones: [], branchId: 'q7', stage: 'new_inbox', revision: 1 })
  await assert.rejects(context.command({ action: 'linkStudent', customerId: 'dup', expectedRevision: 1, studentId: 's1' }), (error) => error.code === 'already-exists')
})

test('an existing quote found by phone is attached and moves the stage', async () => {
  const context = setup(SALES)
  const candidates = await context.query({ action: 'quoteCandidates', customerId: 'lan' })
  assert.deepEqual(candidates.rows.map((row) => row.code), ['AQ-20261108-ABC'])
  const linked = await context.command({ action: 'linkQuote', customerId: 'lan', quoteId: 'quote-1' })
  assert.equal(linked.unchanged, false)
  assert.equal(context.db.data('crmCustomers/lan').stage, 'quote_sent')
  assert.equal((await context.command({ action: 'linkQuote', customerId: 'lan', quoteId: 'quote-1' })).unchanged, true)
})

test('merging moves threads, links and steps, then retires the source', async () => {
  const context = setup(SALES, {
    'crmCustomers/lan-zalo': { status: 'active', displayName: 'Lan Zalo', phones: ['+84912345678'], branchId: 'q7', stage: 'new_inbox', openStepCount: 0, revision: 2 },
    'crmConversations/pzl_1__pzl_1_5': { pageId: 'pzl_1', conversationId: 'pzl_1_5', customerId: 'lan-zalo', branchId: 'q7', lastMessageAt: NOW },
    'crmChannelLinks/zalo__pzl_1__5': { customerId: 'lan-zalo' },
  })
  const result = await context.command({ action: 'merge', sourceCustomerId: 'lan-zalo', targetCustomerId: 'lan' })
  assert.equal(result.moved.conversations, 1)
  assert.equal(result.moved.channelLinks, 1)
  assert.equal(context.db.data('crmChannelLinks/zalo__pzl_1__5').customerId, 'lan')
  assert.equal(context.db.data('crmConversations/pzl_1__pzl_1_5').customerId, 'lan')
  assert.equal(context.db.data('crmConversations/pzl_1__pzl_1_5').displayName, 'Chị Lan')
  assert.deepEqual(context.db.data('crmCustomers/lan').phones, ['+84901234567', '+84912345678'])
  assert.equal(context.db.data('crmCustomers/lan-zalo').status, 'merged')
  const merged = await context.query({ action: 'customer', customerId: 'lan-zalo' })
  assert.equal(merged.mergedInto, 'lan')
  await rejectsWith(context.command({ action: 'updateStage', customerId: 'lan-zalo', expectedRevision: 3, stage: 'consulting' }), 'failed-precondition')
})

test('managers assign students to CSKH and clearing it hands care back to the main PT', async () => {
  const context = setup(MANAGER, {
    'crmCustomers/lan': { ...seed()['crmCustomers/lan'], studentId: 's1', stage: 'won', wonAt: NOW - HOUR, careOwnerUid: 'uid-pt', careOwnerStaffId: 'trainer-9', careOwnerKind: 'trainer' },
    'crmCareSteps/handover__c1': { customerId: 'lan', kind: 'handover', title: 'Nhận bàn giao', status: 'open', ownerRole: 'care_owner', ownerUid: 'uid-pt', ownerKeys: ['uid-pt', 'trainer-9'], branchId: 'q7', dueAt: NOW + HOUR },
  })
  const list = await context.query({ action: 'careAssignments', branchId: 'q7' })
  assert.deepEqual(list.rows.map((row) => row.studentId), ['s1', 's2'])
  assert.deepEqual(list.careStaff, [{ uid: 'care-1', name: 'Hà CSKH' }])
  await rejectsWith(context.command({ action: 'assignCareOwner', studentIds: ['s1'], careOwnerUid: 'sales-1' }).then((result) => { if (!result.results[0].ok) throw Object.assign(new Error(result.results[0].reason), { code: 'failed-precondition' }) }), 'failed-precondition')
  const assigned = await context.command({ action: 'assignCareOwner', studentIds: ['s1', 's2'], careOwnerUid: 'care-1' })
  assert.equal(assigned.assigned, 2)
  assert.equal(context.db.data('crmCareAssignments/s1').careOwnerUid, 'care-1')
  assert.equal(context.db.data('crmCustomers/lan').careOwnerKind, 'customer_care')
  assert.equal(context.db.data('crmCareSteps/handover__c1').ownerUid, 'care-1')
  await context.command({ action: 'assignCareOwner', studentIds: ['s1'], careOwnerUid: '' })
  assert.equal(context.db.data('crmCareAssignments/s1'), undefined)
  assert.equal(context.db.data('crmCustomers/lan').careOwnerUid, 'uid-pt')
  assert.equal(context.db.data('crmCareSteps/handover__c1').ownerUid, 'uid-pt')
  context.as(SALES)
  await rejectsWith(context.command({ action: 'assignCareOwner', studentIds: ['s1'], careOwnerUid: 'care-1' }), 'permission-denied')
})

test('erasing a customer removes every record and keeps an anonymous audit', async () => {
  const context = setup(SALES)
  await rejectsWith(context.command({ action: 'erase', customerId: 'lan', confirmation: 'XOA' }), 'permission-denied')
  context.as(ADMIN)
  await rejectsWith(context.command({ action: 'erase', customerId: 'lan', confirmation: 'yes' }), 'invalid-argument')
  const result = await context.command({ action: 'erase', customerId: 'lan', confirmation: 'XOA' })
  assert.deepEqual(result.counts, { messages: 2, conversations: 1, channelLinks: 0, steps: 1, activities: 0, appointments: 0 })
  assert.equal(context.db.data('crmCustomers/lan'), undefined)
  assert.equal(context.db.paths('crmMessages/').length, 0)
  const [auditPath] = context.db.paths('crmErasures/')
  const audit = JSON.stringify(context.db.data(auditPath))
  assert.equal(/Lan|0901|lan"/.test(audit), false, 'the audit names no one')
})

test('connecting a page validates the token, encrypts it and shows the webhook secret once', async () => {
  const context = setup(ADMIN)
  await rejectsWith(context.integration({ action: 'connectPage', pageId: '789', pageAccessToken: 'short', branchId: 'q7' }), 'invalid-argument')
  const connected = await context.integration({ action: 'connectPage', pageId: '789', pageAccessToken: 'a-valid-page-token-0123456789', branchId: 'q7', name: 'Aura Thủ Đức' })
  assert.deepEqual(context.pancake.calls.map(([name]) => name).sort(), ['tags', 'users'])
  const url = new URL(connected.webhookUrl)
  const secret = url.pathname.split('/').at(-1)
  assert.equal(url.pathname, `/pancakeWebhook/789/${secret}`)
  const stored = context.db.data('crmPancakePageSecrets/789')
  assert.equal(JSON.stringify(stored).includes('a-valid-page-token-0123456789'), false)
  assert.equal(decryptToken(stored.token, KEY), 'a-valid-page-token-0123456789')
  assert.equal(webhookSecretMatches(secret, stored.webhookSecretHash), true)
  assert.equal(JSON.stringify(context.db.data('crmPancakePages/789')).includes(secret), false)
  assert.equal(connected.page.platform, 'facebook')
  const listed = await context.query({ action: 'integration' })
  assert.equal(listed.pages.find((page) => page.pageId === '789').webhookSecretHint, secret.slice(-4))
  assert.equal(JSON.stringify(listed).includes(secret), false)

  const rotated = await context.integration({ action: 'rotateWebhookSecret', pageId: '789' })
  assert.notEqual(rotated.webhookUrl, connected.webhookUrl)
  assert.equal(webhookSecretMatches(secret, context.db.data('crmPancakePageSecrets/789').webhookSecretHash), false)
})

test('page settings accept only known tags, branch staff and a bounded backfill', async () => {
  const context = setup(ADMIN)
  await rejectsWith(context.integration({ action: 'updatePage', pageId: '123', expectedRevision: 2, enabled: false }), 'aborted')
  await rejectsWith(context.integration({ action: 'updatePage', pageId: '123', expectedRevision: 3, tagMap: { consulting: '999' } }), 'invalid-argument')
  await rejectsWith(context.integration({ action: 'updatePage', pageId: '123', expectedRevision: 3, tagMap: { wrong_stage: '21' } }), 'invalid-argument')
  const updated = await context.integration({ action: 'updatePage', pageId: '123', expectedRevision: 3, tagMap: { consulting: '21', won: '' }, staffMap: { 'u-8': 'sales-2' } })
  assert.deepEqual(updated.page.tagMap, { consulting: '21' })
  assert.deepEqual(updated.page.staffMap, { 'u-8': { uid: 'sales-2', name: 'Lan Sales' } })
  await rejectsWith(context.integration({ action: 'startBackfill', pageId: '123', days: 120 }), 'invalid-argument')
  const started = await context.integration({ action: 'startBackfill', pageId: '123', days: 90 })
  assert.equal(started.page.backfill.status, 'running')
  assert.equal(context.db.data('crmPancakePages/123').backfill.sinceMs, NOW - 90 * 86_400_000)
  await rejectsWith(context.integration({ action: 'startBackfill', pageId: '123', days: 30 }), 'failed-precondition')
  const disconnected = await context.integration({ action: 'disconnectPage', pageId: '123' })
  assert.equal(disconnected.page.enabled, false)
})
