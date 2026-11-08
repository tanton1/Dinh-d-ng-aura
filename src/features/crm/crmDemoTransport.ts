// In-memory CRM for demo mode and the UI harness. It follows the callable
// contract closely enough to exercise every screen; it is not a second
// implementation of the business rules.

import { CRM_STAGES, STAGE_LABELS } from './crmFormat'
import type {
  CrmActivity,
  CrmAppointment,
  CrmConversation,
  CrmCustomer,
  CrmCustomerCard,
  CrmEndpoint,
  CrmMessage,
  CrmPancakePage,
  CrmStage,
  CrmStep,
  CrmTransport,
} from './crmTypes'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

type DemoCustomer = CrmCustomer & { conversationKeys: string[] }

function iso(ms: number) {
  return new Date(ms).toISOString()
}

function phone(local: string) {
  return { value: `+84${local.slice(1)}`, display: `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}` }
}

function createState(now: number) {
  const customers = new Map<string, DemoCustomer>()
  const conversations = new Map<string, CrmConversation>()
  const messages = new Map<string, CrmMessage[]>()
  const steps = new Map<string, CrmStep>()
  const activities: Array<CrmActivity & { customerId: string }> = []
  const appointments: Array<CrmAppointment & { customerId: string }> = []
  let sequence = 0
  const nextId = (prefix: string) => `${prefix}-${++sequence}`

  function customer(id: string, input: Partial<DemoCustomer> & { displayName: string; stage: CrmStage }) {
    const base: DemoCustomer = {
      id, phones: [], suggestedPhones: [], emails: [], branchId: 'q7',
      stageLabel: STAGE_LABELS[input.stage], stageChangedAt: iso(now - DAY), ownerUid: 'demo-sales', ownerName: 'Minh Sales',
      careOwnerUid: '', careOwnerName: '', careOwnerKind: '', platform: 'facebook', pageName: 'Aura Fitness Q7',
      firstContactAt: iso(now - 3 * DAY), studentId: '', wonAt: null, quoteIds: [], contractIds: [], goal: '', preferredSlots: '',
      note: '', lostReason: '', lostReasonLabel: '', lostNote: '', lastInboundAt: null, lastOutboundAt: null, lastActivityAt: iso(now - HOUR),
      firstResponseSeconds: 160, nextStepAt: null, openStepCount: 0, fromBackfill: false, revision: 3, createdAt: iso(now - 3 * DAY),
      updatedAt: iso(now - HOUR), conversationKeys: [], ...input,
    }
    customers.set(id, base)
    return base
  }

  function thread(customerId: string, key: string, platform: CrmConversation['platform'], rows: Array<[direction: 'in' | 'out', minutesAgo: number, text: string]>) {
    const owner = customers.get(customerId)!
    const items: CrmMessage[] = rows.map(([direction, minutesAgo, body], index) => ({
      id: `${key}-${index}`, direction, senderKind: direction === 'in' ? 'customer' : 'page',
      senderName: direction === 'in' ? owner.displayName : 'Aura Fitness', text: body, attachments: [], sentAt: iso(now - minutesAgo * MINUTE),
    }))
    messages.set(key, items)
    const last = items.at(-1)!
    let awaitingSince: string | null = null
    for (const item of items) awaitingSince = item.direction === 'in' ? awaitingSince || item.sentAt : null
    conversations.set(key, {
      key, pageId: platform === 'zalo' ? 'pzl_aura' : '1029384756', pageName: platform === 'zalo' ? 'Aura Zalo OA' : 'Aura Fitness Q7', platform,
      conversationId: key, customerId, displayName: owner.displayName, pancakeName: owner.displayName, customerStage: owner.stage,
      ownerUid: owner.ownerUid, ownerName: owner.ownerName, studentId: owner.studentId, preview: last.text, lastMessageAt: last.sentAt,
      lastMessageFrom: last.direction === 'in' ? 'customer' : 'page', awaitingReply: Boolean(awaitingSince), awaitingSince,
      unread: Boolean(awaitingSince), messageCount: items.length, phoneHints: 0, pancakeUrl: 'https://pancake.vn',
    })
    owner.conversationKeys.push(key)
    owner.lastInboundAt = [...items].reverse().find((item) => item.direction === 'in')?.sentAt || null
    owner.lastOutboundAt = [...items].reverse().find((item) => item.direction === 'out')?.sentAt || null
  }

  function step(customerId: string, input: Partial<CrmStep> & { title: string; kind: CrmStep['kind']; dueAt: string }) {
    const owner = customers.get(customerId)!
    const value: CrmStep = {
      id: nextId('step'), customerId, customerName: owner.displayName, studentId: owner.studentId, note: '', status: 'open',
      ownerUid: owner.ownerUid, ownerName: owner.ownerName, ownerRole: 'sales', overdue: false, escalatedAt: null, outcome: '',
      completedAt: null, completedByName: '', autoClosed: false, sopCode: '', branchId: 'q7', conversationKey: owner.conversationKeys[0] || '', ...input,
    }
    steps.set(value.id, value)
    owner.openStepCount += value.status === 'open' ? 1 : 0
    return value
  }

  customer('lan', { displayName: 'Chị Lan', stage: 'new_inbox', suggestedPhones: [phone('0901234567')], firstResponseSeconds: null })
  thread('lan', '1029384756_901', 'facebook', [['in', 8, 'Gói giảm mỡ 3 tháng bên mình bao nhiêu em?'], ['in', 7, 'Số chị 0901 234 567 nha, chiều chị rảnh']])
  step('lan', { kind: 'inbox_reply', title: 'Phản hồi inbox', dueAt: iso(now - 3 * MINUTE), sopCode: 'SOP-INBOX-01', note: 'Số chị 0901 234 567 nha, chiều chị rảnh' })

  customer('vy', { displayName: 'Bé Vy', stage: 'new_inbox', platform: 'zalo', pageName: 'Aura Zalo OA', ownerUid: '', ownerName: '', firstResponseSeconds: null })
  thread('vy', 'pzl_aura_77', 'zalo', [['in', 42, 'Shop ơi có lớp yoga buổi tối không ạ?']])
  step('vy', { kind: 'inbox_reply', title: 'Phản hồi inbox', dueAt: iso(now - 37 * MINUTE), escalatedAt: iso(now - 27 * MINUTE), ownerUid: '', ownerName: '' })

  customer('phuc', { displayName: 'Anh Phúc', stage: 'consulting', phones: [phone('0912345678')], goal: 'Tăng 4kg cơ trong 3 tháng', preferredSlots: 'Tối thứ 2-4-6' })
  thread('phuc', '1029384756_902', 'facebook', [['in', 180, 'Anh muốn tập tăng cơ, đi làm về tầm 19h'], ['out', 175, 'Dạ khung 19h-20h bên em còn PT ạ, anh muốn tập thử không?'], ['in', 170, 'Để anh sắp xếp nhé'], ['out', 120, 'Dạ em gửi anh lịch trống tuần này nhé']])
  step('phuc', { kind: 'manual', title: 'Theo dõi lần 2', dueAt: iso(now + 5 * HOUR) })

  customer('hanh', { displayName: 'Chị Hạnh', stage: 'trial_booked', phones: [phone('0938111222')], goal: 'Giảm mỡ bụng sau sinh' })
  thread('hanh', '1029384756_903', 'facebook', [['in', 1500, 'Cho chị đăng ký tập thử'], ['out', 1490, 'Dạ chị tới lúc 19h thứ Tư nhé, PT Minh đón chị']])
  appointments.push({ id: nextId('appt'), customerId: 'hanh', kind: 'trial', status: 'booked', startAt: iso(now + DAY + 5 * HOUR), branchId: 'q7', note: 'PT Minh đón', createdByName: 'Minh Sales' })
  step('hanh', { kind: 'manual', title: 'Nhắc khách lịch tập thử', dueAt: iso(now + 5 * HOUR), sopCode: 'SOP-TRIAL-01' })

  customer('quan', { displayName: 'Bạn Quân', stage: 'quote_sent', phones: [phone('0977333444')], quoteIds: ['quote-demo'] })
  thread('quan', '1029384756_904', 'facebook', [['in', 3000, 'Gói 24 buổi giá sao anh?'], ['out', 2990, 'Em gửi báo giá trong tin nhắn trước nhé']])
  step('quan', { kind: 'manual', title: 'Nhắc báo giá', dueAt: iso(now - 2 * HOUR) })

  customer('mai', {
    displayName: 'Chị Mai', stage: 'won', phones: [phone('0909555666')], studentId: 'demo-student-1', wonAt: iso(now - 10 * DAY),
    careOwnerUid: 'demo-care', careOwnerName: 'Hà CSKH', careOwnerKind: 'customer_care', contractIds: ['contract-demo'], goal: 'Giảm 6kg',
  })
  thread('mai', '1029384756_905', 'facebook', [['in', 20 * 1440, 'Gói 3 tháng có trả góp không em?'], ['out', 20 * 1440 - 5, 'Dạ có, chia 3 kỳ ạ'], ['in', 9 * 1440, 'Buổi đầu vui lắm em ơi'], ['out', 9 * 1440 - 30, 'Dạ cảm ơn chị!'], ['in', 21, 'Mai chị xin dời buổi tập sang 18h được không?']])
  step('mai', { kind: 'student_reply', title: 'Trả lời học viên nhắn page', dueAt: iso(now - 6 * MINUTE), ownerUid: 'demo-care', ownerName: 'Hà CSKH', ownerRole: 'care_owner' })
  step('mai', { kind: 'handover', title: 'Nhận bàn giao học viên mới', status: 'done', dueAt: iso(now - 9 * DAY), completedAt: iso(now - 9 * DAY), completedByName: 'Hà CSKH', ownerUid: 'demo-care', ownerName: 'Hà CSKH', ownerRole: 'care_owner' })

  customer('tuan', { displayName: 'Anh Tuấn', stage: 'lost', lostReason: 'price', lostReasonLabel: 'Giá chưa phù hợp', lostNote: 'Đang so sánh với phòng gần nhà' })
  thread('tuan', '1029384756_906', 'facebook', [['in', 7000, 'Giá hơi cao em ạ'], ['out', 6990, 'Dạ em hiểu, có ưu đãi tháng sau em báo anh nhé']])

  customer('ngoc', { displayName: 'Chị Ngọc', stage: 'nurture', goal: 'Chưa sắp xếp được thời gian' })
  thread('ngoc', '1029384756_907', 'facebook', [['in', 9000, 'Tháng sau chị mới đi tập được'], ['out', 8990, 'Dạ em hẹn chị tháng sau nhé']])

  activities.push(
    { id: nextId('act'), customerId: 'phuc', type: 'call', outcome: 'interested', note: 'Muốn tập 3 buổi/tuần', data: {}, actorName: 'Minh Sales', createdAt: iso(now - 3 * HOUR) },
    { id: nextId('act'), customerId: 'mai', type: 'stage_change', outcome: '', note: 'Hợp đồng PT 1:1 · 3 tháng được tạo.', data: { fromStage: 'quote_sent', toStage: 'won' }, actorName: 'Aura', createdAt: iso(now - 10 * DAY) },
    { id: nextId('act'), customerId: 'mai', type: 'call', outcome: 'connected', note: 'Hỏi thăm buổi đầu, chị rất hài lòng', data: {}, actorName: 'Hà CSKH', createdAt: iso(now - 9 * DAY) },
  )

  const pages: CrmPancakePage[] = [{
    pageId: '1029384756', name: 'Aura Fitness Q7', platform: 'facebook', branchId: 'q7', enabled: true, status: 'active',
    tagMap: { new_inbox: '1', consulting: '2', won: '3' }, staffMap: { 'pk-1': { uid: 'demo-sales', name: 'Minh Sales' } },
    pancakeTags: [{ id: '1', text: 'AURA: Khách mới', color: '#e91e63' }, { id: '2', text: 'AURA: Đang tư vấn', color: '#2196f3' }, { id: '3', text: 'AURA: Học viên', color: '#4caf50' }, { id: '4', text: 'AURA: Mất', color: '#9e9e9e' }],
    pancakeUsers: [{ id: 'pk-1', name: 'Minh (Pancake)', email: '' }, { id: 'pk-2', name: 'Lan (Pancake)', email: '' }],
    webhookLastReceivedAt: iso(now - 2 * MINUTE), webhookSuspectedDown: false, webhookSecretHint: 'x7Qa', lastReconcileAt: iso(now - 3 * MINUTE),
    lastReconcileSynced: 0, lastError: null, backfill: { status: 'done', conversations: 412, since: iso(now - 90 * DAY), cursorUntil: iso(now - 90 * DAY), startedAt: iso(now - 2 * DAY), finishedAt: iso(now - 2 * DAY + 3 * HOUR) },
    revision: 4, connectedAt: iso(now - 2 * DAY), updatedAt: iso(now - HOUR),
  }, {
    pageId: 'pzl_aura', name: 'Aura Zalo OA', platform: 'zalo', branchId: 'q7', enabled: true, status: 'active', tagMap: {}, staffMap: {},
    pancakeTags: [], pancakeUsers: [], webhookLastReceivedAt: iso(now - 50 * MINUTE), webhookSuspectedDown: true, webhookSecretHint: 'p2Lm',
    lastReconcileAt: iso(now - 4 * MINUTE), lastReconcileSynced: 3, lastError: null, backfill: null, revision: 1, connectedAt: iso(now - DAY), updatedAt: iso(now - DAY),
  }]

  return { customers, conversations, messages, steps, activities, appointments, pages, nextId, now }
}

function card(value: CrmCustomer): CrmCustomerCard {
  return {
    id: value.id, displayName: value.displayName, phone: value.phones[0]?.display || '', stage: value.stage, ownerName: value.ownerName,
    careOwnerName: value.careOwnerName, platform: value.platform, goal: value.goal, studentId: value.studentId, lastInboundAt: value.lastInboundAt,
    nextStepAt: value.nextStepAt, openStepCount: value.openStepCount, updatedAt: value.updatedAt, revision: value.revision,
  }
}

function fold(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase()
}

export function createCrmDemoTransport(): CrmTransport {
  const state = createState(Date.now())
  const wait = () => new Promise((resolve) => setTimeout(resolve, 180))
  const fail = (message: string) => { throw Object.assign(new Error(message), { code: 'functions/failed-precondition' }) }
  const touch = (value: DemoCustomer) => { value.revision += 1; value.updatedAt = new Date().toISOString(); value.stageLabel = STAGE_LABELS[value.stage] }
  const mirror = (value: DemoCustomer) => value.conversationKeys.forEach((key) => {
    const conversation = state.conversations.get(key)
    if (conversation) Object.assign(conversation, { customerStage: value.stage, ownerUid: value.ownerUid, ownerName: value.ownerName, displayName: value.displayName, studentId: value.studentId })
  })
  const stepRow = (step: CrmStep) => ({ ...step, overdue: step.status === 'open' && Boolean(step.dueAt) && new Date(step.dueAt!).getTime() <= Date.now() })
  const log = (customerId: string, type: string, note: string, data: Record<string, unknown> = {}, outcome = '') => {
    state.activities.unshift({ id: state.nextId('act'), customerId, type, outcome, note, data, actorName: 'Bạn (demo)', createdAt: new Date().toISOString() })
  }
  const getCustomer = (id: unknown) => state.customers.get(String(id)) || fail('Không tìm thấy khách hàng.')

  const queries: Record<string, (data: Record<string, unknown>) => unknown> = {
    inbox: (data) => {
      let rows = [...state.conversations.values()]
      if (data.filter === 'awaiting' || !data.filter) rows = rows.filter((row) => row.awaitingReply).sort((left, right) => String(left.awaitingSince).localeCompare(String(right.awaitingSince)))
      else {
        if (data.filter === 'mine') rows = rows.filter((row) => row.ownerUid === 'demo-sales')
        if (data.filter === 'new') rows = rows.filter((row) => row.customerStage === 'new_inbox')
        rows.sort((left, right) => String(right.lastMessageAt).localeCompare(String(left.lastMessageAt)))
      }
      return { schemaVersion: 1, filter: data.filter || 'awaiting', rows, hasMore: false, nextCursor: null }
    },
    pipeline: (data) => ({
      schemaVersion: 1,
      columns: CRM_STAGES.map((stage) => {
        const rows = [...state.customers.values()].filter((value) => value.stage === stage && (data.owner !== 'me' || value.ownerUid === 'demo-sales'))
        return { stage, label: STAGE_LABELS[stage], count: rows.length, rows: rows.map(card) }
      }),
    }),
    customers: (data) => {
      const words = fold(String(data.query || '')).split(/\s+/).filter(Boolean)
      const rows = [...state.customers.values()]
        .filter((value) => (data.scope !== 'care' || value.careOwnerUid === 'demo-care') && (!data.stage || value.stage === data.stage))
        .filter((value) => !words.length || words.every((word) => fold(value.displayName).includes(word) || value.phones.some((item) => item.display.replace(/\s/g, '').includes(word))))
        .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      return { schemaVersion: 1, rows: rows.map(card), hasMore: false, nextCursor: null }
    },
    customer: (data) => {
      const value = getCustomer(data.customerId)
      const own = (row: { customerId: string }) => row.customerId === value.id
      const { conversationKeys: _keys, ...customer } = value
      return {
        schemaVersion: 1,
        customer: { ...customer, stageLabel: STAGE_LABELS[value.stage] },
        access: { manage: true, presale: true, postsale: true, care: false, assignCare: true, erase: true },
        conversations: value.conversationKeys.map((key) => state.conversations.get(key)!).filter(Boolean),
        openSteps: [...state.steps.values()].filter((step) => own(step) && step.status === 'open').map(stepRow).sort((left, right) => String(left.dueAt).localeCompare(String(right.dueAt))),
        doneSteps: [...state.steps.values()].filter((step) => own(step) && step.status !== 'open').map(stepRow),
        activities: state.activities.filter(own),
        appointments: state.appointments.filter(own),
        quotes: value.quoteIds.map((id) => ({ id, code: 'AQ-20261106-7KQ2', packageName: 'PT 1:1 · 24 buổi', finalPrice: 9_600_000, status: 'pending' })),
        student: value.studentId ? { id: value.studentId, name: value.displayName, branchId: 'q7', status: 'active' } : null,
      }
    },
    messages: (data) => {
      const value = getCustomer(data.customerId)
      const key = String(data.conversationKey || value.conversationKeys[0] || '')
      return { schemaVersion: 1, conversationKey: key, rows: [...(state.messages.get(key) || [])].reverse(), hasMore: false, nextCursor: null, hiddenBefore: null, wonAt: value.wonAt }
    },
    steps: (data) => {
      const status = data.status === 'done' ? 'done' : 'open'
      const rows = [...state.steps.values()]
        .filter((step) => (status === 'open' ? step.status === 'open' : step.status !== 'open'))
        .filter((step) => data.scope === 'branch' || ['demo-sales', 'demo-care', ''].includes(step.ownerUid))
        .map(stepRow)
        .sort((left, right) => String(left.dueAt).localeCompare(String(right.dueAt)))
      return { schemaVersion: 1, rows, hasMore: false, nextCursor: null }
    },
    staff: () => ({ schemaVersion: 1, staff: [
      { uid: 'demo-sales', name: 'Minh Sales', positions: ['sales'] },
      { uid: 'demo-sales-2', name: 'Lan Sales', positions: ['sales'] },
      { uid: 'demo-care', name: 'Hà CSKH', positions: ['customer_care'] },
      { uid: 'demo-care-2', name: 'Thảo CSKH', positions: ['customer_care'] },
    ] }),
    careAssignments: () => ({
      schemaVersion: 1, truncated: false,
      careStaff: [{ uid: 'demo-care', name: 'Hà CSKH' }, { uid: 'demo-care-2', name: 'Thảo CSKH' }],
      rows: [
        { studentId: 'demo-student-1', name: 'Chị Mai', phone: '0909 555 666', careOwnerUid: 'demo-care', careOwnerName: 'Hà CSKH' },
        { studentId: 'demo-student-2', name: 'Anh Khoa', phone: '0988 777 111', careOwnerUid: '', careOwnerName: '' },
        { studentId: 'demo-student-3', name: 'Chị Thu', phone: '0903 222 444', careOwnerUid: '', careOwnerName: '' },
      ],
    }),
    linkTargets: () => ({ schemaVersion: 1, rows: [{ studentId: 'demo-student-2', name: 'Anh Khoa', phone: '0988 777 111', branchId: 'q7', linkedCustomerId: '' }] }),
    quoteCandidates: () => ({ schemaVersion: 1, rows: [{ id: 'quote-demo-2', code: 'AQ-20261108-P4MZ', customerName: 'Khách', packageName: 'PT 1:1 · 12 buổi', finalPrice: 5_400_000, status: 'pending', linked: false }] }),
    integration: () => ({
      schemaVersion: 1, webhookBaseUrl: 'https://asia-east1-demo.cloudfunctions.net/pancakeWebhook', pages: state.pages,
      branches: [{ id: 'q7', name: 'Aura Q7' }, { id: 'q1', name: 'Aura Q1' }],
      stages: CRM_STAGES.map((stage) => ({ stage, label: STAGE_LABELS[stage] })),
    }),
  }

  const commands: Record<string, (data: Record<string, unknown>) => unknown> = {
    updateStage: (data) => {
      const value = getCustomer(data.customerId)
      if (data.stage === 'lost' && !data.lostReason) fail('Chọn lý do mất khách.')
      if (data.stage === 'won' && !value.studentId) fail('Chỉ chuyển sang Thắng khi khách đã có hồ sơ học viên. Hãy nối học viên trước.')
      log(value.id, 'stage_change', String(data.note || ''), { fromStage: value.stage, toStage: data.stage })
      value.stage = data.stage as CrmStage
      value.lostReason = (data.stage === 'lost' ? data.lostReason : '') as CrmCustomer['lostReason']
      value.lostNote = data.stage === 'lost' ? String(data.note || '') : ''
      touch(value); mirror(value)
      return { customerId: value.id, revision: value.revision, unchanged: false }
    },
    updateProfile: (data) => {
      const value = getCustomer(data.customerId)
      if (typeof data.displayName === 'string') value.displayName = data.displayName
      if (Array.isArray(data.phones)) {
        value.phones = data.phones.map((item) => String(item).replace(/\D/g, '')).filter((item) => item.length >= 9).map((item) => phone(item.startsWith('84') ? `0${item.slice(2)}` : item.startsWith('0') ? item : `0${item}`))
        value.suggestedPhones = value.suggestedPhones.filter((item) => !value.phones.some((saved) => saved.value === item.value))
      }
      for (const field of ['goal', 'preferredSlots', 'note'] as const) if (typeof data[field] === 'string') value[field] = data[field] as string
      touch(value); mirror(value)
      log(value.id, 'note', 'Cập nhật hồ sơ.')
      const duplicates = value.phones.some((item) => item.value === '+84912345678') && value.id !== 'phuc' ? [{ id: 'phuc', displayName: 'Anh Phúc', stage: 'consulting', phone: '0912 345 678' }] : []
      return { customerId: value.id, revision: value.revision, duplicates }
    },
    assignOwner: (data) => {
      const value = getCustomer(data.customerId)
      const names: Record<string, string> = { 'demo-sales': 'Minh Sales', 'demo-sales-2': 'Lan Sales' }
      value.ownerUid = String(data.ownerUid || '')
      value.ownerName = names[value.ownerUid] || ''
      touch(value); mirror(value)
      log(value.id, 'assignment', value.ownerName ? `Giao cho ${value.ownerName}.` : 'Bỏ người phụ trách.')
      return { customerId: value.id, revision: value.revision }
    },
    recordActivity: (data) => {
      const value = getCustomer(data.customerId)
      log(value.id, String(data.type), String(data.note || ''), {}, String(data.outcome || ''))
      return { recorded: true }
    },
    createStep: (data) => {
      const value = getCustomer(data.customerId)
      const id = state.nextId('step')
      state.steps.set(id, { id, customerId: value.id, customerName: value.displayName, studentId: value.studentId, kind: 'manual', title: String(data.title), note: String(data.note || ''), status: 'open', ownerUid: 'demo-sales', ownerName: 'Bạn (demo)', ownerRole: 'sales', dueAt: String(data.dueAt), overdue: false, escalatedAt: null, outcome: '', completedAt: null, completedByName: '', autoClosed: false, sopCode: '', branchId: 'q7', conversationKey: '' })
      value.openStepCount += 1
      return { stepId: id }
    },
    completeStep: (data) => {
      const step = state.steps.get(String(data.stepId)) || fail('Không tìm thấy bước chăm sóc.')
      Object.assign(step, { status: data.status === 'skipped' ? 'skipped' : 'done', completedAt: new Date().toISOString(), completedByName: 'Bạn (demo)' })
      const value = state.customers.get(step.customerId)
      if (value) value.openStepCount = Math.max(0, value.openStepCount - 1)
      if (data.note && value) log(value.id, 'note', `${step.title}: ${data.note}`)
      return { stepId: step.id, status: step.status }
    },
    createAppointment: (data) => {
      const value = getCustomer(data.customerId)
      const appointment = { id: state.nextId('appt'), customerId: value.id, kind: data.kind as CrmAppointment['kind'], status: 'booked' as const, startAt: String(data.startAt), branchId: 'q7', note: String(data.note || ''), createdByName: 'Bạn (demo)' }
      state.appointments.unshift(appointment)
      if (data.kind === 'trial' && ['new_inbox', 'qualified', 'consulting'].includes(value.stage)) { value.stage = 'trial_booked'; touch(value); mirror(value) }
      log(value.id, 'meeting', `Hẹn ${data.kind === 'trial' ? 'tập thử' : 'tư vấn'}.`)
      return { appointmentId: appointment.id, stage: value.stage }
    },
    updateAppointment: (data) => {
      const appointment = state.appointments.find((row) => row.id === data.appointmentId) || fail('Không tìm thấy lịch hẹn.')
      appointment.status = data.status as CrmAppointment['status']
      const value = getCustomer(appointment.customerId)
      if (data.status === 'attended' && appointment.kind === 'trial' && ['new_inbox', 'qualified', 'consulting', 'trial_booked'].includes(value.stage)) { value.stage = 'trial_done'; touch(value); mirror(value) }
      return { appointmentId: appointment.id, stage: value.stage }
    },
    linkStudent: (data) => {
      const value = getCustomer(data.customerId)
      value.studentId = String(data.studentId)
      value.stage = 'won'; value.wonAt = new Date().toISOString(); value.careOwnerName = 'PT Minh'; value.careOwnerKind = 'trainer'
      touch(value); mirror(value)
      return { customerId: value.id, stage: value.stage, contracts: 1 }
    },
    linkQuote: (data) => {
      const value = getCustomer(data.customerId)
      if (!value.quoteIds.includes(String(data.quoteId))) value.quoteIds.push(String(data.quoteId))
      if (['new_inbox', 'qualified', 'consulting', 'trial_booked', 'trial_done'].includes(value.stage)) value.stage = 'quote_sent'
      touch(value); mirror(value)
      return { customerId: value.id, unchanged: false }
    },
    merge: (data) => {
      const source = getCustomer(data.sourceCustomerId)
      const target = getCustomer(data.targetCustomerId)
      target.conversationKeys.push(...source.conversationKeys)
      source.conversationKeys.forEach((key) => { const conversation = state.conversations.get(key); if (conversation) conversation.customerId = target.id })
      state.customers.delete(source.id)
      touch(target); mirror(target)
      return { targetCustomerId: target.id }
    },
    assignCareOwner: (data) => ({ schemaVersion: 1, assigned: (data.studentIds as string[]).length, results: (data.studentIds as string[]).map((studentId) => ({ studentId, ok: true })) }),
    erase: (data) => {
      const value = getCustomer(data.customerId)
      if (data.confirmation !== 'XOA') fail('Nhập XOA để xác nhận xóa vĩnh viễn.')
      value.conversationKeys.forEach((key) => { state.conversations.delete(key); state.messages.delete(key) })
      state.customers.delete(value.id)
      return { erased: true, counts: { messages: 0 } }
    },
  }

  const integrations: Record<string, (data: Record<string, unknown>) => unknown> = {
    connectPage: (data) => {
      const page: CrmPancakePage = { ...state.pages[0], pageId: String(data.pageId), name: String(data.name || data.pageId), branchId: String(data.branchId), tagMap: {}, staffMap: {}, backfill: null, revision: 1, webhookLastReceivedAt: null }
      state.pages.push(page)
      return { page, webhookUrl: `https://asia-east1-demo.cloudfunctions.net/pancakeWebhook/${page.pageId}/demoSecretVisibleOnlyOnce9x7Qa` }
    },
    updatePage: (data) => {
      const page = state.pages.find((row) => row.pageId === data.pageId) || fail('Page chưa được kết nối.')
      if (typeof data.enabled === 'boolean') { page.enabled = data.enabled; page.status = data.enabled ? 'active' : 'disabled' }
      if (data.tagMap) page.tagMap = Object.fromEntries(Object.entries(data.tagMap as Record<string, string>).filter(([, value]) => value))
      if (data.staffMap) page.staffMap = Object.fromEntries(Object.entries(data.staffMap as Record<string, string>).filter(([, value]) => value).map(([key, uid]) => [key, { uid, name: uid === 'demo-sales' ? 'Minh Sales' : 'Lan Sales' }]))
      if (typeof data.branchId === 'string') page.branchId = data.branchId
      page.revision += 1
      return { page }
    },
    rotateWebhookSecret: (data) => ({ webhookUrl: `https://asia-east1-demo.cloudfunctions.net/pancakeWebhook/${data.pageId}/rotatedDemoSecret4Kp` }),
    replaceToken: (data) => ({ page: state.pages.find((row) => row.pageId === data.pageId) }),
    refreshPageMeta: (data) => ({ page: state.pages.find((row) => row.pageId === data.pageId) }),
    startBackfill: (data) => {
      const page = state.pages.find((row) => row.pageId === data.pageId) || fail('Page chưa được kết nối.')
      page.backfill = { status: 'running', conversations: 0, since: new Date(Date.now() - Number(data.days) * DAY).toISOString(), cursorUntil: new Date().toISOString(), startedAt: new Date().toISOString(), finishedAt: null }
      return { page }
    },
    disconnectPage: (data) => {
      const page = state.pages.find((row) => row.pageId === data.pageId) || fail('Page chưa được kết nối.')
      page.enabled = false; page.status = 'disabled'
      return { page }
    },
  }

  const tables: Record<CrmEndpoint, Record<string, (data: Record<string, unknown>) => unknown>> = { crmQuery: queries, crmCommand: commands, crmIntegrationCommand: integrations }
  return async <T,>(endpoint: CrmEndpoint, data: Record<string, unknown>) => {
    await wait()
    const handler = tables[endpoint][String(data.action)]
    if (!handler) throw new Error(`Demo CRM chưa hỗ trợ ${String(data.action)}.`)
    return structuredClone(handler(data)) as T
  }
}
