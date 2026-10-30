import type { AdminPushBroadcastParams } from './notificationService'
import type { PushComposerDraft } from '../pages/admin/push/pushTypes'

export interface PendingPushIntent {
  version: 1
  actorId: string
  requestId: string
  payload: AdminPushBroadcastParams
  draft: PushComposerDraft
}
const key = (actorId: string) => `aura:push-intent:v1:${actorId}`

export function readPushIntent(storage: Pick<Storage, 'getItem'>, actorId: string): PendingPushIntent | null {
  try {
    const item = JSON.parse(storage.getItem(key(actorId)) || 'null') as PendingPushIntent | null
    return item?.version === 1 && item.actorId === actorId && /^[A-Za-z0-9_-]{8,120}$/.test(item.requestId)
      && item.payload?.requestId === item.requestId && typeof item.payload.title === 'string'
      && typeof item.payload.message === 'string' && Array.isArray(item.payload.targetUserIds)
      && item.draft && typeof item.draft.title === 'string' ? item : null
  } catch { return null }
}
export function savePushIntent(storage: Pick<Storage, 'setItem' | 'getItem'>, intent: PendingPushIntent) {
  // Save the stable ID and frozen payload BEFORE dispatch. Refuse to send if
  // this browser cannot retain the recovery intent across a page reload.
  const value = JSON.stringify(intent)
  try {
    storage.setItem(key(intent.actorId), value)
    if (storage.getItem(key(intent.actorId)) !== value) throw new Error('storage unavailable')
  } catch { throw new Error('Chưa lưu được mã lượt gửi trong trình duyệt. Chưa gửi thông báo nào; hãy cho phép lưu phiên rồi thử lại.') }
}
export function clearPushIntent(storage: Pick<Storage, 'removeItem'>, actorId: string) {
  try { storage.removeItem(key(actorId)) } catch { /* A retained completed ID safely replays on reload. */ }
}
