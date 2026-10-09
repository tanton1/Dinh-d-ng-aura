'use strict'

const { randomUUID } = require('node:crypto')
const { isDeepStrictEqual } = require('node:util')
const { Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')

// Auth and Firestore cannot share a transaction. Serialize the public identity
// commands so a failed restore cannot roll back a different successful one.
async function withIdentityMutation(db, uid, operation, work, { now = Date.now } = {}) {
  const ref = db.doc(`systemJobs/identityAccessMutations/subjects/${uid}`)
  const token = randomUUID()
  await db.runTransaction(async (tx) => {
    const current = await tx.get(ref)
    if (current.data()?.leaseUntil?.toMillis?.() > now()) {
      throw new HttpsError('aborted', 'Tài khoản đang có thao tác quyền truy cập khác. Hãy đợi hoàn tất rồi tải lại danh sách.')
    }
    tx.set(ref, { token, operation, leaseUntil: Timestamp.fromMillis(now() + 180_000) })
  })
  try {
    return await work()
  } finally {
    // Never replace the original failure with a cleanup error. An expired
    // lease is recoverable; releasing another command's lease is not.
    await db.runTransaction(async (tx) => {
      const current = await tx.get(ref)
      if (current.data()?.token === token) tx.set(ref, { token: null, leaseUntil: null }, { merge: true })
    }).catch(() => {})
  }
}

function identityFingerprint(value = {}) {
  return [value.accessRole ?? null, value.role ?? null, value.authzVersion ?? 0,
    value.status ?? null, value.disabled === true, value.positions ?? [], value.branchIds ?? []]
}

function assertAccessUnchanged(before, current) {
  if (!isDeepStrictEqual(identityFingerprint(before), identityFingerprint(current))) {
    throw new HttpsError('aborted', 'Quyền tài khoản vừa thay đổi. Hãy tải lại danh sách trước khi tiếp tục.')
  }
}

function assertElevatedAccess(actor, ...sources) {
  if (actor.accessRole !== 'super_admin' && sources.some((value) =>
    ['admin', 'super_admin'].includes(value?.accessRole) || ['admin', 'super_admin'].includes(value?.role))) {
    throw new HttpsError('permission-denied', 'Chỉ Super Admin được thay đổi quyền truy cập của tài khoản quản trị.')
  }
}

module.exports = { withIdentityMutation, assertAccessUnchanged, assertElevatedAccess }
