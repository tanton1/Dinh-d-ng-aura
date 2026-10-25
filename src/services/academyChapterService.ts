import { firebaseAuth } from '../lib/firebase'
import { onAuthStateChanged } from 'firebase/auth'
import { createAcademyChapterClient } from '../features/academy/chapterClient'
import { callAcademyReadFunction } from './academyReadService'
export { ACADEMY_CHAPTER_CACHE_TTL } from '../features/academy/chapterClient'
const client = createAcademyChapterClient({ session: () => firebaseAuth?.currentUser ?? null,
  read: (payload, accessRevision) => callAcademyReadFunction('listAcademyCourses', payload, accessRevision) })
let observedOwner = firebaseAuth?.currentUser ?? null
if (firebaseAuth) onAuthStateChanged(firebaseAuth, (next) => {
  if (next !== observedOwner) { observedOwner = next; client.clear() }
})
export const clearAcademyChapterCache = client.clear
export const peekAcademyChapter = client.peek
export const loadAcademyChapter = client.load
