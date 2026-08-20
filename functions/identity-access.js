const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
// Firebase deploy packages only the functions/ directory. Keep the deployable
// copy here and contract-test it against shared/identity in this repository.
const identityContract = require('./identity-contract.json')

const accessRoles = new Set(identityContract.accessRoles)
const staffPositions = new Set(identityContract.staffPositions)
const legacyRoleToAccess = {
  student: { accessRole: 'student', positions: [] },
  user: { accessRole: 'student', positions: [] },
  coach: { accessRole: 'staff', positions: ['coach_online'] },
  trainer: { accessRole: 'staff', positions: ['trainer_pt'] },
  sales: { accessRole: 'staff', positions: ['sales'] },
  manager: { accessRole: 'staff', positions: ['branch_manager'] },
  editor: { accessRole: 'staff', positions: ['academy_editor'] },
  shipper: { accessRole: 'staff', positions: ['shipper'] },
  admin: { accessRole: 'admin', positions: [] },
  super_admin: { accessRole: 'super_admin', positions: [] },
}

function boundedString(value, label, maximum, required = true) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if ((required && !normalized) || normalized.length > maximum) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return normalized
}

function documentId(value, label) {
  const normalized = boundedString(value, label, 200)
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return normalized
}

function normalizedEmail(value) {
  const email = boundedString(value, 'Email', 320, false).toLowerCase()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'Email không hợp lệ.')
  }
  return email
}

function normalizedPhone(value) {
  const compact = boundedString(value, 'Số điện thoại', 30, false).replace(/[\s().-]/g, '')
  if (!compact) return ''
  const digits = compact.replace(/\D/g, '')
  if (digits.length < 9 || digits.length > 12) throw new HttpsError('invalid-argument', 'Số điện thoại không hợp lệ.')
  if (compact.startsWith('+')) return `+${digits}`
  if (digits.startsWith('84')) return `+${digits}`
  if (digits.startsWith('0')) return `+84${digits.slice(1)}`
  return `+84${digits}`
}

function normalizedPositions(value) {
  if (!Array.isArray(value)) return []
  const positions = [...new Set(value.filter((item) => staffPositions.has(item)))]
  if (positions.length !== value.length) throw new HttpsError('invalid-argument', 'Chức danh nhân viên không hợp lệ.')
  return positions
}

function normalizedBranchIds(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => documentId(item, 'Mã chi nhánh')))].slice(0, 20)
}

function legacyIdentity(role) {
  return legacyRoleToAccess[role] || legacyRoleToAccess.student
}

function comparableLegacyRole(role) {
  return role === 'user' ? 'student' : role
}

function compatibilityRole(accessRole, positions) {
  if (accessRole === 'admin' || accessRole === 'super_admin') return accessRole
  if (accessRole === 'student') return 'student'
  if (positions.includes('trainer_pt')) return 'trainer'
  if (positions.includes('sales')) return 'sales'
  if (positions.includes('branch_manager')) return 'manager'
  if (positions.includes('academy_editor')) return 'editor'
  if (positions.includes('shipper')) return 'shipper'
  return 'coach'
}

function computedCapabilities(accessRole, positions) {
  const capabilities = new Set()
  positions.forEach((position) => {
    const items = identityContract.positionCapabilities[position] || []
    items.forEach((capability) => capabilities.add(capability))
  })
  if (accessRole === 'admin' || accessRole === 'super_admin') {
    identityContract.adminCapabilities.forEach((capability) => capabilities.add(capability))
  }
  if (accessRole === 'super_admin') {
    identityContract.superAdminCapabilities.forEach((capability) => capabilities.add(capability))
  }
  return [...capabilities].sort()
}

function publicAccessContext(uid, value) {
  const accessRole = accessRoles.has(value.accessRole) ? value.accessRole : 'student'
  const positions = normalizedPositions(value.positions || [])
  const branchIds = normalizedBranchIds(value.branchIds || [])
  const authzVersion = Number.isInteger(value.authzVersion) && value.authzVersion > 0 ? value.authzVersion : 1
  const status = ['active', 'suspended', 'invited'].includes(value.status) ? value.status : 'active'
  return {
    uid,
    accessRole,
    positions,
    branchIds,
    capabilities: status === 'active' ? computedCapabilities(accessRole, positions) : [],
    authzVersion,
    status,
  }
}

async function trustedAccessContext(request, db) {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Bạn cần đăng nhập để tiếp tục.')
  const [profileSnapshot, assignmentSnapshot] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.doc(`roleAssignments/${uid}`).get(),
  ])
  if (!profileSnapshot.exists || profileSnapshot.data().disabled === true) {
    throw new HttpsError('permission-denied', 'Tài khoản không còn hoạt động.')
  }

  const claims = request.auth.token || {}
  const profile = profileSnapshot.data()
  if (assignmentSnapshot.exists) {
    const assignment = assignmentSnapshot.data()
    const context = publicAccessContext(uid, assignment)
    if (context.status !== 'active'
        || claims.accessRole !== context.accessRole
        || Number(claims.authzVersion) !== context.authzVersion) {
      throw new HttpsError('permission-denied', 'Quyền tài khoản chưa đồng bộ. Vui lòng đăng nhập lại hoặc liên hệ quản trị viên.')
    }
    return { ...context, legacyStaffId: assignment.crmProfileId || uid }
  }

  const tokenLegacyRole = typeof claims.role === 'string' ? claims.role : 'student'
  const profileLegacyRole = typeof profile.role === 'string' ? profile.role : 'student'
  // The migrated learner population used the legacy `user` label while older
  // Auth records had no custom role claim. Both are non-privileged learner
  // identities. Only normalize that exact safe pair; staff/admin mismatches
  // still fail closed.
  if (comparableLegacyRole(profileLegacyRole) !== comparableLegacyRole(tokenLegacyRole)) {
    throw new HttpsError('permission-denied', 'Quyền tài khoản chưa đồng bộ. Vui lòng đăng nhập lại hoặc liên hệ quản trị viên.')
  }
  const legacy = legacyIdentity(tokenLegacyRole)
  return { ...publicAccessContext(uid, {
    ...legacy,
    branchIds: profile.branchId ? [profile.branchId] : [],
    authzVersion: 1,
    status: 'active',
  }), legacyStaffId: uid }
}

function requireCapability(context, capability) {
  if (!context.capabilities.includes(capability)) {
    throw new HttpsError('permission-denied', 'Bạn không có quyền thực hiện thao tác này.')
  }
}

function foldCatalogText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeCatalogSearch(value) {
  return foldCatalogText(boundedString(value, 'Từ khóa catalog', 80, false))
}

function catalogDocumentId(value) {
  const normalized = boundedString(value, 'Mã catalog', 500)
  if (normalized.includes('/')) throw new HttpsError('invalid-argument', 'Mã catalog không hợp lệ.')
  return normalized
}

function finiteCatalogNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function catalogItem(snapshot) {
  const value = snapshot.data() || {}
  const macros = value.macros || {}
  const basis = value.basis || {}
  const source = value.source || {}
  return {
    id: snapshot.id,
    kind: value.kind === 'dish' || value.kind === 'food' ? value.kind : null,
    code: typeof value.code === 'string' ? value.code : null,
    nameVi: typeof value.nameVi === 'string' ? value.nameVi : '',
    nameEn: typeof value.nameEn === 'string' ? value.nameEn : null,
    nameAscii: typeof value.nameAscii === 'string' ? value.nameAscii : '',
    category: value.category && typeof value.category === 'object' ? value.category : null,
    region: value.region && typeof value.region === 'object' ? value.region : null,
    basis: value.basis && typeof value.basis === 'object' ? value.basis : null,
    energyKcal: finiteCatalogNumber(value.energyKcal),
    macros: {
      proteinG: finiteCatalogNumber(macros.proteinG),
      carbohydrateG: finiteCatalogNumber(macros.carbohydrateG),
      fatG: finiteCatalogNumber(macros.fatG),
      fiberG: finiteCatalogNumber(macros.fiberG),
    },
    imageUrl: typeof value.imageUrl === 'string' ? value.imageUrl : null,
    sourceUrl: typeof value.sourceUrl === 'string' ? value.sourceUrl : typeof source.pageUrl === 'string' ? source.pageUrl : null,
    sourceId: typeof value.sourceId === 'string' ? value.sourceId : typeof source.sourceId === 'string' ? source.sourceId : null,
    detailBucket: typeof value.detailBucket === 'string' ? value.detailBucket : null,
  }
}

function catalogDetail(snapshot) {
  const value = snapshot.data() || {}
  return {
    id: snapshot.id,
    kind: value.kind === 'dish' || value.kind === 'food' ? value.kind : null,
    code: typeof value.code === 'string' ? value.code : null,
    nameVi: typeof value.nameVi === 'string' ? value.nameVi : '',
    nameEn: typeof value.nameEn === 'string' ? value.nameEn : null,
    nameAscii: typeof value.nameAscii === 'string' ? value.nameAscii : null,
    category: value.category && typeof value.category === 'object' ? value.category : null,
    region: value.region && typeof value.region === 'object' ? value.region : null,
    basis: value.basis && typeof value.basis === 'object' ? value.basis : null,
    energyKcal: finiteCatalogNumber(value.energyKcal),
    nutrients: Array.isArray(value.nutrients) ? value.nutrients.slice(0, 120) : [],
    recipeComponents: Array.isArray(value.recipeComponents) ? value.recipeComponents.slice(0, 100) : [],
    imageUrl: typeof value.imageUrl === 'string' ? value.imageUrl : null,
    description: typeof value.description === 'string' ? value.description.slice(0, 4000) : null,
    source: value.source && typeof value.source === 'object' ? value.source : null,
  }
}

let nutritionCatalogCountCache = { value: 0, expiresAt: 0 }
let nutritionCatalogIndexCache = { entries: [], catalogVersion: 'unavailable', expiresAt: 0 }
let nutritionCatalogIndexRequest = null

async function nutritionCatalogTotal(db) {
  if (nutritionCatalogCountCache.expiresAt > Date.now()) return nutritionCatalogCountCache.value
  const aggregate = await db.collection('nutritionCatalog').count().get()
  const value = Number(aggregate.data().count || 0)
  nutritionCatalogCountCache = { value, expiresAt: Date.now() + 5 * 60 * 1000 }
  return value
}

function catalogVersionValue(value) {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  return ''
}

async function nutritionCatalogIndex(db) {
  if (nutritionCatalogIndexCache.expiresAt > Date.now()) return nutritionCatalogIndexCache
  if (nutritionCatalogIndexRequest) return nutritionCatalogIndexRequest

  nutritionCatalogIndexRequest = db.collection('nutritionCatalog')
    .select(
      'kind', 'code', 'nameVi', 'nameEn', 'nameAscii', 'nameTokens',
      'category', 'region', 'basis', 'energyKcal', 'macros', 'imageUrl',
      'sourceUrl', 'sourceId', 'source', 'detailBucket', 'recipeComponents', 'catalogGeneratedAt',
    )
    .get()
    .then((snapshot) => {
      let catalogVersion = ''
      const entries = snapshot.docs.map((document) => {
        const value = document.data() || {}
        const item = catalogItem(document)
        const categoryValues = [item.category?.id, item.category?.nameVi, item.category?.nameEn]
          .filter(Boolean)
        const recipeSearchValues = Array.isArray(value.recipeComponents)
          ? value.recipeComponents.slice(0, 100).flatMap((component) => {
            if (typeof component === 'string') return [component]
            if (!component || typeof component !== 'object') return []
            return Object.values(component).filter((field) => typeof field === 'string')
          })
          : []
        const generatedAt = catalogVersionValue(value.catalogGeneratedAt)
        if (generatedAt > catalogVersion) catalogVersion = generatedAt
        return {
          id: document.id,
          item,
          sortKey: foldCatalogText(item.nameAscii || item.nameVi),
          searchText: foldCatalogText([
            item.nameVi,
            item.nameEn,
            item.nameAscii,
            item.code,
            ...categoryValues,
            item.region?.nameVi,
            ...recipeSearchValues,
          ].filter(Boolean).join(' ')),
          categoryKeys: categoryValues.map(foldCatalogText),
        }
      }).sort((left, right) => left.sortKey.localeCompare(right.sortKey) || left.id.localeCompare(right.id))

      nutritionCatalogIndexCache = {
        entries,
        catalogVersion: catalogVersion || `catalog-${entries.length}`,
        expiresAt: Date.now() + 10 * 60 * 1000,
      }
      return nutritionCatalogIndexCache
    })
    .finally(() => {
      nutritionCatalogIndexRequest = null
    })

  return nutritionCatalogIndexRequest
}

function filterNutritionCatalogEntries(entries, { query, kind, category }) {
  const categoryKey = foldCatalogText(category)
  const queryTokens = foldCatalogText(query).split(' ').filter(Boolean)
  return entries.filter((entry) => {
    if (kind !== 'all' && entry.item.kind !== kind) return false
    if (queryTokens.length && !queryTokens.every((token) => entry.searchText.includes(token))) return false
    if (categoryKey && !entry.categoryKeys.includes(categoryKey)) return false
    return true
  })
}

function nutritionCatalogCategories(entries) {
  return [...new Set(entries
    .map((entry) => entry.item.category?.nameVi)
    .filter((value) => typeof value === 'string' && value.trim()))]
    .sort((left, right) => left.localeCompare(right, 'vi'))
}

function invitePublicData(snapshot) {
  const value = snapshot.data()
  return {
    inviteId: snapshot.id,
    displayName: value.displayName,
    phoneNumber: value.phoneNumber || '',
    email: value.email || '',
    accessRole: value.accessRole,
    positions: value.positions || [],
    expiresAt: value.expiresAt.toDate().toISOString(),
    status: value.status,
  }
}

function createIdentityAccessFunctions({ db, auth, onCall }) {
  const getMyAccessContext = onCall(async (request) => ({
    accessContext: await trustedAccessContext(request, db),
  }))

  const listInternalNutritionCatalog = onCall(async (request) => {
    await trustedAccessContext(request, db)
    const query = normalizeCatalogSearch(request.data?.query)
    const kind = ['dish', 'food'].includes(request.data?.kind) ? request.data.kind : 'all'
    const category = boundedString(request.data?.category, 'Nhóm catalog', 160, false)
    const requestedCatalogVersion = boundedString(request.data?.catalogVersion, 'Phiên bản catalog', 200, false)
    const requestedLimit = Number(request.data?.limit)
    const limit = Number.isInteger(requestedLimit) ? Math.min(60, Math.max(12, requestedLimit)) : 60
    const cursorId = request.data?.cursor ? catalogDocumentId(request.data.cursor) : ''
    const requestedIds = Array.isArray(request.data?.ids)
      ? [...new Set(request.data.ids.map(catalogDocumentId))].slice(0, 250)
      : []
    const [catalogIndex, totalCount] = await Promise.all([
      nutritionCatalogIndex(db),
      nutritionCatalogTotal(db),
    ])
    if (cursorId && requestedCatalogVersion && requestedCatalogVersion !== catalogIndex.catalogVersion) {
      throw new HttpsError('failed-precondition', 'Catalog đã được cập nhật. Hãy tải lại từ trang đầu.')
    }

    if (requestedIds.length) {
      const requestedIdSet = new Set(requestedIds)
      const selectedFacetEntries = filterNutritionCatalogEntries(
        catalogIndex.entries.filter((entry) => requestedIdSet.has(entry.id)),
        { query, kind, category: '' },
      )
      const selected = category
        ? filterNutritionCatalogEntries(selectedFacetEntries, { query: '', kind: 'all', category })
        : selectedFacetEntries
      return {
        items: selected.map((entry) => entry.item),
        hasMore: false,
        nextCursor: null,
        totalCount,
        catalogTotal: totalCount,
        filteredCount: selected.length,
        catalogVersion: catalogIndex.catalogVersion,
        categories: nutritionCatalogCategories(selectedFacetEntries),
        restricted: true,
      }
    }

    const facetEntries = filterNutritionCatalogEntries(catalogIndex.entries, { query, kind, category: '' })
    const filteredEntries = category
      ? filterNutritionCatalogEntries(facetEntries, { query: '', kind: 'all', category })
      : facetEntries
    let startIndex = 0
    if (cursorId) {
      const cursorIndex = filteredEntries.findIndex((entry) => entry.id === cursorId)
      if (cursorIndex < 0) throw new HttpsError('invalid-argument', 'Trang Catalog không còn hợp lệ. Hãy tải lại.')
      startIndex = cursorIndex + 1
    }
    const pageEntries = filteredEntries.slice(startIndex, startIndex + limit)
    const hasMore = startIndex + pageEntries.length < filteredEntries.length
    return {
      items: pageEntries.map((entry) => entry.item),
      hasMore,
      nextCursor: hasMore ? pageEntries.at(-1)?.id || null : null,
      totalCount,
      catalogTotal: totalCount,
      filteredCount: filteredEntries.length,
      catalogVersion: catalogIndex.catalogVersion,
      categories: nutritionCatalogCategories(facetEntries),
      restricted: true,
    }
  })

  const getInternalNutritionCatalogItem = onCall(async (request) => {
    await trustedAccessContext(request, db)
    const id = catalogDocumentId(request.data?.id)
    const snapshot = await db.collection('nutritionCatalog').doc(id).get()
    if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy bản ghi catalog.')
    return { item: catalogDetail(snapshot), restricted: true }
  })

  const createAccountInvite = onCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    requireCapability(actor, 'identity.invite.manage')
    const displayName = boundedString(request.data?.displayName, 'Họ và tên', 160)
    const phoneNumber = normalizedPhone(request.data?.phoneNumber)
    const email = normalizedEmail(request.data?.email)
    if (!phoneNumber && !email) throw new HttpsError('invalid-argument', 'Cần số điện thoại hoặc email để mời tài khoản.')
    const accessRole = request.data?.accessRole === 'staff' ? 'staff' : 'student'
    const positions = accessRole === 'staff' ? normalizedPositions(request.data?.positions || []) : []
    if (accessRole === 'staff' && positions.length === 0) throw new HttpsError('invalid-argument', 'Nhân viên cần ít nhất một chức danh.')
    const branchIds = accessRole === 'staff' ? normalizedBranchIds(request.data?.branchIds || []) : []
    const crmProfileId = request.data?.crmProfileId ? documentId(request.data.crmProfileId, 'Mã hồ sơ CRM') : ''
    const reference = db.collection('accountInvites').doc()
    const expiresAt = Timestamp.fromMillis(Date.now() + 72 * 60 * 60 * 1000)

    const duplicateQueries = []
    if (phoneNumber) duplicateQueries.push(db.collection('accountInvites').where('phoneNumber', '==', phoneNumber).where('status', '==', 'pending').limit(1).get())
    if (email) duplicateQueries.push(db.collection('accountInvites').where('email', '==', email).where('status', '==', 'pending').limit(1).get())
    const duplicates = await Promise.all(duplicateQueries)
    if (duplicates.some((snapshot) => !snapshot.empty)) throw new HttpsError('already-exists', 'Đã có lời mời đang chờ cho thông tin này.')

    await reference.create({
      schemaVersion: 1,
      displayName,
      phoneNumber,
      email,
      accessRole,
      positions,
      branchIds,
      crmProfileId,
      status: 'pending',
      sendCount: 1,
      createdBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      expiresAt,
    })
    await db.collection('identityAuditLogs').add({
      action: 'account_invite.created', actorUid: actor.uid, targetId: reference.id,
      after: { accessRole, positions, branchIds }, createdAt: FieldValue.serverTimestamp(),
    })
    return invitePublicData(await reference.get())
  })

  const resendAccountInvite = onCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    requireCapability(actor, 'identity.invite.manage')
    const inviteId = documentId(request.data?.inviteId, 'Mã lời mời')
    const reference = db.doc(`accountInvites/${inviteId}`)
    const expiresAt = Timestamp.fromMillis(Date.now() + 72 * 60 * 60 * 1000)
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists || snapshot.data().status !== 'pending') throw new HttpsError('failed-precondition', 'Lời mời không còn hiệu lực.')
      if (Number(snapshot.data().sendCount || 0) >= 5) throw new HttpsError('resource-exhausted', 'Lời mời đã đạt giới hạn gửi lại.')
      transaction.update(reference, { sendCount: FieldValue.increment(1), expiresAt, updatedAt: FieldValue.serverTimestamp() })
    })
    return { inviteId, expiresAt: expiresAt.toDate().toISOString() }
  })

  const revokeAccountInvite = onCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    requireCapability(actor, 'identity.invite.manage')
    const inviteId = documentId(request.data?.inviteId, 'Mã lời mời')
    const reference = db.doc(`accountInvites/${inviteId}`)
    await reference.set({ status: 'revoked', revokedBy: actor.uid, revokedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    await db.collection('identityAuditLogs').add({ action: 'account_invite.revoked', actorUid: actor.uid, targetId: inviteId, createdAt: FieldValue.serverTimestamp() })
    return { inviteId, revoked: true }
  })

  const acceptAccountInvite = onCall(async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Bạn cần xác minh tài khoản trước khi nhận lời mời.')
    const inviteId = documentId(request.data?.inviteId, 'Mã lời mời')
    const reference = db.doc(`accountInvites/${inviteId}`)
    const snapshot = await reference.get()
    if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy lời mời.')
    const invite = snapshot.data()
    const tokenPhone = normalizedPhone(request.auth.token.phone_number)
    const tokenEmail = normalizedEmail(request.auth.token.email)
    const phoneMatches = Boolean(invite.phoneNumber && invite.phoneNumber === tokenPhone)
    const emailMatches = Boolean(invite.email && invite.email === tokenEmail)
    if (!phoneMatches && !emailMatches) {
      throw new HttpsError('permission-denied', 'Tài khoản đã xác minh không khớp lời mời.')
    }
    if (invite.status === 'accepted' && invite.acceptedBy === uid) {
      return { accessContext: publicAccessContext(uid, await db.doc(`roleAssignments/${uid}`).get().then((item) => item.data() || {})) }
    }
    if (invite.status !== 'pending' || invite.expiresAt.toMillis() <= Date.now()) throw new HttpsError('failed-precondition', 'Lời mời đã hết hạn hoặc bị thu hồi.')
    const authzVersion = 1
    const authUser = await auth.getUser(uid)
    const nextClaims = {
      ...(authUser.customClaims || {}),
      accessRole: invite.accessRole,
      authzVersion,
      role: compatibilityRole(invite.accessRole, invite.positions || []),
    }
    await auth.setCustomUserClaims(uid, nextClaims)

    try {
      await db.runTransaction(async (transaction) => {
      const current = await transaction.get(reference)
      if (!current.exists || current.data().status !== 'pending') throw new HttpsError('aborted', 'Lời mời vừa được xử lý ở nơi khác.')
      const assignment = {
        schemaVersion: 1,
        uid,
        accessRole: invite.accessRole,
        positions: invite.positions || [],
        branchIds: invite.branchIds || [],
        authzVersion,
        status: 'active',
        crmProfileId: invite.crmProfileId || '',
        updatedBy: uid,
        updatedAt: FieldValue.serverTimestamp(),
      }
      transaction.set(db.doc(`roleAssignments/${uid}`), { ...assignment, createdAt: FieldValue.serverTimestamp() })
      transaction.set(db.doc(`users/${uid}`), {
        uid,
        displayName: invite.displayName,
        email: tokenEmail || invite.email || '',
        phoneNumber: tokenPhone || invite.phoneNumber || '',
        role: compatibilityRole(invite.accessRole, invite.positions || []),
        accessRole: invite.accessRole,
        authzVersion,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      transaction.update(reference, { status: 'accepted', acceptedBy: uid, acceptedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      transaction.set(db.collection('identityAuditLogs').doc(), { action: 'account_invite.accepted', actorUid: uid, targetId: inviteId, createdAt: FieldValue.serverTimestamp() })
      })
    } catch (error) {
      await auth.setCustomUserClaims(uid, authUser.customClaims || {})
      throw error
    }
    return { accessContext: publicAccessContext(uid, { ...invite, authzVersion, status: 'active' }) }
  })

  const assignStaffPositions = onCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    requireCapability(actor, 'identity.staff_position.manage')
    const targetUid = documentId(request.data?.uid, 'UID')
    if (targetUid === actor.uid) throw new HttpsError('failed-precondition', 'Không thể tự thay đổi quyền của chính mình.')
    const accessRole = request.data?.accessRole === 'student' ? 'student' : 'staff'
    const positions = accessRole === 'staff' ? normalizedPositions(request.data?.positions || []) : []
    if (accessRole === 'staff' && positions.length === 0) throw new HttpsError('invalid-argument', 'Nhân viên cần ít nhất một chức danh.')
    const branchIds = accessRole === 'staff' ? normalizedBranchIds(request.data?.branchIds || []) : []
    const target = await auth.getUser(targetUid)
    const assignmentReference = db.doc(`roleAssignments/${targetUid}`)
    const previous = await assignmentReference.get()
    const authzVersion = Math.max(1, Number(previous.data()?.authzVersion || 0) + 1)
    const nextClaims = { ...(target.customClaims || {}), accessRole, authzVersion, role: compatibilityRole(accessRole, positions) }
    await auth.setCustomUserClaims(targetUid, nextClaims)
    try {
      await db.runTransaction(async (transaction) => {
        transaction.set(assignmentReference, { schemaVersion: 1, uid: targetUid, accessRole, positions, branchIds, authzVersion, status: 'active', updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
        transaction.set(db.doc(`users/${targetUid}`), { role: nextClaims.role, accessRole, authzVersion, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
        transaction.set(db.collection('identityAuditLogs').doc(), { action: 'staff_positions.updated', actorUid: actor.uid, targetUid, before: previous.exists ? previous.data() : null, after: { accessRole, positions, branchIds, authzVersion }, createdAt: FieldValue.serverTimestamp() })
      })
    } catch (error) {
      await auth.setCustomUserClaims(targetUid, target.customClaims || {})
      throw error
    }
    return { accessContext: publicAccessContext(targetUid, { accessRole, positions, branchIds, authzVersion, status: 'active' }), tokenRefreshRequired: true }
  })

  const suspendAccountAccess = onCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    requireCapability(actor, 'identity.staff_position.manage')
    const targetUid = documentId(request.data?.uid, 'UID')
    if (targetUid === actor.uid) throw new HttpsError('failed-precondition', 'Không thể tự khóa tài khoản của chính mình.')
    const reference = db.doc(`roleAssignments/${targetUid}`)
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Chưa có phân quyền mới cho tài khoản này.')
      transaction.update(reference, { status: 'suspended', authzVersion: FieldValue.increment(1), updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() })
      transaction.set(db.collection('identityAuditLogs').doc(), { action: 'account_access.suspended', actorUid: actor.uid, targetUid, createdAt: FieldValue.serverTimestamp() })
    })
    await auth.revokeRefreshTokens(targetUid)
    return { uid: targetUid, suspended: true }
  })

  return {
    getMyAccessContext,
    listInternalNutritionCatalog,
    getInternalNutritionCatalogItem,
    createAccountInvite,
    resendAccountInvite,
    revokeAccountInvite,
    acceptAccountInvite,
    assignStaffPositions,
    suspendAccountAccess,
  }
}

module.exports = {
  createIdentityAccessFunctions,
  computedCapabilities,
  legacyIdentity,
  publicAccessContext,
  trustedAccessContext,
  requireCapability,
}
