import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, where } from 'firebase/firestore'
import { firebaseAuth } from '../lib/firebase'
import { firestoreDb } from '../lib/firebaseFirestore'
import type { AcademyLessonMemory, CourseLessonDraft } from '../types'

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
  const localState = loadAcademyReviewState(ownerId, courseId)
  if (!canSyncAcademyState(ownerId) || !firestoreDb) return localState
  const snapshot = await getDocs(query(
    collection(firestoreDb, 'users', ownerId, 'academyReviewItems'),
    where('courseId', '==', courseId),
  ))
  const cards = { ...localState.cards }
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
  const state: AcademyReviewState = { version: 1, cards }
  writeAcademyReviewStateToDevice(ownerId, courseId, state)
  return state
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
