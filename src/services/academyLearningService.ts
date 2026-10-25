import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, setDoc, Timestamp, where } from 'firebase/firestore'
import { firebaseAuth } from '../lib/firebase'
import { onAuthStateChanged } from 'firebase/auth'
import { firestoreDb } from '../lib/firebaseFirestore'
import type { AcademyLessonMemory, CourseLessonDraft } from '../types'
import { acknowledgeAcademyWorkbook, AcademyWorkbookConflictError, prepareAcademyWorkbookDraft, reconcileAcademyWorkbook, serializeAcademyWorkbookForCloud } from '../features/academy/workbookPersistence'
import { createAcademyReviewClient } from '../features/academy/reviewClient'
export { AcademyWorkbookConflictError, AcademyWorkbookSizeError } from '../features/academy/workbookPersistence'

export interface AcademyTerm {
  id: string
  term: string
  definition: string
}

export interface AcademyRecallPrompt {
  id: string
  prompt: string
  answer: string
}

export interface AcademyFlashcard {
  id: string
  front: string
  back: string
  hint?: string
}

export interface AcademyLessonContent {
  minuteSummary: string
  keyTakeaways: string[]
  terms: AcademyTerm[]
  recallPrompts: AcademyRecallPrompt[]
  flashcards: AcademyFlashcard[]
}

export type AcademyWorkbookState = {
  schemaVersion: 2
  definitionVersion: number
  definitionHash?: string
  cloudRevision: number
  sharedWithCoach: boolean
  answers: Record<string, string>
  challengeDone: Record<string, boolean>
  microCheckAnswers: Record<string, number>
  confidenceBefore: 1 | 2 | 3 | 4 | 5 | null
  confidenceAfter: 1 | 2 | 3 | 4 | 5 | null
  rubric: Record<'data' | 'mechanism' | 'feasibility' | 'safety', 0 | 1 | 2>
  decision: 'keep' | 'adjust' | 'stop' | 'refer' | null
  reviewAt: string
  safetyAcknowledged: boolean
  updatedAt: number
  /** Device-only markers: absent on legacy drafts; never trusted as server proof. */
  pendingSync?: boolean
  localEditId?: string
  /** Explicit version changes retain the preceding draft separately. */
  previousArchiveId?: string
}

export type AcademyReviewRating = 'again' | 'hard' | 'good' | 'easy'

export interface AcademyCardProgress {
  lessonId: string
  cardId: string
  rating: AcademyReviewRating
  repetitions: number
  intervalDays: number
  reviewedAt: number
  dueAt: number
}

export interface AcademyReviewState {
  version: 1
  cards: Record<string, AcademyCardProgress>
}

const ACADEMY_BLOCK = /\n?\[\[AURA_ACADEMY_V1:([^\]]*)\]\]\s*$/

export const emptyAcademyLessonContent = (): AcademyLessonContent => ({
  minuteSummary: '',
  keyTakeaways: [],
  terms: [],
  recallPrompts: [],
  flashcards: [],
})

export function hasAcademyLessonContent(content: AcademyLessonContent) {
  return Boolean(
    content.minuteSummary.trim()
      || content.keyTakeaways.some(Boolean)
      || content.terms.some((term) => term.term || term.definition)
      || content.recallPrompts.some((recall) => recall.prompt || recall.answer)
      || content.flashcards.some((card) => card.front || card.back || card.hint),
  )
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function identifier(value: unknown, prefix: string, index: number) {
  return text(value) || `${prefix}-${index + 1}`
}

function normalizeAcademyContent(value: unknown): AcademyLessonContent {
  if (!value || typeof value !== 'object') return emptyAcademyLessonContent()
  const candidate = value as Record<string, unknown>
  const keyTakeaways = Array.isArray(candidate.keyTakeaways)
    ? candidate.keyTakeaways.map(text)
    : []
  const terms = Array.isArray(candidate.terms)
    ? candidate.terms.flatMap((item, index) => {
        if (!item || typeof item !== 'object') return []
        const term = text((item as Record<string, unknown>).term)
        const definition = text((item as Record<string, unknown>).definition)
        return [{ id: identifier((item as Record<string, unknown>).id, 'term', index), term, definition }]
      })
    : []
  const recallPrompts = Array.isArray(candidate.recallPrompts)
    ? candidate.recallPrompts.flatMap((item, index) => {
        if (!item || typeof item !== 'object') return []
        const prompt = text((item as Record<string, unknown>).prompt)
        const answer = text((item as Record<string, unknown>).answer)
        return [{ id: identifier((item as Record<string, unknown>).id, 'recall', index), prompt, answer }]
      })
    : []
  const flashcards = Array.isArray(candidate.flashcards)
    ? candidate.flashcards.flatMap((item, index) => {
        if (!item || typeof item !== 'object') return []
        const front = text((item as Record<string, unknown>).front)
        const back = text((item as Record<string, unknown>).back)
        const hint = text((item as Record<string, unknown>).hint)
        return [{ id: identifier((item as Record<string, unknown>).id, 'card', index), front, back, ...(hint ? { hint } : {}) }]
      })
    : []

  return {
    minuteSummary: text(candidate.minuteSummary),
    keyTakeaways,
    terms,
    recallPrompts,
    flashcards,
  }
}

function readEmbeddedContent(coachNotes: string | undefined) {
  const match = coachNotes?.match(ACADEMY_BLOCK)
  if (!match) return null
  try {
    return normalizeAcademyContent(JSON.parse(decodeURIComponent(match[1])))
  } catch {
    return null
  }
}

function contentFromMemory(memory: AcademyLessonMemory): AcademyLessonContent {
  return normalizeAcademyContent({
    minuteSummary: memory.recap,
    keyTakeaways: memory.takeaways,
    terms: memory.glossary,
    recallPrompts: memory.recallPrompts,
    flashcards: memory.flashcards,
  })
}

export function toAcademyLessonMemory(content: AcademyLessonContent): AcademyLessonMemory {
  const normalized = normalizeAcademyContent(content)
  return {
    ...(normalized.minuteSummary ? { recap: normalized.minuteSummary } : {}),
    takeaways: normalized.keyTakeaways,
    glossary: normalized.terms,
    recallPrompts: normalized.recallPrompts,
    flashcards: normalized.flashcards,
  }
}

/**
 * Reads both the current embedded contract and a future explicit academyContent
 * field, allowing the UI to migrate without breaking existing course documents.
 */
export function getAcademyLessonContent(lesson: CourseLessonDraft | undefined): AcademyLessonContent {
  if (!lesson) return emptyAcademyLessonContent()
  if (lesson.memory) return contentFromMemory(lesson.memory)
  const futureContent = (lesson as CourseLessonDraft & { academyContent?: unknown }).academyContent
  if (futureContent) return normalizeAcademyContent(futureContent)
  return readEmbeddedContent(lesson.coachNotes) ?? emptyAcademyLessonContent()
}

export function getAcademyCoachNote(lesson: CourseLessonDraft | undefined) {
  return (lesson?.coachNotes ?? '').replace(ACADEMY_BLOCK, '').trim()
}

export function serializeAcademyCoachNotes(coachNote: string, content: AcademyLessonContent) {
  const normalized = normalizeAcademyContent(content)
  const hasLearningContent = hasAcademyLessonContent(normalized)
  const cleanNote = coachNote.replace(ACADEMY_BLOCK, '').trim()
  if (!hasLearningContent) return cleanNote
  const payload = encodeURIComponent(JSON.stringify(normalized))
  return `${cleanNote}${cleanNote ? '\n\n' : ''}[[AURA_ACADEMY_V1:${payload}]]`
}

export function academyMaterialForLesson(
  lesson: CourseLessonDraft | undefined,
  courseOutcomes: string[] = [],
): AcademyLessonContent {
  const content = getAcademyLessonContent(lesson)
  const configuredTakeaways = content.keyTakeaways.filter(Boolean)
  const terms = content.terms.filter((term) => term.term && term.definition)
  const recallPrompts = content.recallPrompts.filter((recall) => recall.prompt && recall.answer)
  const fallbackTakeaways = lesson?.tags?.length
    ? lesson.tags.map((tag) => `Ghi nhớ chủ đề: ${tag}`)
    : courseOutcomes.slice(0, 4)
  const keyTakeaways = configuredTakeaways.length ? configuredTakeaways : fallbackTakeaways
  const configuredFlashcards = content.flashcards.filter((card) => card.front && card.back)
  const flashcards = configuredFlashcards.length
    ? configuredFlashcards
    : terms.map((term) => ({ id: `term-card-${term.id}`, front: term.term, back: term.definition }))

  return {
    ...content,
    minuteSummary: content.minuteSummary || lesson?.summary?.trim() || '',
    keyTakeaways,
    terms,
    recallPrompts,
    flashcards,
  }
}

function academyReviewStorageKey(ownerId: string, courseId: string) {
  return `aura:academy:review:v1:${ownerId || 'guest'}:${courseId}`
}

function academyRecallStorageKey(ownerId: string, courseId: string, lessonId: string) {
  return `aura:academy:recall:v1:${ownerId || 'guest'}:${courseId}:${lessonId}`
}

function academyWorkbookStorageKey(ownerId: string, courseId: string, lessonId: string) {
  return `aura:academy:workbook:v1:${ownerId || 'guest'}:${courseId}:${lessonId}`
}

function academyStateDocumentId(courseId: string, lessonId: string, itemId = '') {
  return [courseId, lessonId, itemId].filter(Boolean).map((value) => encodeURIComponent(value)).join('__')
}

function canSyncAcademyState(ownerId: string) {
  return Boolean(firestoreDb && firebaseAuth?.currentUser?.uid === ownerId)
}

export async function loadAcademyNoteFromCloud(ownerId: string, courseId: string, lessonId: string) {
  if (!canSyncAcademyState(ownerId) || !firestoreDb) return null
  const snapshot = await getDoc(doc(firestoreDb, 'users', ownerId, 'academyNotes', academyStateDocumentId(courseId, lessonId)))
  if (!snapshot.exists()) return null
  const body = snapshot.data().body
  return typeof body === 'string' ? body : null
}

export async function saveAcademyNoteToCloud(ownerId: string, courseId: string, lessonId: string, body: string) {
  if (!canSyncAcademyState(ownerId) || !firestoreDb) return
  const reference = doc(firestoreDb, 'users', ownerId, 'academyNotes', academyStateDocumentId(courseId, lessonId))
  const existing = await getDoc(reference)
  await setDoc(reference, {
    courseId,
    lessonId,
    body: body.slice(0, 20_000),
    ...(existing.exists() ? { createdAt: existing.data().createdAt } : { createdAt: serverTimestamp() }),
    updatedAt: serverTimestamp(),
  })
}

export function emptyAcademyWorkbookState(): AcademyWorkbookState {
  return {
    schemaVersion: 2,
    definitionVersion: 1,
    cloudRevision: 0,
    sharedWithCoach: false,
    answers: {},
    challengeDone: {},
    microCheckAnswers: {},
    confidenceBefore: null,
    confidenceAfter: null,
    rubric: { data: 0, mechanism: 0, feasibility: 0, safety: 0 },
    decision: null,
    reviewAt: '',
    safetyAcknowledged: false,
    updatedAt: 0,
  }
}

function normalizeWorkbookState(value: Partial<AcademyWorkbookState> | null | undefined): AcademyWorkbookState {
  const fallback = emptyAcademyWorkbookState()
  const answers = value?.answers && typeof value.answers === 'object'
    ? Object.fromEntries(Object.entries(value.answers).filter((entry): entry is [string, string] => typeof entry[1] === 'string').slice(0, 30))
    : {}
  const challengeDone = value?.challengeDone && typeof value.challengeDone === 'object'
    ? Object.fromEntries(Object.entries(value.challengeDone).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean').slice(0, 20))
    : {}
  const microCheckAnswers = value?.microCheckAnswers && typeof value.microCheckAnswers === 'object'
    ? Object.fromEntries(Object.entries(value.microCheckAnswers).filter((entry): entry is [string, number] => Number.isInteger(entry[1]) && entry[1] >= 0 && entry[1] <= 9).slice(0, 20))
    : {}
  const confidence = (candidate: unknown) => Number.isInteger(candidate) && Number(candidate) >= 1 && Number(candidate) <= 5
    ? candidate as 1 | 2 | 3 | 4 | 5
    : null
  const rubricValue = (candidate: unknown): 0 | 1 | 2 => candidate === 1 || candidate === 2 ? candidate : 0
  const decision = ['keep', 'adjust', 'stop', 'refer'].includes(String(value?.decision))
    ? value?.decision as AcademyWorkbookState['decision']
    : null
  return {
    ...fallback,
    definitionVersion: Number.isInteger(value?.definitionVersion) && Number(value?.definitionVersion) >= 1
      ? Number(value?.definitionVersion)
      : 1,
    ...(typeof value?.definitionHash === 'string' && /^[a-f0-9]{64}$/.test(value.definitionHash) ? { definitionHash: value.definitionHash } : {}),
    cloudRevision: Number.isInteger(value?.cloudRevision) && Number(value?.cloudRevision) >= 0
      ? Number(value?.cloudRevision)
      : 0,
    sharedWithCoach: value?.sharedWithCoach === true,
    answers,
    challengeDone,
    microCheckAnswers,
    confidenceBefore: confidence(value?.confidenceBefore),
    confidenceAfter: confidence(value?.confidenceAfter),
    rubric: {
      data: rubricValue(value?.rubric?.data),
      mechanism: rubricValue(value?.rubric?.mechanism),
      feasibility: rubricValue(value?.rubric?.feasibility),
      safety: rubricValue(value?.rubric?.safety),
    },
    decision,
    reviewAt: typeof value?.reviewAt === 'string' ? value.reviewAt.slice(0, 10) : '',
    safetyAcknowledged: value?.safetyAcknowledged === true,
    updatedAt: typeof value?.updatedAt === 'number' ? value.updatedAt : 0,
    ...(typeof value?.pendingSync === 'boolean' ? { pendingSync: value.pendingSync } : {}),
    ...(typeof value?.localEditId === 'string' ? { localEditId: value.localEditId } : {}),
    ...(typeof value?.previousArchiveId === 'string' && /^[A-Za-z0-9_%.-]{1,1000}$/.test(value.previousArchiveId)
      ? { previousArchiveId: value.previousArchiveId } : {}),
  }
}

export function loadAcademyWorkbook(ownerId: string, courseId: string, lessonId: string, definitionVersion = 1, definitionHash?: string): AcademyWorkbookState {
  const empty = () => ({ ...emptyAcademyWorkbookState(), definitionVersion, ...(definitionHash ? { definitionHash } : {}) })
  try {
    const raw = localStorage.getItem(academyWorkbookStorageKey(ownerId, courseId, lessonId))
    if (!raw) return empty()
    return normalizeWorkbookState(JSON.parse(raw) as Partial<AcademyWorkbookState>)
  } catch {
    return empty()
  }
}

function writeAcademyWorkbookToDevice(ownerId: string, courseId: string, lessonId: string, state: AcademyWorkbookState) {
  try {
    localStorage.setItem(academyWorkbookStorageKey(ownerId, courseId, lessonId), JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

const reviewClient = createAcademyReviewClient({
  session: () => firebaseAuth?.currentUser ?? null,
  readRemote: readAcademyReviewStateFromCloud,
  readLocal: loadAcademyReviewState,
  writeLocal: writeAcademyReviewStateToDevice,
})
let reviewCacheOwner = firebaseAuth?.currentUser ?? null
if (firebaseAuth) onAuthStateChanged(firebaseAuth, (next) => {
  if (reviewCacheOwner !== next) { reviewCacheOwner = next; reviewClient.clear() }
})

/** Synchronous, called directly on input before any debounce or navigation. */
export function persistAcademyWorkbookDraft(ownerId: string, courseId: string, lessonId: string, state: AcademyWorkbookState) {
  const bounded = prepareAcademyWorkbookDraft({
    ...normalizeWorkbookState(state),
    answers: Object.fromEntries(Object.entries(state.answers).slice(0, 30).map(([key, value]) => [key, value.slice(0, 2000)])),
    challengeDone: Object.fromEntries(Object.entries(state.challengeDone).slice(0, 20)),
    microCheckAnswers: Object.fromEntries(Object.entries(state.microCheckAnswers).slice(0, 20)),
  }, Date.now(), globalThis.crypto.randomUUID())
  const stored = writeAcademyWorkbookToDevice(ownerId, courseId, lessonId, bounded)
  return { state: bounded, stored }
}

/** Called only after explicit confirmation; a failed backup must leave the old draft intact. */
export function beginAcademyWorkbookDefinition(ownerId: string, courseId: string, lessonId: string, current: AcademyWorkbookState, definitionVersion: number, definitionHash?: string) {
  if (!Number.isSafeInteger(definitionVersion) || definitionVersion < 1
      || (definitionVersion === current.definitionVersion && definitionHash === current.definitionHash)
      || (definitionHash !== undefined && !/^[a-f0-9]{64}$/.test(definitionHash))) {
    throw new Error('Phiên bản bài thực hành không hợp lệ.')
  }
  const previousArchiveId = current.cloudRevision > 0
    ? `${academyStateDocumentId(courseId, lessonId)}__r${current.cloudRevision}`
    : `local-${globalThis.crypto.randomUUID()}`
  try {
    localStorage.setItem(`${academyWorkbookStorageKey(ownerId, courseId, lessonId)}:archive:${previousArchiveId}`, JSON.stringify(current))
  } catch {
    throw new Error('Chưa giữ được bản nháp cũ. Hãy sao chép bài trước khi bắt đầu phiên bản mới.')
  }
  const result = persistAcademyWorkbookDraft(ownerId, courseId, lessonId, {
    ...emptyAcademyWorkbookState(), definitionVersion, ...(definitionHash ? { definitionHash } : {}), cloudRevision: current.cloudRevision, previousArchiveId,
  })
  if (!result.stored) throw new Error('Chưa lưu được bản mới trên thiết bị. Bản cũ vẫn được giữ để khôi phục.')
  return result.state
}

/** No history scan on page load: read one known preceding draft only on request. */
export async function loadAcademyWorkbookArchive(ownerId: string, courseId: string, lessonId: string, archiveId: string) {
  if (!/^[A-Za-z0-9_%.-]{1,1000}$/.test(archiveId)) throw new Error('Mã bản nháp cũ không hợp lệ.')
  const local = localStorage.getItem(`${academyWorkbookStorageKey(ownerId, courseId, lessonId)}:archive:${archiveId}`)
  if (local) return normalizeWorkbookState(JSON.parse(local))
  if (!canSyncAcademyState(ownerId) || !firestoreDb) throw new Error('Cần kết nối và đúng tài khoản để tải bản nháp cũ.')
  const snapshot = await getDoc(doc(firestoreDb, 'users', ownerId, 'academyWorkbookArchives', archiveId))
  if (!canSyncAcademyState(ownerId)) throw new Error('Phiên đăng nhập đã thay đổi.')
  const source = snapshot.data()?.source
  if (!snapshot.exists() || source?.courseId !== courseId || source?.lessonId !== lessonId || typeof source.body !== 'string') {
    throw new Error('Không tìm thấy bản nháp cũ của bài học này.')
  }
  return { ...normalizeWorkbookState(JSON.parse(source.body)), cloudRevision: source.revision }
}

export async function saveAcademyWorkbook(ownerId: string, courseId: string, lessonId: string, state: AcademyWorkbookState) {
  const synchronized = await saveAcademyWorkbookToCloud(ownerId, courseId, lessonId, state)
  // Read again after the network request: the learner may have kept typing or left this chapter.
  const current = loadAcademyWorkbook(ownerId, courseId, lessonId)
  const merged = current.updatedAt > 0 ? acknowledgeAcademyWorkbook(current, state, synchronized) : synchronized
  writeAcademyWorkbookToDevice(ownerId, courseId, lessonId, merged)
  return synchronized
}

export async function loadAcademyWorkbookFromCloud(
  ownerId: string,
  courseId: string,
  lessonId: string,
  options: { preferRemote?: boolean; definitionVersion?: number; definitionHash?: string; isCurrent?: () => boolean } = {},
) {
  if (!canSyncAcademyState(ownerId) || !firestoreDb) return loadAcademyWorkbook(ownerId, courseId, lessonId, options.definitionVersion, options.definitionHash)
  const snapshot = await getDoc(doc(firestoreDb, 'users', ownerId, 'academyWorkbooks', academyStateDocumentId(courseId, lessonId)))
  const localState = loadAcademyWorkbook(ownerId, courseId, lessonId, options.definitionVersion, options.definitionHash)
  if (!canSyncAcademyState(ownerId) || options.isCurrent?.() === false) return localState
  if (!snapshot.exists()) return localState.updatedAt > 0 ? { ...localState, pendingSync: true } : localState
  const body = snapshot.data().body
  if (typeof body !== 'string') return localState
  let parsedRemote: AcademyWorkbookState
  try {
    const documentRevision = Number.isInteger(snapshot.data().revision) && snapshot.data().revision >= 0
      ? Number(snapshot.data().revision)
      : 0
    parsedRemote = { ...normalizeWorkbookState(JSON.parse(body) as Partial<AcademyWorkbookState>), cloudRevision: documentRevision }
  } catch {
    return localState
  }
  const reconciled = reconcileAcademyWorkbook(localState, parsedRemote, options.preferRemote)
  if (options.preferRemote && localState.pendingSync) {
    // Keep the displaced device draft recoverable when the learner chooses the cloud version.
    try {
      localStorage.setItem(`${academyWorkbookStorageKey(ownerId, courseId, lessonId)}:recovery`, JSON.stringify(localState))
    } catch {
      throw new Error('Không thể giữ bản nháp dự phòng. Hãy sao chép nội dung trước khi tải bản Cloud.')
    }
  }
  writeAcademyWorkbookToDevice(ownerId, courseId, lessonId, reconciled)
  return reconciled
}

async function saveAcademyWorkbookToCloud(ownerId: string, courseId: string, lessonId: string, state: AcademyWorkbookState) {
  if (!canSyncAcademyState(ownerId) || !firestoreDb) throw new Error('Chưa có phiên đồng bộ được xác thực. Bản nháp chỉ được giữ trên thiết bị.')
  const reference = doc(firestoreDb, 'users', ownerId, 'academyWorkbooks', academyStateDocumentId(courseId, lessonId))
  return runTransaction(firestoreDb, async (transaction) => {
    const existing = await transaction.get(reference)
    const remoteRevision = existing.exists() && Number.isInteger(existing.data().revision)
      ? Number(existing.data().revision)
      : 0
    if (remoteRevision !== state.cloudRevision) throw new AcademyWorkbookConflictError(remoteRevision)
    let previousArchiveId = state.previousArchiveId
    if (existing.exists()) {
      let previous: AcademyWorkbookState
      try { previous = normalizeWorkbookState(JSON.parse(existing.data().body)) } catch {
        throw new Error('Bản Cloud hiện tại không đọc được. Không ghi đè khi chưa giữ được bản cũ.')
      }
      if (previous.definitionVersion !== state.definitionVersion || previous.definitionHash !== state.definitionHash) {
        // Archive the actual transaction snapshot, not the client's copy. Both
        // the backup and replacement commit together, or neither is changed.
        previousArchiveId = `${academyStateDocumentId(courseId, lessonId)}__r${remoteRevision}`
        transaction.set(doc(firestoreDb!, 'users', ownerId, 'academyWorkbookArchives', previousArchiveId), {
          sourceWorkbookId: reference.id, source: existing.data(), archivedAt: serverTimestamp(),
        })
      }
    }
    const synchronized = {
      ...state,
      cloudRevision: remoteRevision + 1,
      pendingSync: false,
      ...(previousArchiveId ? { previousArchiveId } : {}),
    }
    transaction.set(reference, {
      courseId,
      lessonId,
      revision: synchronized.cloudRevision,
      sharedWithCoach: synchronized.sharedWithCoach,
      body: serializeAcademyWorkbookForCloud(synchronized),
      ...(existing.exists() ? { createdAt: existing.data().createdAt } : { createdAt: serverTimestamp() }),
      updatedAt: serverTimestamp(),
    })
    return synchronized
  })
}

export function loadAcademyRecallAnswers(ownerId: string, courseId: string, lessonId: string) {
  try {
    const value = JSON.parse(localStorage.getItem(academyRecallStorageKey(ownerId, courseId, lessonId)) ?? '{}')
    if (!value || typeof value !== 'object') return {}
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  } catch {
    return {}
  }
}

export function saveAcademyRecallAnswers(ownerId: string, courseId: string, lessonId: string, answers: Record<string, string>) {
  try {
    localStorage.setItem(academyRecallStorageKey(ownerId, courseId, lessonId), JSON.stringify(answers))
  } catch {
    // Recall drafts stay available for the current session when storage is unavailable.
  }
}

export function loadAcademyReviewState(ownerId: string, courseId: string): AcademyReviewState {
  const fallback: AcademyReviewState = { version: 1, cards: {} }
  try {
    const raw = localStorage.getItem(academyReviewStorageKey(ownerId, courseId))
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<AcademyReviewState>
    return parsed.version === 1 && parsed.cards && typeof parsed.cards === 'object'
      ? { version: 1, cards: parsed.cards }
      : fallback
  } catch {
    return fallback
  }
}

function writeAcademyReviewStateToDevice(ownerId: string, courseId: string, state: AcademyReviewState) {
  try {
    localStorage.setItem(academyReviewStorageKey(ownerId, courseId), JSON.stringify(state))
  } catch {
    // Cloud sync can still keep the review state when device storage is unavailable.
  }
}

export async function loadAcademyReviewStateFromCloud(ownerId: string, courseId: string) {
  if (!canSyncAcademyState(ownerId) || !firestoreDb) {
    reviewClient.clear()
    return loadAcademyReviewState(ownerId, courseId)
  }
  return reviewClient.load(ownerId, courseId)
}

async function readAcademyReviewStateFromCloud(ownerId: string, courseId: string): Promise<AcademyReviewState> {
  if (!firestoreDb) throw new Error('Chưa kết nối được lịch ôn trên cloud.')
  const snapshot = await getDocs(query(
    collection(firestoreDb, 'users', ownerId, 'academyReviewItems'),
    where('courseId', '==', courseId),
  ))
  const cards: AcademyReviewState['cards'] = {}
  snapshot.docs.forEach((reviewDocument) => {
    const data = reviewDocument.data()
    if (typeof data.lessonId !== 'string' || typeof data.cardId !== 'string') return
    const dueAt = data.dueAt instanceof Timestamp ? data.dueAt.toMillis() : 0
    const reviewedAt = data.updatedAt instanceof Timestamp ? data.updatedAt.toMillis() : 0
    const rating: AcademyReviewRating = data.state === 'learning'
      ? 'hard'
      : data.state === 'mastered'
        ? 'easy'
        : 'good'
    cards[`${data.lessonId}:${data.cardId}`] = {
      lessonId: data.lessonId,
      cardId: data.cardId,
      rating,
      repetitions: typeof data.repetitions === 'number' ? data.repetitions : 0,
      intervalDays: typeof data.intervalDays === 'number' ? data.intervalDays : 0,
      reviewedAt,
      dueAt,
    }
  })
  return { version: 1, cards }
}

async function saveAcademyReviewToCloud(ownerId: string, courseId: string, progress: AcademyCardProgress) {
  if (!canSyncAcademyState(ownerId) || !firestoreDb) return
  const reference = doc(
    firestoreDb,
    'users',
    ownerId,
    'academyReviewItems',
    academyStateDocumentId(courseId, progress.lessonId, progress.cardId),
  )
  const existing = await getDoc(reference)
  const state = progress.rating === 'again' || progress.rating === 'hard'
    ? 'learning'
    : progress.rating === 'easy' && progress.repetitions >= 3
      ? 'mastered'
      : 'review'
  const easeFactor = progress.rating === 'hard' ? 1.8 : progress.rating === 'easy' ? 2.8 : 2.5
  await setDoc(reference, {
    courseId,
    lessonId: progress.lessonId,
    cardId: progress.cardId,
    state,
    dueAt: Timestamp.fromMillis(progress.dueAt),
    intervalDays: progress.intervalDays,
    easeFactor,
    repetitions: progress.repetitions,
    ...(existing.exists() ? { createdAt: existing.data().createdAt } : { createdAt: serverTimestamp() }),
    updatedAt: serverTimestamp(),
  })
}

function nextInterval(previous: AcademyCardProgress | undefined, rating: AcademyReviewRating) {
  if (rating === 'again') return { intervalDays: 0, repetitions: 0, delayMs: 10 * 60 * 1000 }
  const repetitions = (previous?.repetitions ?? 0) + 1
  const current = Math.max(1, previous?.intervalDays ?? 1)
  const intervalDays = rating === 'hard'
    ? Math.max(1, Math.round(current * 1.35))
    : rating === 'easy'
      ? Math.min(60, repetitions === 1 ? 3 : Math.round(current * 2.6))
      : Math.min(45, repetitions === 1 ? 1 : Math.round(current * 2))
  return { intervalDays, repetitions, delayMs: intervalDays * 24 * 60 * 60 * 1000 }
}

export function reviewAcademyCard(input: {
  ownerId: string
  courseId: string
  lessonId: string
  cardId: string
  rating: AcademyReviewRating
}) {
  const state = loadAcademyReviewState(input.ownerId, input.courseId)
  const key = `${input.lessonId}:${input.cardId}`
  const reviewedAt = Date.now()
  const schedule = nextInterval(state.cards[key], input.rating)
  const progress: AcademyCardProgress = {
    lessonId: input.lessonId,
    cardId: input.cardId,
    rating: input.rating,
    repetitions: schedule.repetitions,
    intervalDays: schedule.intervalDays,
    reviewedAt,
    dueAt: reviewedAt + schedule.delayMs,
  }
  const nextState: AcademyReviewState = { version: 1, cards: { ...state.cards, [key]: progress } }
  writeAcademyReviewStateToDevice(input.ownerId, input.courseId, nextState)
  void saveAcademyReviewToCloud(input.ownerId, input.courseId, progress).catch(() => undefined)
  return nextState
}
