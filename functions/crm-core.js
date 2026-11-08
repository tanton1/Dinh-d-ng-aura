'use strict'

// Pure CRM rules shared by the webhook, the sync jobs and the callables.
// Nothing here touches Firestore or the network, so every rule is testable.

const { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } = require('node:crypto')

const CRM_STAGES = Object.freeze(['new_inbox', 'qualified', 'consulting', 'trial_booked', 'trial_done', 'quote_sent', 'won', 'lost', 'nurture'])
const STAGE_LABELS = Object.freeze({
  new_inbox: 'Khách mới nhắn',
  qualified: 'Đủ thông tin',
  consulting: 'Đang tư vấn',
  trial_booked: 'Đã hẹn trải nghiệm',
  trial_done: 'Đã trải nghiệm',
  quote_sent: 'Đã gửi báo giá',
  won: 'Thắng',
  lost: 'Mất',
  nurture: 'Nuôi lại',
})
const LOST_REASONS = Object.freeze({
  price: 'Giá chưa phù hợp',
  distance: 'Xa chi nhánh',
  schedule: 'Không hợp lịch',
  no_need: 'Hết nhu cầu',
  competitor: 'Chọn nơi khác',
  no_response: 'Không phản hồi',
  other: 'Lý do khác',
})
const ACTIVITY_TYPES = Object.freeze(['call', 'zalo', 'meeting', 'note', 'message'])
const ACTIVITY_OUTCOMES = Object.freeze(['connected', 'no_answer', 'interested', 'not_interested', 'callback', 'booked', 'other'])
const APPOINTMENT_KINDS = Object.freeze(['trial', 'consult', 'inbody'])
const APPOINTMENT_STATUSES = Object.freeze(['booked', 'attended', 'no_show', 'cancelled'])
const STEP_KINDS = Object.freeze(['inbox_reply', 'student_reply', 'handover', 'manual'])
const PLATFORMS = Object.freeze(['facebook', 'instagram', 'zalo', 'tiktok', 'whatsapp', 'website', 'other'])

const INBOX_REPLY_SLA_MINUTES = 5
const STUDENT_REPLY_SLA_MINUTES = 15
const ESCALATE_AFTER_DUE_MINUTES = 10
// A reply step is only opened for a customer message this recent. Older
// unanswered threads found by reconciliation stay visible in the inbox but
// do not flood anyone with overdue tasks.
const REPLY_STEP_MAX_AGE_MS = 24 * 60 * 60_000
const BUSINESS_HOURS = Object.freeze({ openMinute: 8 * 60, closeMinute: 21 * 60 })
const VIETNAM_OFFSET_MS = 7 * 60 * 60_000
const MAX_TEXT_LENGTH = 4000
const PREVIEW_LENGTH = 200

function text(value, maximum = 500) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value).slice(0, maximum)
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function list(value) {
  return Array.isArray(value) ? value : []
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

// ---------------------------------------------------------------- identifiers

const SAFE_ID = /^[A-Za-z0-9_-]{1,300}$/

function pageIdValid(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value)
}

function conversationKey(pageId, conversationId) {
  const raw = `${pageId}__${conversationId}`
  return SAFE_ID.test(raw) && raw.length <= 300 ? raw : `h_${sha256(raw).slice(0, 40)}`
}

function messageDocId(messageId) {
  return `m_${sha256(messageId).slice(0, 32)}`
}

function channelLinkId({ platform, pageId, externalCustomerId, conversationId }) {
  const raw = externalCustomerId ? `${platform}__${pageId}__${externalCustomerId}` : `${platform}__${pageId}__c_${conversationId}`
  return SAFE_ID.test(raw) ? raw : `l_${sha256(raw).slice(0, 40)}`
}

function customerIdForLink(linkId) {
  return `cus_${sha256(linkId).slice(0, 24)}`
}

function inboundEventId(pageId, rawBody) {
  return `pe_${sha256(`${pageId}|${rawBody}`).slice(0, 40)}`
}

// Deep-link format of the Pancake web inbox; verify on the live account.
function pancakeConversationUrl(pageId, conversationId) {
  return `https://pancake.vn/${encodeURIComponent(pageId)}?c_id=${encodeURIComponent(conversationId)}`
}

function platformForPage(pageId, override = '') {
  if (PLATFORMS.includes(override)) return override
  const id = String(pageId || '')
  if (id.startsWith('igo_') || id.startsWith('ig_')) return 'instagram'
  if (id.startsWith('pzl_') || id.startsWith('zl_')) return 'zalo'
  if (id.startsWith('tt_') || id.startsWith('tiktok_')) return 'tiktok'
  if (id.startsWith('waba_') || id.startsWith('wa_')) return 'whatsapp'
  if (id.startsWith('web_')) return 'website'
  return /^\d+$/.test(id) ? 'facebook' : 'other'
}

// --------------------------------------------------------------------- phones

function normalizePhone(value) {
  const compact = String(value || '').trim().replace(/[\s().-]/g, '')
  if (!compact) return null
  const international = compact.startsWith('+')
  let digits = compact.replace(/^\+/, '')
  if (!/^\d{8,15}$/.test(digits)) return null
  if (digits.startsWith('84') && (digits.length === 11 || digits.length === 12)) digits = `0${digits.slice(2)}`
  if (digits.startsWith('0') && digits.length === 10 && /^0[35789]/.test(digits)) return `+84${digits.slice(1)}`
  if (digits.startsWith('02') && digits.length === 11) return `+84${digits.slice(1)}`
  if (international && !compact.startsWith('+84')) return `+${digits}`
  return null
}

function localPhone(e164) {
  return typeof e164 === 'string' && e164.startsWith('+84') ? `0${e164.slice(3)}` : String(e164 || '').replace(/^\+/, '')
}

function displayPhone(e164) {
  const local = localPhone(e164)
  return local.length === 10 ? `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}` : local
}

// Vietnamese numbers typed in chat: 0901234567, 090 123 4567, +84 901-234-567.
function phonesInText(value) {
  const found = new Set()
  const pattern = /(?:\+?84|0)[\s.-]?[35789](?:[\s.-]?\d){8}/g
  for (const match of String(value || '').matchAll(pattern)) {
    const phone = normalizePhone(match[0])
    if (phone) found.add(phone)
    if (found.size >= 3) break
  }
  return [...found]
}

// Formats a stored student phone may use, for an exact `in` lookup.
function phoneLookupVariants(e164) {
  const local = localPhone(e164)
  if (local.length !== 10) return [e164].filter(Boolean)
  const national = local.slice(1)
  return [...new Set([
    local, `+84${national}`, `84${national}`,
    `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`,
    `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`,
    `${local.slice(0, 4)}.${local.slice(4, 7)}.${local.slice(7)}`,
    `${local.slice(0, 4)}-${local.slice(4, 7)}-${local.slice(7)}`,
  ])]
}

// --------------------------------------------------------------------- search

function foldText(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase()
}

function searchTokens(displayName, phones = []) {
  const tokens = new Set()
  for (const word of foldText(displayName).split(/[^a-z0-9]+/).filter((item) => item.length >= 2).slice(0, 8)) {
    for (let length = 2; length <= Math.min(word.length, 10); length += 1) tokens.add(word.slice(0, length))
  }
  for (const phone of list(phones).slice(0, 5)) {
    const local = localPhone(phone)
    if (local) tokens.add(local)
    if (local.length >= 4) tokens.add(`#${local.slice(-4)}`)
  }
  return [...tokens].slice(0, 120)
}

// Firestore can match a single array element; the remaining words are
// checked in memory on the bounded candidate set.
function searchQuery(value) {
  const raw = String(value || '').trim()
  const digits = raw.replace(/\D/g, '')
  if (digits.length >= 9) {
    const phone = normalizePhone(raw) || normalizePhone(`0${digits.replace(/^0/, '')}`)
    if (phone) return { token: localPhone(phone), words: [] }
  }
  if (digits.length === 4 && digits === raw.replace(/\s/g, '')) return { token: `#${digits}`, words: [] }
  const words = foldText(raw).split(/[^a-z0-9]+/).filter((item) => item.length >= 2)
  if (!words.length) return null
  const token = [...words].sort((left, right) => right.length - left.length)[0].slice(0, 10)
  return { token, words }
}

function matchesSearch(customer, query) {
  if (!query?.words?.length) return true
  const nameWords = foldText(customer.displayName).split(/[^a-z0-9]+/)
  return query.words.every((word) => nameWords.some((item) => item.startsWith(word)))
}

// ----------------------------------------------------------- Pancake payloads

function pancakeTime(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 1e12 ? Math.round(value * 1000) : Math.round(value)
  const raw = text(value, 40)
  if (!raw) return 0
  if (/^\d+$/.test(raw)) return pancakeTime(Number(raw))
  // Pancake returns naive ISO timestamps in UTC.
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}Z`
  const parsed = Date.parse(zoned)
  return Number.isFinite(parsed) ? parsed : 0
}

function plainText(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function attachmentType(raw) {
  const declared = text(raw.type, 40).toLowerCase()
  const mime = text(raw.mime_type || raw.mime, 80).toLowerCase()
  if (declared.includes('sticker')) return 'sticker'
  if (declared.includes('photo') || declared.includes('image') || mime.startsWith('image/')) return 'image'
  if (declared.includes('video') || mime.startsWith('video/')) return 'video'
  if (declared.includes('audio') || mime.startsWith('audio/')) return 'audio'
  if (declared.includes('link') || declared.includes('fallback')) return 'link'
  return 'file'
}

function normalizeAttachment(raw) {
  const value = object(raw)
  if (!value) return null
  const url = text(value.url || value.payload?.url || value.image_data?.url || value.preview_url || value.file_url, 2000)
  if (!url && !value.name && !value.title) return null
  return {
    type: attachmentType(value),
    url: /^https:\/\//.test(url) ? url : '',
    name: text(value.name || value.title, 160),
    mime: text(value.mime_type || value.mime, 80),
  }
}

function normalizePancakeConversation(raw, pageId) {
  const value = object(raw)
  const conversationId = text(value?.id, 200)
  if (!value || !conversationId) return null
  const customers = list(value.customers).map(object).filter(Boolean)
  const customer = customers[0] || object(value.from) || {}
  const prefix = `${pageId}_`
  const externalCustomerId = text(customer.fb_id || customer.psid || customer.uid || value.from?.id, 120)
    || (conversationId.startsWith(prefix) ? conversationId.slice(prefix.length) : '')
  const tagIds = list(value.tags).map((tag) => text(object(tag) ? tag.id : tag, 40)).filter(Boolean).slice(0, 40)
  const assigneeIds = list(value.assignee_ids || value.current_assign_users?.map?.((user) => user?.id))
    .map((item) => text(item, 80)).filter(Boolean).slice(0, 20)
  const phones = [...new Set(list(value.recent_phone_numbers)
    .map((item) => normalizePhone(object(item) ? item.phone_number || item.captured || item.phone : item))
    .filter(Boolean))].slice(0, 5)
  const lastSentBy = object(value.last_sent_by)
  return {
    conversationId,
    type: text(value.type || 'INBOX', 20).toUpperCase(),
    externalCustomerId,
    pageCustomerId: text(customer.id || value.page_customer?.id || value.customer_id, 120),
    customerName: text(customer.name || value.from?.name, 160),
    tagIds,
    assigneeIds,
    phones,
    snippet: plainText(value.snippet || value.last_message || '').slice(0, PREVIEW_LENGTH),
    updatedAt: pancakeTime(value.updated_at),
    insertedAt: pancakeTime(value.inserted_at),
    unread: value.seen === false || Number(value.unread_count || 0) > 0,
    lastSentByPage: lastSentBy ? text(lastSentBy.id, 120) !== externalCustomerId : null,
  }
}

function normalizePancakeMessage(raw, { pageId, externalCustomerId = '' } = {}) {
  const value = object(raw)
  const messageId = text(value?.id || value?.message_id, 300)
  if (!value || !messageId) return null
  const fromId = text(value.from?.id || value.from_id, 120)
  const inbound = externalCustomerId && fromId
    ? fromId === externalCustomerId
    : Boolean(fromId) && fromId !== pageId && !pageId.endsWith(`_${fromId}`)
  const attachments = list(value.attachments).slice(0, 10).map(normalizeAttachment).filter(Boolean)
  const body = plainText(value.original_message ?? value.message ?? value.text ?? '')
  return {
    messageId,
    direction: inbound ? 'in' : 'out',
    senderKind: inbound ? 'customer' : 'page',
    senderName: text(value.from?.name, 120),
    senderPancakeUserId: inbound ? '' : text(value.from?.admin_id || value.admin_id || value.sender_id || value.from?.uid, 80),
    text: body.slice(0, MAX_TEXT_LENGTH),
    attachments,
    sentAt: pancakeTime(value.inserted_at || value.created_at || value.timestamp || value.created_time),
  }
}

// The webhook body is not publicly documented. Read whatever identifies a
// conversation; the sync then pulls the authoritative messages from the API.
function webhookRefs(payload) {
  const root = object(payload) || {}
  const data = object(root.data) || root
  const conversation = object(data.conversation) || object(root.conversation)
  const message = object(data.message) || object(root.message)
  const topic = text(root.event_type || root.type || root.event || root.topic || data.event_type || data.type, 60).toLowerCase()
    || (message ? 'messaging' : conversation ? 'conversation' : 'unknown')
  return {
    topic,
    pageId: text(root.page_id || data.page_id || conversation?.page_id || message?.page_id, 80),
    conversationId: text(conversation?.id || data.conversation_id || root.conversation_id || message?.conversation_id, 200),
    messageId: text(message?.id || data.message_id || root.message_id, 300),
    conversation,
    message,
  }
}

// ------------------------------------------------------------- reply state

// Messages ascending by time. Trailing customer messages mean the page owes
// a reply; awaitingSince is the first of them.
function replyState(messages) {
  let awaitingSince = null
  let lastInboundAt = 0
  let lastOutboundAt = 0
  let firstInboundAt = 0
  let firstResponseAt = 0
  for (const message of messages) {
    if (!message?.sentAt) continue
    if (message.direction === 'in') {
      if (!firstInboundAt) firstInboundAt = message.sentAt
      lastInboundAt = message.sentAt
      if (awaitingSince === null) awaitingSince = message.sentAt
    } else {
      lastOutboundAt = message.sentAt
      awaitingSince = null
      if (firstInboundAt && !firstResponseAt) firstResponseAt = message.sentAt
    }
  }
  return { awaitingSince, lastInboundAt, lastOutboundAt, firstInboundAt, firstResponseAt }
}

function vietnamMinuteOfDay(ms) {
  const local = new Date(ms + VIETNAM_OFFSET_MS)
  return local.getUTCHours() * 60 + local.getUTCMinutes()
}

function vietnamDayStart(ms) {
  const local = ms + VIETNAM_OFFSET_MS
  return local - (local % 86_400_000) - VIETNAM_OFFSET_MS
}

// SLA minutes count from the moment Aura is open. A message at 23:00 is due
// five minutes after the next morning's opening, not five minutes later.
function slaDueAt(startMs, minutes, hours = BUSINESS_HOURS) {
  const minute = vietnamMinuteOfDay(startMs)
  const dayStart = vietnamDayStart(startMs)
  let base = startMs
  if (minute < hours.openMinute) base = dayStart + hours.openMinute * 60_000
  else if (minute >= hours.closeMinute) base = dayStart + 86_400_000 + hours.openMinute * 60_000
  return base + minutes * 60_000
}

function vietnamDateKey(ms) {
  return new Date(ms + VIETNAM_OFFSET_MS).toISOString().slice(0, 10)
}

// ------------------------------------------------------------------- access

const ADMIN_ROLES = new Set(['admin', 'super_admin'])

function crmScope(actor) {
  const capabilities = new Set(list(actor?.capabilities))
  const admin = ADMIN_ROLES.has(actor?.accessRole)
  const has = (capability) => admin || capabilities.has(capability)
  return {
    uid: actor?.uid || '',
    actorName: text(actor?.actorName, 160) || 'Nhân sự Aura',
    staffKeys: [...new Set([actor?.uid, actor?.legacyStaffId].filter((item) => typeof item === 'string' && item))],
    branchIds: list(actor?.branchIds).filter((item) => typeof item === 'string' && item),
    admin,
    manager: admin || list(actor?.positions).includes('branch_manager'),
    branchView: has('crm.customers.branch.view'),
    manage: has('crm.customers.self.manage'),
    presale: has('crm.messages.presale.read'),
    postsale: has('crm.messages.postsale.read'),
    steps: has('crm.steps.assigned.manage'),
    assignCare: has('crm.care_owner.assign'),
    integration: admin && capabilities.has('crm.integration.manage'),
    erase: admin && capabilities.has('crm.customers.erase'),
  }
}

function usesCrm(scope) {
  return scope.branchView || scope.steps || scope.admin
}

function isCareOwner(scope, customer) {
  return Boolean(customer?.studentId) && (
    (customer.careOwnerUid && customer.careOwnerUid === scope.uid)
    || (customer.careOwnerStaffId && scope.staffKeys.includes(customer.careOwnerStaffId))
  )
}

// Sales and branch managers see their branch. Customer care and the main PT
// see only the students they look after, and only after the signing date.
function customerAccess(scope, customer) {
  if (!customer) return { view: false }
  if (scope.admin) return { view: true, manage: true, presale: true, postsale: true }
  const inBranch = Boolean(customer.branchId) && scope.branchIds.includes(customer.branchId)
  if (scope.branchView && scope.presale && inBranch) {
    return { view: true, manage: scope.manage, presale: true, postsale: scope.postsale }
  }
  if (scope.postsale && isCareOwner(scope, customer)) {
    return { view: true, manage: false, presale: false, postsale: true, care: true }
  }
  return { view: false }
}

function branchAllowed(scope, branchId) {
  return scope.admin || (Boolean(branchId) && scope.branchIds.includes(branchId))
}

// ------------------------------------------------------------- stage rules

function stageIssue(customer, nextStage, { lostReason = '' } = {}) {
  if (!CRM_STAGES.includes(nextStage)) return 'Giai đoạn không hợp lệ.'
  if (nextStage === 'lost' && !LOST_REASONS[lostReason]) return 'Chọn lý do mất khách.'
  if (nextStage === 'won' && !customer.studentId) return 'Chỉ chuyển sang Thắng khi khách đã có hồ sơ học viên. Hãy nối học viên trước.'
  if (customer.stage === 'won' && nextStage !== 'won' && customer.studentId) return 'Khách đã là học viên; giai đoạn sau bán đi theo hợp đồng và tái ký.'
  return ''
}

// ---------------------------------------------------------- secret storage

function encryptionKey(secret) {
  if (typeof secret !== 'string' || secret.length < 16) throw new Error('CRM token key is not configured')
  return createHash('sha256').update(secret).digest()
}

function encryptToken(plain, secret) {
  const key = encryptionKey(secret)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    keyId: sha256(key.toString('hex')).slice(0, 12),
  }
}

function decryptToken(record, secret) {
  const key = encryptionKey(secret)
  if (!record?.ciphertext || !record.iv || !record.tag) throw new Error('Token record is incomplete')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(record.tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]).toString('utf8')
}

function newWebhookSecret() {
  return randomBytes(24).toString('base64url')
}

function webhookSecretHash(secret) {
  return sha256(`pancake-webhook|${secret}`)
}

function webhookSecretMatches(secret, storedHash) {
  if (typeof secret !== 'string' || !secret || typeof storedHash !== 'string' || storedHash.length !== 64) return false
  const actual = Buffer.from(webhookSecretHash(secret), 'hex')
  const expected = Buffer.from(storedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

module.exports = {
  ACTIVITY_OUTCOMES,
  ACTIVITY_TYPES,
  APPOINTMENT_KINDS,
  APPOINTMENT_STATUSES,
  BUSINESS_HOURS,
  CRM_STAGES,
  ESCALATE_AFTER_DUE_MINUTES,
  INBOX_REPLY_SLA_MINUTES,
  LOST_REASONS,
  PLATFORMS,
  PREVIEW_LENGTH,
  REPLY_STEP_MAX_AGE_MS,
  STAGE_LABELS,
  STEP_KINDS,
  STUDENT_REPLY_SLA_MINUTES,
  branchAllowed,
  channelLinkId,
  conversationKey,
  crmScope,
  customerAccess,
  customerIdForLink,
  decryptToken,
  displayPhone,
  encryptToken,
  foldText,
  inboundEventId,
  isCareOwner,
  localPhone,
  matchesSearch,
  messageDocId,
  newWebhookSecret,
  normalizePancakeConversation,
  normalizePancakeMessage,
  normalizePhone,
  pageIdValid,
  pancakeConversationUrl,
  pancakeTime,
  phoneLookupVariants,
  phonesInText,
  plainText,
  platformForPage,
  replyState,
  searchQuery,
  searchTokens,
  sha256,
  slaDueAt,
  stageIssue,
  text,
  usesCrm,
  vietnamDateKey,
  webhookRefs,
  webhookSecretHash,
  webhookSecretMatches,
}
