'use strict'

const { createHash } = require('node:crypto')
const { HttpsError } = require('firebase-functions/v2/https')

// Cursors never grant access: every page rebuilds its queries from freshly
// authorized scope. Bind the continuation to that scope and all list filters.
function reviewPage(actor, filters, cursor, requestedSize, defaultSize = 50) {
  const scope = createHash('sha256').update(JSON.stringify([
    actor.uid, actor.accessRole, actor.authzVersion,
    [...(actor.branchIds || [])].sort(), [...(actor.capabilities || [])].sort(), filters,
  ])).digest('hex')
  const pageSize = Math.min(100, Math.max(1, Number.isInteger(requestedSize) ? requestedSize : defaultSize))
  let after = null
  if (cursor !== undefined && cursor !== null && cursor !== '') {
    try {
      if (typeof cursor !== 'string' || cursor.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error()
      const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
      if (value.v !== 1 || value.scope !== scope || !Array.isArray(value.after) || value.after.length < 1 || value.after.length > 2
        || value.after.some(item => typeof item !== 'string' || !item || Buffer.byteLength(item, 'utf8') > 1500 || item.includes('/'))) throw new Error()
      after = value.after
    } catch {
      throw new HttpsError('invalid-argument', 'Trang dữ liệu không còn phù hợp với bộ lọc hoặc quyền hiện tại. Hãy tải lại.')
    }
  }
  return { pageSize, after, next: position => Buffer.from(JSON.stringify({ v: 1, scope, after: position })).toString('base64url') }
}

function authorizedBranches(actor, requestedBranch = '') {
  const unrestricted = ['admin', 'super_admin'].includes(actor.accessRole)
  const branches = [...new Set((actor.branchIds || []).filter(Boolean))].sort()
  if (requestedBranch && !unrestricted && !branches.includes(requestedBranch)) {
    throw new HttpsError('permission-denied', 'Bạn không có quyền xem chi nhánh này.')
  }
  if (requestedBranch) return [requestedBranch]
  if (unrestricted) return null
  if (!branches.length) throw new HttpsError('permission-denied', 'Tài khoản chưa được phân quyền chi nhánh.')
  return branches
}

module.exports = { reviewPage, authorizedBranches }
