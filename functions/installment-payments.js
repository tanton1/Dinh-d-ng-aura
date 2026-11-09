'use strict'

const { FieldPath, FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const { studentActor, studentProfileForActor } = require('./pt-operations-v2')
const {
  PAYMENT_CLAIM_COLLECTION,
  OUTSTANDING_TARGET,
  TransferProfileError,
  amountIssueMessage,
  claimAmountIssue,
  dayDistance,
  formatVnd,
  installmentPaymentTarget,
  normalizeTransferProfile,
  paymentActionUrl,
  paymentClaimId,
  proofMetadataIssue,
  proofPathValid,
  studentClaimState,
  targetErrorMessage,
  transferCode,
  transferContent,
  usableTransferProfile,
  vietnamDateKey,
  vietQrPayload,
} = require('./installment-payment-core')
const { paymentClaimReceivedNotification } = require('./student-reminders')

const CLAIM_PAGE_SIZE = 20
const MAX_CLAIM_REVISIONS = 30
const MAX_PROOF_UPLOADS = 10
const PROOF_URL_MINUTES = 30
const CONTRACT_FIELDS = ['studentId', 'crmProfileId', 'branchId', 'packageName', 'totalPrice', 'discount', 'paidAmount', 'status', 'installments', 'nextPaymentDate']

function id(value, label, maximum = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || value.includes('/')) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return value.trim()
}

function installmentIdInput(value) {
  if (value === undefined || value === null || value === '' || value === OUTSTANDING_TARGET) return null
  return id(value, 'Kỳ thanh toán', 100)
}

function boundedText(value, label, maximum) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' || value.length > maximum) throw new HttpsError('invalid-argument', `${label} tối đa ${maximum} ký tự.`)
  return value.trim()
}

function iso(value) {
  return value?.toDate?.().toISOString?.() || null
}

function ownsContract(contract, profileId) {
  return Boolean(profileId) && (contract?.studentId === profileId || contract?.crmProfileId === profileId)
}

async function studentScope(request, db) {
  const actor = await studentActor(request, db)
  const resolution = await studentProfileForActor(db, actor)
  if (!resolution.profile) {
    throw new HttpsError('failed-precondition', 'Tài khoản chưa liên kết hồ sơ học viên.', { issueCode: 'PROFILE_NOT_LINKED' })
  }
  return { actor, profile: resolution.profile }
}

async function financeAdmin(request, db) {
  const actor = await trustedAccessContext(request, db)
  requireCapability(actor, 'finance.operations.manage')
  // Same boundary as the receivables workspace: claims expose student names
  // and amounts across branches, so only finance administrators can list them.
  if (!['admin', 'super_admin'].includes(actor.accessRole)) {
    throw new HttpsError('permission-denied', 'Bạn chưa có quyền xác nhận thanh toán của học viên.')
  }
  return actor
}

function branchScope(actor, requested) {
  const branch = typeof requested === 'string' && requested.trim() ? id(requested, 'Chi nhánh') : 'all'
  if (!['admin', 'super_admin'].includes(actor.accessRole) && (branch === 'all' || !actor.branchIds?.includes(branch))) {
    throw new HttpsError('permission-denied', 'Chi nhánh nằm ngoài phạm vi truy cập.')
  }
  return branch
}

// A branch's own bank account first. Fall back only when the business runs a
// single receiving account, so a transfer is never routed to the wrong branch.
async function transferAccountFor(db, branchId) {
  const snapshot = await db.collection('cashAccounts').where('transferProfile.enabled', '==', true).limit(50).get()
  const accounts = snapshot.docs
    .map((document) => ({ id: document.id, value: document.data(), profile: usableTransferProfile(document.data().transferProfile) }))
    .filter((item) => item.profile && item.value.type === 'bank' && (item.value.status || 'active') === 'active')
    .sort((left, right) => left.id.localeCompare(right.id))
  return accounts.find((item) => branchId && item.value.branchId === branchId) || (accounts.length === 1 ? accounts[0] : null)
}

function claimView(claim, proofUrl = '') {
  if (!claim) return null
  return {
    status: claim.status,
    amount: Number(claim.amount || 0),
    note: claim.note || '',
    submittedAt: iso(claim.submittedAt),
    rejectedReason: claim.rejectedReason || '',
    reviewedAt: iso(claim.reviewedAt),
    confirmedAt: iso(claim.confirmedAt),
    receiptVoucherNumber: claim.receiptVoucherNumber || null,
    revision: Number(claim.revision || 0),
    proof: claim.proof?.path ? { uploadedAt: iso(claim.proof.uploadedAt), url: proofUrl || null } : null,
  }
}

// Receipts stay private in Storage; whoever may see the claim gets a link
// that expires, so a forwarded URL stops working on its own.
async function signedProofUrl(storage, proof) {
  if (!storage || !proof?.path) return ''
  try {
    const [url] = await storage.bucket().file(proof.path).getSignedUrl({ action: 'read', expires: Date.now() + PROOF_URL_MINUTES * 60_000 })
    return url
  } catch {
    return ''
  }
}

async function verifiedProof(storage, path, scope) {
  if (!proofPathValid(path, scope)) throw new HttpsError('invalid-argument', 'Ảnh biên lai không thuộc báo chuyển khoản này.')
  if (!storage) throw new HttpsError('failed-precondition', 'Kho ảnh chưa sẵn sàng. Hãy thử lại sau.')
  let metadata
  try {
    [metadata] = await storage.bucket().file(path).getMetadata()
  } catch {
    throw new HttpsError('failed-precondition', 'Ảnh biên lai chưa tải lên xong. Hãy thử lại.', { reason: 'proof-missing' })
  }
  const issue = proofMetadataIssue(metadata, scope)
  if (issue) {
    throw new HttpsError('failed-precondition', { size: 'Ảnh biên lai tối đa 8MB.', type: 'Ảnh biên lai phải là JPG, PNG hoặc WebP.' }[issue] || 'Ảnh biên lai không hợp lệ.', { reason: 'proof-invalid' })
  }
  return { path, contentType: metadata.contentType, size: Number(metadata.size) }
}

// Removes a receipt the student just uploaded when the claim did not take it.
async function discardProof(storage, path, scope) {
  if (storage && proofPathValid(path, scope)) await storage.bucket().file(path).delete({ ignoreNotFound: true }).catch(() => undefined)
}

// The QR carries the scheduled amount; the app rebuilds the same payload for
// the amount the student chooses, from the account fields returned here.
function transferView(account, contractId, target, studentName) {
  if (!account || target.error) return null
  const content = transferContent(studentName, contractId, target.installmentId)
  return {
    bankName: account.profile.bankName,
    bankBin: account.profile.bankBin,
    accountNumber: account.profile.accountNumber,
    accountName: account.profile.accountName,
    content,
    qrPayload: vietQrPayload({ bankBin: account.profile.bankBin, accountNumber: account.profile.accountNumber, amount: target.amount, content }),
  }
}

function contractLabel(contractId, contract, amounts) {
  return {
    id: contractId,
    packageName: contract.packageName || 'Gói tập Aura',
    totalAmount: amounts?.total ?? 0,
    paidAmount: amounts?.paid ?? 0,
    outstandingAmount: amounts?.outstanding ?? 0,
  }
}

function encodeCursor(document) {
  const at = document.data().submittedAt
  return Buffer.from(JSON.stringify({ s: at?.seconds ?? 0, n: at?.nanoseconds ?? 0, id: document.id })).toString('base64url')
}

function decodeCursor(value) {
  if (!value) return null
  try {
    const cursor = JSON.parse(Buffer.from(boundedText(value, 'Con trỏ', 500), 'base64url').toString('utf8'))
    if (!Number.isSafeInteger(cursor.s) || !Number.isSafeInteger(cursor.n) || typeof cursor.id !== 'string') throw new Error()
    return [new Timestamp(cursor.s, cursor.n), id(cursor.id, 'Con trỏ')]
  } catch {
    throw new HttpsError('invalid-argument', 'Con trỏ danh sách không hợp lệ.')
  }
}

function createInstallmentPaymentFunctions({ db, onCall, storage = null, now = () => new Date() }) {
  const getMyInstallmentPayment = onCall(async (request) => {
    const { profile } = await studentScope(request, db)
    const contractId = id(request.data?.contractId, 'Mã hợp đồng')
    const installmentId = installmentIdInput(request.data?.installmentId)
    const claimId = paymentClaimId(contractId, installmentId)
    const claimReference = db.doc(`${PAYMENT_CLAIM_COLLECTION}/${claimId}`)
    const [contractSnapshot, claimSnapshot] = await db.getAll(db.doc(`contracts/${contractId}`), claimReference)
    // Do not reveal whether someone else's contract exists.
    if (!contractSnapshot.exists || !ownsContract(contractSnapshot.data(), profile.id)) {
      throw new HttpsError('not-found', 'Không tìm thấy hợp đồng của bạn.')
    }
    const contract = contractSnapshot.data()
    const target = installmentPaymentTarget(contract, installmentId)
    const claim = claimSnapshot.exists ? claimSnapshot.data() : null
    const state = studentClaimState(claim, target)
    const [account, proofUrl] = await Promise.all([
      state === 'paid' || state === 'unavailable' ? null : transferAccountFor(db, contract.branchId || ''),
      ['submitted', 'rejected'].includes(state) ? signedProofUrl(storage, claim?.proof) : '',
    ])
    const today = vietnamDateKey(now())
    return {
      schemaVersion: 1,
      claimId,
      state,
      unavailableReason: state === 'unavailable' ? target.error : null,
      message: state === 'unavailable' ? targetErrorMessage(target.error) : null,
      contract: contractLabel(contractId, contract, target.amounts),
      installment: target.amount ? {
        id: target.installmentId ?? null,
        amount: target.amount,
        dueDate: target.dueDate,
        sequence: target.sequence,
        count: target.count,
        daysUntilDue: target.dueDate ? dayDistance(today, target.dueDate) : null,
        minAmount: target.minAmount ?? target.amount,
        maxAmount: target.maxAmount ?? target.amount,
      } : null,
      laterInstallments: target.later || [],
      transfer: state === 'paid' ? null : transferView(account, contractId, target, profile.value?.name),
      claim: claimView(claim, proofUrl),
    }
  })

  const submitMyInstallmentPaymentClaim = onCall(async (request) => {
    const { actor, profile } = await studentScope(request, db)
    const action = ['withdraw', 'attach_proof'].includes(request.data?.action) ? request.data.action : 'submit'
    const contractId = id(request.data?.contractId, 'Mã hợp đồng')
    const installmentId = installmentIdInput(request.data?.installmentId)
    const note = boundedText(request.data?.note, 'Ghi chú', 300)
    // The amount the student says they transferred; older clients sent the
    // scheduled amount as expectedAmount.
    const amount = Number(request.data?.amount ?? request.data?.expectedAmount)
    if (action === 'submit' && (!Number.isSafeInteger(amount) || amount <= 0)) {
      throw new HttpsError('invalid-argument', 'Thiếu số tiền bạn đã chuyển.')
    }
    const claimId = paymentClaimId(contractId, installmentId)
    // A receipt is uploaded to Storage before this call, so Rules can check
    // its owner; the claim only references it once the metadata is verified.
    const proofPath = action === 'withdraw' ? '' : boundedText(request.data?.proofPath, 'Ảnh biên lai', 300)
    if (action === 'attach_proof' && !proofPath) throw new HttpsError('invalid-argument', 'Hãy chọn ảnh biên lai.')
    const proofScope = { uid: actor.uid, claimId }
    const contractReference = db.doc(`contracts/${contractId}`)
    const claimReference = db.doc(`${PAYMENT_CLAIM_COLLECTION}/${claimId}`)
    let proofReferenced = false
    let outcome
    try {
      const proof = proofPath ? await verifiedProof(storage, proofPath, proofScope) : null
      const preview = await contractReference.get()
      const account = preview.exists ? await transferAccountFor(db, preview.data().branchId || '') : null
      outcome = await db.runTransaction(async (transaction) => {
        const [contractSnapshot, claimSnapshot] = await Promise.all([transaction.get(contractReference), transaction.get(claimReference)])
        if (!contractSnapshot.exists || !ownsContract(contractSnapshot.data(), profile.id)) {
          throw new HttpsError('not-found', 'Không tìm thấy hợp đồng của bạn.')
        }
        const contract = contractSnapshot.data()
        const claim = claimSnapshot.exists ? claimSnapshot.data() : null
        proofReferenced = Boolean(proof && claim?.proof?.path === proof.path)
        const at = Timestamp.fromDate(now())
        if (action === 'withdraw') {
          if (claim?.status !== 'submitted') return { state: studentClaimState(claim, installmentPaymentTarget(contract, installmentId)), unchanged: true, claim }
          const patch = { status: 'withdrawn', withdrawnAt: at, updatedAt: at }
          transaction.update(claimReference, patch)
          return { state: 'open', unchanged: false, claim: { ...claim, ...patch } }
        }
        if (action === 'attach_proof') {
          if (claim?.status !== 'submitted') {
            throw new HttpsError('failed-precondition', 'Chỉ gửi được ảnh khi báo chuyển khoản đang chờ Aura xác nhận.', { reason: 'claim-not-submitted' })
          }
          if (proofReferenced) return { state: 'submitted', unchanged: true, claim }
          const uploads = Number(claim.proofUploads || (claim.proof ? 1 : 0)) + 1
          if (uploads > MAX_PROOF_UPLOADS) throw new HttpsError('resource-exhausted', 'Bạn đã gửi ảnh nhiều lần. Hãy gửi biên lai qua Zalo Aura.')
          // A new revision makes finance reload before rejecting a claim
          // whose receipt they have not seen yet.
          const patch = { proof: { ...proof, uploadedAt: at }, proofUploads: uploads, revision: Number(claim.revision || 0) + 1, updatedAt: at }
          transaction.update(claimReference, patch)
          return { state: 'submitted', unchanged: false, claim: { ...claim, ...patch } }
        }
        const target = installmentPaymentTarget(contract, installmentId)
        if (target.error) throw new HttpsError('failed-precondition', targetErrorMessage(target.error), { reason: target.error })
        const issue = claimAmountIssue(target, amount)
        if (issue) {
          throw new HttpsError('failed-precondition', amountIssueMessage(issue, target), { reason: 'amount-out-of-range', minAmount: target.minAmount, maxAmount: target.maxAmount })
        }
        if (claim?.status === 'submitted' && Number(claim.amount) === amount && (!proof || proofReferenced)) {
          return { state: 'submitted', unchanged: true, claim }
        }
        const revision = Number(claim?.revision || 0) + 1
        if (revision > MAX_CLAIM_REVISIONS) {
          throw new HttpsError('resource-exhausted', 'Kỳ này đã được báo nhiều lần. Hãy liên hệ Aura để được hỗ trợ trực tiếp.')
        }
        // A changed amount on a pending claim keeps its receipt; a new report
        // after a withdrawal or rejection starts without the old one.
        const keptProof = claim?.status === 'submitted' ? claim.proof || null : null
        const next = {
          schemaVersion: 1,
          contractId,
          installmentId: target.installmentId,
          studentId: profile.id,
          studentName: String(profile.value?.name || '').slice(0, 120),
          branchId: contract.branchId || '',
          packageName: String(contract.packageName || 'Gói tập Aura').slice(0, 120),
          accountUid: actor.uid,
          amount,
          installmentAmount: target.amount,
          dueDate: target.dueDate || null,
          sequence: target.sequence,
          installmentCount: target.count,
          transferCode: transferCode(contractId, target.installmentId),
          transferContent: transferContent(profile.value?.name, contractId, target.installmentId),
          cashAccountId: account?.id || null,
          status: 'submitted',
          note,
          proof: proof ? (proofReferenced ? claim.proof : { ...proof, uploadedAt: at }) : keptProof,
          proofUploads: Number(claim?.proofUploads || 0) + (proof && !proofReferenced ? 1 : 0),
          revision,
          submittedAt: at,
          updatedAt: at,
          createdAt: claim?.createdAt || at,
          rejectedReason: null,
          reviewedAt: null,
          reviewedBy: null,
        }
        transaction.set(claimReference, next)
        // In-app receipt only (no push): the transfer is reported and waits
        // for finance. A retried call reuses the id; a new revision gets one.
        const receipt = paymentClaimReceivedNotification({ accountUid: actor.uid, claimId, revision, packageName: next.packageName, amount, sequence: target.sequence, now: now() })
        transaction.set(db.doc(`users/${actor.uid}/notifications/${receipt.dedupeKey}`), {
          ...receipt,
          id: receipt.dedupeKey,
          expiresAt: Timestamp.fromDate(receipt.expiresAt),
          read: false,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
        return { state: 'submitted', unchanged: false, claim: next }
      })
    } catch (error) {
      if (proofPath && !proofReferenced) await discardProof(storage, proofPath, proofScope)
      throw error
    }
    const proofUrl = outcome.state === 'submitted' ? await signedProofUrl(storage, outcome.claim?.proof) : ''
    return { state: outcome.state, unchanged: outcome.unchanged, claim: claimView(outcome.claim, proofUrl) }
  })

  const listInstallmentPaymentClaims = onCall(async (request) => {
    const actor = await financeAdmin(request, db)
    const branch = branchScope(actor, request.data?.branchId)
    const after = decodeCursor(request.data?.cursor)
    let query = db.collection(PAYMENT_CLAIM_COLLECTION).where('status', '==', 'submitted')
    // 'none' mirrors the receivables filter for contracts without a branch.
    if (branch === 'none') query = query.where('branchId', '==', '')
    else if (branch !== 'all') query = query.where('branchId', '==', branch)
    const ordered = query.orderBy('submittedAt', 'asc').orderBy(FieldPath.documentId(), 'asc')
    const [snapshot, total] = await Promise.all([
      (after ? ordered.startAfter(...after) : ordered).limit(CLAIM_PAGE_SIZE + 1).get(),
      after ? Promise.resolve(null) : query.count().get(),
    ])
    const documents = snapshot.docs.slice(0, CLAIM_PAGE_SIZE)
    const contractIds = [...new Set(documents.map((document) => document.data().contractId).filter(Boolean))]
    const studentIds = [...new Set(documents.map((document) => document.data().studentId).filter(Boolean))]
    const [contracts, students, proofUrls] = await Promise.all([
      contractIds.length ? db.getAll(...contractIds.map((value) => db.doc(`contracts/${value}`)), { fieldMask: CONTRACT_FIELDS }) : [],
      studentIds.length ? db.getAll(...studentIds.map((value) => db.doc(`students/${value}`)), { fieldMask: ['name', 'phone'] }) : [],
      Promise.all(documents.map((document) => signedProofUrl(storage, document.data().proof))),
    ])
    const contractById = new Map(contracts.filter((item) => item.exists).map((item) => [item.id, item.data()]))
    const studentById = new Map(students.filter((item) => item.exists).map((item) => [item.id, item.data()]))
    return {
      schemaVersion: 1,
      total: total ? total.data().count : null,
      hasMore: snapshot.docs.length > CLAIM_PAGE_SIZE,
      nextCursor: snapshot.docs.length > CLAIM_PAGE_SIZE ? encodeCursor(documents.at(-1)) : null,
      claims: documents.map((document, index) => {
        const claim = document.data()
        const contract = contractById.get(claim.contractId) || null
        const target = contract ? installmentPaymentTarget(contract, claim.installmentId || null) : { error: 'not_found' }
        const claimAmount = Number(claim.amount || 0)
        // Any amount up to the remaining debt can be recorded; the payment
        // command moves a difference from the installment to later ones.
        const actionable = !target.error && claimAmount > 0 && claimAmount <= target.maxAmount
        const student = studentById.get(claim.studentId)
        return {
          id: document.id,
          contractId: claim.contractId,
          installmentId: claim.installmentId || null,
          studentId: claim.studentId,
          studentName: student?.name || claim.studentName || '',
          studentPhone: student?.phone || '',
          branchId: claim.branchId || '',
          packageName: claim.packageName || '',
          amount: claimAmount,
          installmentAmount: Number(claim.installmentAmount || claim.amount || 0),
          dueDate: claim.dueDate || null,
          sequence: claim.sequence ?? null,
          installmentCount: claim.installmentCount ?? null,
          transferCode: claim.transferCode || '',
          transferContent: claim.transferContent || claim.transferCode || '',
          cashAccountId: claim.cashAccountId || null,
          note: claim.note || '',
          proofUrl: proofUrls[index] || null,
          proofUploadedAt: claim.proof?.path ? iso(claim.proof.uploadedAt) : null,
          submittedAt: iso(claim.submittedAt),
          revision: Number(claim.revision || 0),
          actionable,
          staleReason: actionable ? null : target.error ? targetErrorMessage(target.error) : 'Số tiền báo vượt công nợ còn lại của hợp đồng.',
          contract: contract ? { id: claim.contractId, ...Object.fromEntries(CONTRACT_FIELDS.map((field) => [field, contract[field] ?? null])) } : null,
        }
      }),
    }
  })

  const reviewInstallmentPaymentClaim = onCall(async (request) => {
    const actor = await financeAdmin(request, db)
    const claimId = id(request.data?.claimId, 'Mã báo thanh toán', 60)
    if (!/^ipc_[0-9a-f]{40}$/.test(claimId)) throw new HttpsError('invalid-argument', 'Mã báo thanh toán không hợp lệ.')
    if (request.data?.action !== 'reject') throw new HttpsError('invalid-argument', 'Thao tác không được hỗ trợ.')
    const reason = boundedText(request.data?.reason, 'Lý do', 300)
    if (reason.length < 3) throw new HttpsError('invalid-argument', 'Hãy ghi lý do để học viên biết cần làm gì tiếp theo.')
    const expectedRevision = Number(request.data?.expectedRevision)
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new HttpsError('invalid-argument', 'Thiếu phiên bản báo thanh toán.')
    const reference = db.doc(`${PAYMENT_CLAIM_COLLECTION}/${claimId}`)
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy báo thanh toán.')
      const claim = snapshot.data()
      branchScope(actor, claim.branchId || undefined)
      if (claim.status !== 'submitted' || Number(claim.revision) !== expectedRevision) {
        throw new HttpsError('failed-precondition', 'Báo thanh toán vừa thay đổi. Hãy tải lại danh sách.', { reason: 'claim-changed' })
      }
      const at = Timestamp.fromDate(now())
      transaction.update(reference, { status: 'rejected', rejectedReason: reason, reviewedAt: at, reviewedBy: actor.uid, updatedAt: at })
      if (/^[A-Za-z0-9_-]{1,128}$/.test(String(claim.accountUid || ''))) {
        const notification = db.doc(`users/${claim.accountUid}/notifications/installment-claim-${claimId.slice(4, 28)}-r${expectedRevision}`)
        transaction.set(notification, {
          id: notification.id,
          userId: claim.accountUid,
          title: 'Aura chưa xác nhận được khoản chuyển',
          message: `${claim.packageName || 'Gói tập'} · ${formatVnd(claim.amount)}. ${reason}`,
          type: 'PAYMENT',
          category: 'payment',
          actionUrl: paymentActionUrl(claim.contractId, claim.installmentId),
          dedupeKey: notification.id,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        })
      }
      return { claimId, status: 'rejected' }
    })
  })

  const configureCashAccountTransferProfile = onCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    requireCapability(actor, 'finance.operations.manage')
    const accountId = id(request.data?.accountId, 'Tài khoản quỹ')
    const enabled = request.data?.enabled === true
    let profile
    try {
      profile = normalizeTransferProfile({ ...request.data, enabled })
    } catch (error) {
      if (error instanceof TransferProfileError) throw new HttpsError('invalid-argument', error.message)
      throw error
    }
    const reference = db.doc(`cashAccounts/${accountId}`)
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy tài khoản quỹ.')
      const account = snapshot.data()
      if (account.type !== 'bank') throw new HttpsError('failed-precondition', 'Chỉ tài khoản ngân hàng mới nhận chuyển khoản qua VietQR.')
      if (enabled && (account.status || 'active') !== 'active') throw new HttpsError('failed-precondition', 'Tài khoản quỹ đang ngưng hoạt động.')
      const at = Timestamp.fromDate(now())
      transaction.update(reference, { transferProfile: { ...profile, updatedAt: at, updatedBy: actor.uid }, updatedAt: at })
      return { accountId, transferProfile: profile }
    })
  })

  return {
    getMyInstallmentPayment,
    submitMyInstallmentPaymentClaim,
    listInstallmentPaymentClaims,
    reviewInstallmentPaymentClaim,
    configureCashAccountTransferProfile,
  }
}

module.exports = { createInstallmentPaymentFunctions, transferAccountFor }
