import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebaseFunctions'

export type PtScheduleEventType = 'workout' | 'checkin' | 'recovery'
export type PtScheduleEventStatus = 'planned' | 'done' | 'skipped' | 'cancelled'

export interface PtScheduleWorkoutReference {
  programId: string
  versionId: string
  sessionId: string
}

export interface PtScheduleEvent {
  id: string
  clientId: string
  coachId: string
  date: string
  time: string
  durationMinutes: number
  title: string
  type: PtScheduleEventType
  note: string
  status: PtScheduleEventStatus
  timeZone: string
  workoutRef?: PtScheduleWorkoutReference
  createdAt?: string
  updatedAt?: string
  completedAt?: string
  cancelledAt?: string
  cancellationReason?: string
}

export interface PtScheduleEventDraft {
  date: string
  time: string
  durationMinutes: number
  title: string
  type: PtScheduleEventType
  note: string
  workoutRef?: PtScheduleWorkoutReference
}

export interface PtScheduleRangeInput {
  clientId?: string
  fromDate: string
  toDate: string
}

export interface SavePtScheduleEventInput {
  clientId: string
  eventId: string
  expectedUpdatedAt?: string
  event: PtScheduleEventDraft
}

export interface SetPtScheduleEventStatusInput {
  clientId: string
  eventId: string
  status: Extract<PtScheduleEventStatus, 'done' | 'skipped' | 'cancelled'>
  expectedUpdatedAt?: string
  cancellationReason?: string
}

const eventTypes = new Set<PtScheduleEventType>(['workout', 'checkin', 'recovery'])
const eventStatuses = new Set<PtScheduleEventStatus>(['planned', 'done', 'skipped', 'cancelled'])
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/
const localStoragePrefix = 'aura:pt-schedule:'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown, maximum = 4_000) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function timestampToIso(value: unknown) {
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  if (value instanceof Date) return value.toISOString()
  if (!isRecord(value)) return undefined
  const seconds = typeof value.seconds === 'number'
    ? value.seconds
    : typeof value._seconds === 'number'
      ? value._seconds
      : null
  if (seconds === null) return undefined
  const nanoseconds = typeof value.nanoseconds === 'number'
    ? value.nanoseconds
    : typeof value._nanoseconds === 'number'
      ? value._nanoseconds
      : 0
  return new Date(seconds * 1_000 + Math.floor(nanoseconds / 1_000_000)).toISOString()
}

function vietnamDateTime(value: unknown) {
  const iso = timestampToIso(value)
  if (!iso) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}

function parseWorkoutReference(value: unknown): PtScheduleWorkoutReference | undefined {
  if (!isRecord(value)) return undefined
  const programId = asString(value.programId, 200)
  const versionId = asString(value.versionId, 200)
  const sessionId = asString(value.sessionId, 200)
  return programId && versionId && sessionId ? { programId, versionId, sessionId } : undefined
}

export function parsePtScheduleEvent(value: unknown): PtScheduleEvent | null {
  if (!isRecord(value)) return null
  const id = asString(value.id ?? value.eventId, 200)
  const clientId = asString(value.clientId, 200)
  const derived = vietnamDateTime(value.startsAt)
  const date = asString(value.date, 10) || derived?.date || ''
  const time = asString(value.time, 5) || derived?.time || ''
  const title = asString(value.title, 160)
  const type = asString(value.type, 20) as PtScheduleEventType
  const status = asString(value.status, 20) as PtScheduleEventStatus
  if (!id || !clientId || !title || !isoDatePattern.test(date) || !timePattern.test(time)
      || !eventTypes.has(type) || !eventStatuses.has(status)) return null
  const rawDuration = typeof value.durationMinutes === 'number' ? value.durationMinutes : Number(value.durationMinutes)
  const durationMinutes = Number.isFinite(rawDuration)
    ? Math.min(240, Math.max(5, Math.round(rawDuration)))
    : 45
  return {
    id,
    clientId,
    coachId: asString(value.coachId, 200),
    date,
    time,
    durationMinutes,
    title,
    type,
    note: asString(value.note),
    status,
    timeZone: asString(value.timeZone, 80) || 'Asia/Ho_Chi_Minh',
    workoutRef: parseWorkoutReference(value.workoutRef),
    createdAt: timestampToIso(value.createdAt),
    updatedAt: timestampToIso(value.updatedAt),
    completedAt: timestampToIso(value.completedAt),
    cancelledAt: timestampToIso(value.cancelledAt),
    cancellationReason: asString(value.cancellationReason, 500) || undefined,
  }
}

function requireFunctions() {
  if (!firebaseFunctions) throw new Error('Lịch PT cloud chưa sẵn sàng. Hãy kiểm tra kết nối Firebase.')
  return firebaseFunctions
}

function parseEventResponse(value: unknown) {
  const data = isRecord(value) ? value : {}
  const event = parsePtScheduleEvent(data.event)
  if (!event) throw new Error('Phản hồi lịch PT từ máy chủ không hợp lệ.')
  return event
}

export function isPtScheduleCloudAvailable() {
  return Boolean(firebaseFunctions)
}

export function createPtScheduleEventId() {
  return globalThis.crypto?.randomUUID?.() ?? `schedule-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export async function listPtScheduleEvents(input: PtScheduleRangeInput): Promise<PtScheduleEvent[]> {
  const callable = httpsCallable<PtScheduleRangeInput, unknown>(requireFunctions(), 'listPtScheduleEvents')
  const response = await callable(input)
  const data = isRecord(response.data) ? response.data : {}
  const events = Array.isArray(data.events) ? data.events : []
  return events
    .map(parsePtScheduleEvent)
    .filter((event): event is PtScheduleEvent => Boolean(event))
    .sort((left, right) => `${left.date}${left.time}${left.id}`.localeCompare(`${right.date}${right.time}${right.id}`))
}

export async function savePtScheduleEvent(input: SavePtScheduleEventInput): Promise<PtScheduleEvent> {
  const callable = httpsCallable<SavePtScheduleEventInput, unknown>(requireFunctions(), 'savePtScheduleEvent')
  const response = await callable(input)
  return parseEventResponse(response.data)
}

export async function setPtScheduleEventStatus(input: SetPtScheduleEventStatusInput): Promise<PtScheduleEvent> {
  const callable = httpsCallable<SetPtScheduleEventStatusInput, unknown>(requireFunctions(), 'setPtScheduleEventStatus')
  const response = await callable(input)
  return parseEventResponse(response.data)
}

function localStorageKey(clientId: string) {
  return `${localStoragePrefix}${clientId}`
}

export function listLocalPtScheduleEvents(clientId: string): PtScheduleEvent[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(localStorageKey(clientId)) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((value) => parsePtScheduleEvent(isRecord(value) ? { ...value, clientId: value.clientId || clientId } : value))
      .filter((event): event is PtScheduleEvent => Boolean(event))
      .sort((left, right) => `${left.date}${left.time}${left.id}`.localeCompare(`${right.date}${right.time}${right.id}`))
  } catch {
    return []
  }
}

function writeLocalPtScheduleEvents(clientId: string, events: PtScheduleEvent[]) {
  try {
    window.localStorage.setItem(localStorageKey(clientId), JSON.stringify(events))
  } catch {
    // Demo mode remains usable in memory when browser storage is unavailable.
  }
}

export function saveLocalPtScheduleEvent(
  clientId: string,
  eventId: string,
  event: PtScheduleEventDraft,
  existing?: PtScheduleEvent,
) {
  const now = new Date().toISOString()
  const saved: PtScheduleEvent = {
    ...event,
    id: eventId,
    clientId,
    coachId: existing?.coachId ?? 'demo-coach',
    status: existing?.status ?? 'planned',
    timeZone: 'Asia/Ho_Chi_Minh',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  const events = listLocalPtScheduleEvents(clientId)
  writeLocalPtScheduleEvents(clientId, [saved, ...events.filter((item) => item.id !== eventId)])
  return saved
}

export function setLocalPtScheduleEventStatus(
  clientId: string,
  eventId: string,
  status: SetPtScheduleEventStatusInput['status'],
  cancellationReason?: string,
) {
  const events = listLocalPtScheduleEvents(clientId)
  const current = events.find((item) => item.id === eventId)
  if (!current) throw new Error('Không tìm thấy lịch PT trên thiết bị này.')
  const now = new Date().toISOString()
  const saved: PtScheduleEvent = {
    ...current,
    status,
    updatedAt: now,
    completedAt: status === 'done' ? now : current.completedAt,
    cancelledAt: status === 'cancelled' ? now : current.cancelledAt,
    cancellationReason: status === 'cancelled' ? cancellationReason?.trim() || undefined : current.cancellationReason,
  }
  writeLocalPtScheduleEvents(clientId, events.map((item) => item.id === eventId ? saved : item))
  return saved
}

export function removeLocalPtScheduleEvent(clientId: string, eventId: string) {
  writeLocalPtScheduleEvents(clientId, listLocalPtScheduleEvents(clientId).filter((item) => item.id !== eventId))
}
