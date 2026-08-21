import { doc, getDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions, firestoreDb } from '../lib/firebase'
import { provisionStudentAccount } from './identityAccessService'

export type PtCoachingStatus = 'active' | 'onboarding' | 'paused' | 'completed'

export interface PtClientProfile {
  clientId: string
  coachId: string
  goal: string
  coachingStatus: PtCoachingStatus
  currentProgramName: string
  currentProgramId: string
  currentVersionId: string
  activeAssignmentCycleId: string
  lastAssignmentCycleId: string
  readiness: number | null
  sleepHours: number | null
  soreness: number | null
  bodyWeightKg: number | null
  lastCheckInAt?: unknown
  nextCheckInDate: string
  coachNotes: string
}

export interface PtClientDirectoryRecord {
  clientId: string
  coachId: string
  displayName: string
  email: string
  membership: 'free' | 'pro' | 'coach'
  accountStatus: 'active' | 'disabled'
  coaching: PtClientProfile
}

export interface PublishedPtProgramOption {
  id: string
  title: string
  currentVersionId: string
  coachId: string
}

const LOCAL_STORAGE_KEY = 'aura:pt-client-profiles:v1'

function emptyProfile(clientId: string): PtClientProfile {
  return {
    clientId,
    coachId: '',
    goal: '',
    coachingStatus: 'onboarding',
    currentProgramName: '',
    currentProgramId: '',
    currentVersionId: '',
    activeAssignmentCycleId: '',
    lastAssignmentCycleId: '',
    readiness: null,
    sleepHours: null,
    soreness: null,
    bodyWeightKg: null,
    nextCheckInDate: '',
    coachNotes: '',
  }
}

function finiteNumber(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(maximum, Math.max(minimum, value))
}

function parseProfile(clientId: string, value: unknown): PtClientProfile {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const coachingStatus = ['active', 'onboarding', 'paused', 'completed'].includes(String(data.coachingStatus))
    ? data.coachingStatus as PtCoachingStatus
    : 'onboarding'
  return {
    ...emptyProfile(clientId),
    clientId,
    coachId: typeof data.coachId === 'string' ? data.coachId.slice(0, 200) : '',
    goal: typeof data.goal === 'string' ? data.goal.slice(0, 300) : '',
    coachingStatus,
    currentProgramName: typeof data.currentProgramName === 'string' ? data.currentProgramName.slice(0, 200) : '',
    currentProgramId: typeof data.currentProgramId === 'string' ? data.currentProgramId.slice(0, 200) : '',
    currentVersionId: typeof data.currentVersionId === 'string' ? data.currentVersionId.slice(0, 200) : '',
    activeAssignmentCycleId: typeof data.activeAssignmentCycleId === 'string' ? data.activeAssignmentCycleId.slice(0, 200) : '',
    lastAssignmentCycleId: typeof data.lastAssignmentCycleId === 'string' ? data.lastAssignmentCycleId.slice(0, 200) : '',
    readiness: finiteNumber(data.readiness, 1, 5),
    sleepHours: finiteNumber(data.sleepHours, 0, 24),
    soreness: finiteNumber(data.soreness, 1, 5),
    bodyWeightKg: finiteNumber(data.bodyWeightKg, 20, 500),
    lastCheckInAt: data.lastCheckInAt,
    nextCheckInDate: typeof data.nextCheckInDate === 'string' ? data.nextCheckInDate.slice(0, 10) : '',
    coachNotes: typeof data.coachNotes === 'string' ? data.coachNotes.slice(0, 4_000) : '',
  }
}

function readLocalProfiles() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_STORAGE_KEY) ?? '{}') as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function writeLocalProfile(profile: PtClientProfile) {
  try {
    const profiles = readLocalProfiles()
    profiles[profile.clientId] = { ...profile, lastCheckInAt: profile.lastCheckInAt ?? new Date().toISOString() }
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(profiles))
  } catch {
    // Demo mode remains usable in memory when storage is unavailable.
  }
}

export async function loadPtClientProfiles(clientIds: string[]) {
  const uniqueIds = [...new Set(clientIds.filter(Boolean))]
  if (!firestoreDb) {
    const local = readLocalProfiles()
    return Object.fromEntries(uniqueIds.map((clientId) => [clientId, parseProfile(clientId, local[clientId])]))
  }

  const snapshots = await Promise.all(uniqueIds.map((clientId) => getDoc(doc(firestoreDb!, 'coachClients', clientId))))
  return Object.fromEntries(snapshots.map((snapshot, index) => {
    const clientId = uniqueIds[index]
    return [clientId, parseProfile(clientId, snapshot.exists() ? snapshot.data() : undefined)]
  }))
}

/** Lists PT relationships without joining Academy enrollments or learning progress. */
export async function listPtClients(): Promise<PtClientDirectoryRecord[] | null> {
  if (!firebaseFunctions) return null
  const callable = httpsCallable<{ limit: number }, unknown>(firebaseFunctions, 'listPtClients')
  const response = await callable({ limit: 200 })
  const data = response.data && typeof response.data === 'object' ? response.data as Record<string, unknown> : {}
  const clients = Array.isArray(data.clients) ? data.clients : []
  return clients.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const client = value as Record<string, unknown>
    if (typeof client.clientId !== 'string' || !client.clientId) return []
    const profile = parseProfile(client.clientId, client)
    return [{
      clientId: client.clientId,
      coachId: profile.coachId,
      displayName: typeof client.displayName === 'string' && client.displayName.trim() ? client.displayName.trim() : 'Khách hàng Aura',
      email: typeof client.email === 'string' ? client.email : '',
      membership: client.membership === 'pro' || client.membership === 'coach' ? client.membership : 'free',
      accountStatus: client.accountStatus === 'disabled' ? 'disabled' as const : 'active' as const,
      coaching: profile,
    }]
  })
}

export async function savePtClientProfile(profile: PtClientProfile) {
  const normalized = parseProfile(profile.clientId, profile)
  if (!firebaseFunctions) {
    const localProfile = { ...normalized, lastCheckInAt: new Date().toISOString() }
    writeLocalProfile(localProfile)
    return localProfile
  }
  const callable = httpsCallable<{ profile: PtClientProfile }, unknown>(firebaseFunctions, 'savePtClientCoachingProfile')
  const response = await callable({ profile: normalized })
  const data = response.data && typeof response.data === 'object' ? response.data as Record<string, unknown> : {}
  return parseProfile(normalized.clientId, data.profile)
}

export async function onboardPtClientByEmail(email: string): Promise<PtClientDirectoryRecord> {
  if (!firebaseFunctions) throw new Error('Firebase PT Coaching chưa sẵn sàng.')
  const callable = httpsCallable<{ email: string }, unknown>(firebaseFunctions, 'onboardPtClientByEmail')
  const response = await callable({ email: email.trim().toLowerCase() })
  const data = response.data && typeof response.data === 'object' ? response.data as Record<string, unknown> : {}
  const user = data.user && typeof data.user === 'object' ? data.user as Record<string, unknown> : {}
  const clientId = typeof user.uid === 'string' ? user.uid : ''
  if (!clientId) throw new Error('Phản hồi tạo quan hệ PT không hợp lệ.')
  const coaching = parseProfile(clientId, data.profile)
  return {
    clientId,
    coachId: coaching.coachId,
    displayName: typeof user.displayName === 'string' ? user.displayName : 'Khách hàng Aura',
    email: typeof user.email === 'string' ? user.email : email.trim(),
    membership: 'free',
    accountStatus: 'active',
    coaching,
  }
}

export async function listPublishedPtPrograms(): Promise<PublishedPtProgramOption[]> {
  if (!firebaseFunctions) return []
  const callable = httpsCallable<Record<string, never>, unknown>(firebaseFunctions, 'listPublishedPtPrograms')
  const response = await callable({})
  const data = response.data && typeof response.data === 'object' ? response.data as Record<string, unknown> : {}
  if (!Array.isArray(data.programs)) return []
  return data.programs.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const program = value as Record<string, unknown>
    if (typeof program.id !== 'string' || typeof program.title !== 'string'
        || typeof program.currentVersionId !== 'string' || typeof program.coachId !== 'string') return []
    return [{
      id: program.id,
      title: program.title,
      currentVersionId: program.currentVersionId,
      coachId: program.coachId,
    }]
  })
}

export interface CreateStudentAccountInput {
  displayName: string
  phoneNumber: string
  email?: string
  goal?: string
}

export interface CreatedStudentAccountResult {
  uid: string
  displayName: string
  phoneNumber: string
  email: string
  goal: string
  passwordChangeRequired: boolean
}

export async function createStudentAccount(input: CreateStudentAccountInput): Promise<CreatedStudentAccountResult> {
  const phone = input.phoneNumber.trim().replace(/\s+/g, '')
  if (!phone) {
    throw new Error('Vui lòng nhập số điện thoại của học viên.')
  }

  const email = input.email?.trim().toLowerCase() || ''
  if (!email) {
    throw new Error('Cần email đăng nhập thật để tạo mật khẩu ban đầu bằng số điện thoại.')
  }
  const displayName = input.displayName.trim() || `Học viên ${phone}`
  const account = await provisionStudentAccount({
    displayName,
    phoneNumber: phone,
    email,
    goal: input.goal || '',
  })

  return {
    uid: account.uid,
    displayName,
    phoneNumber: phone,
    email,
    goal: input.goal || '',
    passwordChangeRequired: account.passwordChangeRequired,
  }
}

