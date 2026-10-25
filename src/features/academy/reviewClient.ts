import type { AcademyReviewState } from '../../services/academyLearningService'
import { createAcademySessionCache } from './sessionCache'
import { mergeAcademyReviewStates } from './reviewPersistence'

/** Cache remote history, not the merged result: local ratings can change at any time. */
export function createAcademyReviewClient(options: {
  session: () => (object & { uid: string }) | null
  readRemote: (ownerId: string, courseId: string) => Promise<AcademyReviewState>
  readLocal: (ownerId: string, courseId: string) => AcademyReviewState
  writeLocal: (ownerId: string, courseId: string, state: AcademyReviewState) => void
  now?: () => number
  ttlMs?: number
}) {
  const cache = createAcademySessionCache<{ cloud: AcademyReviewState; beforeRead: AcademyReviewState }>({ ttlMs: options.ttlMs ?? 5 * 60_000,
    maxEntries: 8, maxBytes: 4 * 1024 * 1024, now: options.now })
  const changedSession = () => Object.assign(new Error('Phiên học đã đổi. Hãy mở lại phần ghi nhớ.'), { code: 'functions/unauthenticated' })
  const load = async (ownerId: string, courseId: string) => {
    const owner = options.session()
    if (!owner || owner.uid !== ownerId) throw changedSession()
    cache.setScope(owner, ownerId)
    const { value: { cloud, beforeRead } } = await cache.read(courseId, async () => {
      if (options.session() !== owner) throw changedSession()
      const beforeRead = options.readLocal(ownerId, courseId)
      const state = await options.readRemote(ownerId, courseId)
      if (options.session() !== owner) throw changedSession()
      // Keep the query's original local baseline across cache hits. Otherwise a
      // server timestamp ahead of the device clock could undo an in-flight rating
      // on the next chapter, even though the first merge correctly preserved it.
      return { cloud: state, beforeRead }
    })
    if (options.session() !== owner) throw changedSession()
    const state = mergeAcademyReviewStates(options.readLocal(ownerId, courseId), cloud, beforeRead)
    options.writeLocal(ownerId, courseId, state)
    return state
  }
  return { load, clear: cache.clear }
}
