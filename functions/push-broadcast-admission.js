'use strict'

const { HttpsError } = require('firebase-functions/v2/https')

// Transitional synchronous admission bounds, not supported audience totals.
// A sentinel rejects the entire send; no page or device is silently discarded.
const PUSH_ADMISSION_LIMITS = Object.freeze({ selected: 1000, allProfiles: 2000, directoryProfiles: 2500, deviceDocuments: 2000, deadlineMs: 45000 })
const failures = {
  SELECTED_AUDIENCE_LIMIT: 'Lượt gửi trực tiếp chỉ hỗ trợ tối đa 1.000 người nhận đã chọn. Chưa gửi thông báo nào. Hãy thu hẹp nhóm; nhóm lớn cần luồng gửi hàng đợi.',
  POPULATION_LIMIT: 'Chưa xác định đầy đủ toàn bộ học viên vì danh bạ vượt giới hạn kiểm tra của lượt gửi trực tiếp. Chưa gửi thông báo nào; cần luồng gửi hàng đợi cho toàn bộ hệ thống.',
  DIRECTORY_LIMIT: 'Danh bạ vượt 2.500 hồ sơ nên nhóm theo mục tiêu hoặc sở thích có thể chưa đầy đủ. Chưa gửi thông báo nào; cần chuẩn bị nhóm trên máy chủ trước khi gửi.',
  DEVICE_LIMIT: 'Số hồ sơ thiết bị vượt giới hạn kiểm tra của lượt gửi trực tiếp. Chưa gửi thông báo nào. Hãy thu hẹp nhóm hoặc dùng luồng gửi hàng đợi khi sẵn sàng.',
}
function assertPushAdmissionCount(count, maximum, reason) {
  if (count > maximum) throw new HttpsError('resource-exhausted', failures[reason], { reason, maximum, noDeliveryStarted: true })
}
function normalizePushRequestedIds(data) {
  const kind = data?.targetType
  if (kind !== undefined && !['all', 'selected', 'category', 'individual'].includes(kind)) throw new HttpsError('invalid-argument', 'Nhóm người nhận không hợp lệ.')
  // Existing all-member calls ignore the browser's local recipient list.
  if (kind === 'all') return []
  if (!Array.isArray(data?.targetUserIds) || !data.targetUserIds.length) throw new HttpsError('invalid-argument', 'Cần chọn ít nhất một người nhận.')
  const ids = new Set()
  for (const value of data.targetUserIds) {
    if (typeof value !== 'string' || !value.trim() || value.includes('/') || value.trim().length > 500) throw new HttpsError('invalid-argument', 'Mã người nhận không hợp lệ. Chưa gửi thông báo nào.')
    ids.add(value.trim())
    assertPushAdmissionCount(ids.size, PUSH_ADMISSION_LIMITS.selected, 'SELECTED_AUDIENCE_LIMIT')
  }
  return [...ids]
}
function createPushAdmissionBudget(now = Date.now) {
  const startedAt = now()
  return () => {
    if (now() - startedAt >= PUSH_ADMISSION_LIMITS.deadlineMs) throw new HttpsError('deadline-exceeded', 'Chưa kiểm tra xong người nhận và thiết bị trong thời gian cho phép. Chưa gửi thông báo nào; hãy thử lại với nhóm nhỏ hơn.', { reason: 'ADMISSION_TIMEOUT', noDeliveryStarted: true })
  }
}
async function preparePushDevices({ db, eligibleUserIds, checkBudget }) {
  const devices = []
  let scanned = 0
  for (let offset = 0; offset < eligibleUserIds.length; offset += 30) {
    checkBudget()
    const remaining = PUSH_ADMISSION_LIMITS.deviceDocuments - scanned
    let snapshot
    try {
      snapshot = await db.collectionGroup('devices').where('userId', 'in', eligibleUserIds.slice(offset, offset + 30))
        .select('token', 'enabled').limit(remaining + 1).get()
    } catch {
      throw new HttpsError('unavailable', 'Chưa kiểm tra đầy đủ thiết bị của nhóm. Chưa gửi thông báo nào; hãy thử lại sau.', { reason: 'DEVICE_LOOKUP_FAILED', noDeliveryStarted: true })
    }
    checkBudget()
    scanned += snapshot.docs.length
    assertPushAdmissionCount(scanned, PUSH_ADMISSION_LIMITS.deviceDocuments, 'DEVICE_LIMIT')
    for (const device of snapshot.docs) {
      const data = device.data()
      if (data.enabled !== false && typeof data.token === 'string' && data.token) devices.push({ token: data.token, reference: device.ref })
    }
  }
  checkBudget()
  return devices
}

module.exports = { PUSH_ADMISSION_LIMITS, assertPushAdmissionCount, normalizePushRequestedIds, createPushAdmissionBudget, preparePushDevices }
