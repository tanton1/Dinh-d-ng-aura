import { collection, documentId, getDocsFromServer, limit, orderBy, query, startAfter, type QueryDocumentSnapshot } from 'firebase/firestore'
import { firebaseAuth } from '../lib/firebase'
import { firestoreDb } from '../lib/firebaseFirestore'
import type { PushBroadcastLog } from '../types'

/** In-memory cursor: never persist another session's private history. */
export interface PushBroadcastCursor {
  owner: object
  snapshot: QueryDocumentSnapshot
}
export interface PushBroadcastPage {
  items: PushBroadcastLog[]
  hasMore: boolean
  nextCursor: PushBroadcastCursor | null
}

export async function getPushBroadcastLogsPage(input: { cursor?: PushBroadcastCursor | null; pageSize?: number } = {}): Promise<PushBroadcastPage> {
  const pageSize = input.pageSize ?? 25
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new Error('Kích thước trang lịch sử không hợp lệ.')
  if (!firestoreDb) {
    if (import.meta.env.VITE_FORCE_DEMO === 'true' || import.meta.env.MODE === 'e2e') return { items: [], hasMore: false, nextCursor: null }
    throw new Error('Dịch vụ lịch sử Push chưa sẵn sàng.')
  }
  const owner = firebaseAuth?.currentUser
  if (!owner || (input.cursor && input.cursor.owner !== owner)) throw new Error('Phiên đăng nhập đã thay đổi. Hãy tải lại lịch sử.')
  const source = query(collection(firestoreDb, 'system', 'push_broadcast_logs', 'logs'),
    orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc'),
    ...(input.cursor ? [startAfter(input.cursor.snapshot)] : []), limit(pageSize + 1))
  const snapshot = await getDocsFromServer(source)
  if (firebaseAuth?.currentUser !== owner) throw new Error('Phiên đăng nhập đã thay đổi. Hãy tải lại lịch sử.')
  const documents = snapshot.docs.slice(0, pageSize)
  const hasMore = snapshot.docs.length > pageSize
  return {
    items: documents.map(document => ({ ...document.data(), id: document.id } as PushBroadcastLog)),
    hasMore,
    nextCursor: hasMore ? { owner, snapshot: documents[documents.length - 1] } : null,
  }
}
