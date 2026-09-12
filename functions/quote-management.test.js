'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const { createQuoteManagementFunctions } = require('./quote-management')

function clone(value) {
  if (value === undefined) return undefined
  return structuredClone(value)
}

function memoryDb(seed = {}) {
  const documents = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]))
  const reference = (path) => ({ path, id: path.split('/').at(-1) })
  const snapshot = (ref) => ({
    exists: documents.has(ref.path),
    id: ref.id,
    data: () => clone(documents.get(ref.path)),
  })
  const merge = (current, next) => ({ ...(current || {}), ...clone(next) })
  return {
    documents,
    doc: reference,
    async runTransaction(handler) {
      const transaction = {
        get: async (ref) => snapshot(ref),
        create(ref, value) {
          if (documents.has(ref.path)) throw new Error(`already exists: ${ref.path}`)
          documents.set(ref.path, clone(value))
        },
        set(ref, value, options) {
          documents.set(ref.path, options?.merge ? merge(documents.get(ref.path), value) : clone(value))
        },
        update(ref, value) {
          if (!documents.has(ref.path)) throw new Error(`not found: ${ref.path}`)
          documents.set(ref.path, merge(documents.get(ref.path), value))
        },
      }
      return handler(transaction)
    },
  }
}

const adminActor = {
  uid: 'admin-1',
  accessRole: 'admin',
  positions: [],
  branchIds: [],
  capabilities: ['sales.operations.manage'],
}

function managerActor(branchIds = ['branch-a']) {
  return {
    uid: 'manager-1',
    accessRole: 'staff',
    positions: ['branch_manager'],
    branchIds,
    capabilities: ['sales.operations.manage'],
  }
}

function api(db, actor = adminActor) {
  return createQuoteManagementFunctions({
    db,
    onCall: (...args) => args.at(-1),
    accessContextResolver: async () => actor,
  })
}

test('list quotes uses a quota-safe public callable configuration', () => {
  const calls = []
  createQuoteManagementFunctions({
    db: memoryDb(),
    onCall: (...args) => {
      calls.push(args)
      return args.at(-1)
    },
    accessContextResolver: async () => adminActor,
  })
  assert.deepEqual(calls[0][0], {
    cpu: 'gcf_gen1',
    concurrency: 1,
    maxInstances: 1,
    invoker: 'public',
  })
  assert.equal(typeof calls[0][1], 'function')
  assert.equal(calls.slice(1).every((args) => args.length === 1), true)
})

function seedCatalog(extra = {}) {
  return {
    'branches/branch-a': { name: 'Aura A', status: 'active' },
    'branches/branch-b': { name: 'Aura B', status: 'active' },
    'packages/pkg-a': { id: 'pkg-a', name: 'Gói PT 24 buổi', totalSessions: 24, durationMonths: 3, price: 12_000_000, branchId: 'branch-a', status: 'active', revision: 2 },
    ...extra,
  }
}

function quoteInput(overrides = {}) {
  return {
    customerName: 'Nguyễn Văn Aura',
    customerPhone: '0901234567',
    branchId: 'branch-a',
    packageId: 'pkg-a',
    discount: 500_000,
    idempotencyKey: 'quote-attempt-0001',
    ...overrides,
  }
}

test('creates a quote with package snapshot, revision, audit and receipt', async () => {
  const db = memoryDb(seedCatalog())
  const result = await api(db).createSalesQuote({ data: quoteInput() })
  assert.equal(result.unchanged, false)
  assert.equal(result.quote.status, 'pending')
  assert.equal(result.quote.revision, 1)
  assert.equal(result.quote.finalPrice, 11_500_000)
  const quote = db.documents.get(`quotes/${result.quote.id}`)
  assert.equal(quote.packageSnapshot.name, 'Gói PT 24 buổi')
  assert.equal(quote.packageSnapshot.revision, 2)
  assert.equal(quote.normalizedPhone, '+84901234567')
  assert.equal([...db.documents.keys()].filter((path) => path.startsWith('auditLogs/quote_command_')).length, 1)
  assert.equal([...db.documents.keys()].filter((path) => path.startsWith('quoteCommandReceipts/')).length, 1)
})

test('same idempotency key is unchanged and cannot be reused with a different payload', async () => {
  const db = memoryDb(seedCatalog())
  const functions = api(db)
  const first = await functions.createSalesQuote({ data: quoteInput() })
  const second = await functions.createSalesQuote({ data: quoteInput() })
  assert.equal(second.unchanged, true)
  assert.equal(second.quote.id, first.quote.id)
  assert.equal([...db.documents.keys()].filter((path) => path.startsWith('quotes/')).length, 1)
  await assert.rejects(
    functions.createSalesQuote({ data: quoteInput({ discount: 600_000 }) }),
    /Mã chống ghi trùng đã được dùng/,
  )
})

test('rejects inactive package, invalid branch scope and discount over twenty percent', async () => {
  const db = memoryDb(seedCatalog({ 'packages/inactive': { name: 'Gói cũ', price: 10_000, branchId: 'branch-a', status: 'inactive' } }))
  const functions = api(db, managerActor())
  await assert.rejects(functions.createSalesQuote({ data: quoteInput({ packageId: 'inactive', idempotencyKey: 'quote-inactive-1' }) }), /không tồn tại hoặc đã ngừng/)
  await assert.rejects(functions.createSalesQuote({ data: quoteInput({ branchId: 'branch-b', idempotencyKey: 'quote-branch-b-1' }) }), /ngoài phạm vi chi nhánh/)
  await assert.rejects(functions.createSalesQuote({ data: quoteInput({ discount: 2_500_000, idempotencyKey: 'quote-discount-1' }) }), /Giảm giá phải là số nguyên/)
})

test('rejects using a member referral code for its own phone number', async () => {
  const db = memoryDb(seedCatalog({
    'memberReferralCodes/AURAOWN': { status: 'active', studentId: 'referrer' },
    'students/referrer': { phone: '0901234567', branchId: 'branch-a' },
  }))
  await assert.rejects(api(db).createSalesQuote({ data: quoteInput({ memberReferralCode: 'AURAOWN', idempotencyKey: 'quote-self-referral' }) }), /chính chủ mã/)
})

test('archive is revisioned and never deletes a quote', async () => {
  const db = memoryDb(seedCatalog())
  const functions = api(db)
  const created = await functions.createSalesQuote({ data: quoteInput() })
  const archived = await functions.archiveSalesQuote({ data: { quoteId: created.quote.id, expectedRevision: 1, idempotencyKey: 'quote-archive-0001' } })
  assert.equal(archived.status, 'archived')
  assert.equal(archived.revision, 2)
  assert.equal(db.documents.has(`quotes/${created.quote.id}`), true)
  assert.equal(db.documents.get(`quotes/${created.quote.id}`).status, 'archived')
  await assert.rejects(functions.archiveSalesQuote({ data: { quoteId: created.quote.id, expectedRevision: 2, idempotencyKey: 'quote-archive-0002' } }), /đã được lưu trữ/)
})

test('accept creates a sales lead and pending contract approval without creating a student or contract', async () => {
  const db = memoryDb(seedCatalog())
  const functions = api(db)
  const created = await functions.createSalesQuote({ data: quoteInput() })
  const accepted = await functions.acceptSalesQuote({ data: { quoteId: created.quote.id, expectedRevision: 1, idempotencyKey: 'quote-accept-0001' } })
  assert.equal(accepted.status, 'accepted')
  assert.equal(accepted.approvalStatus, 'pending')
  assert.equal(db.documents.get(`quotes/${created.quote.id}`).status, 'accepted')
  const lead = db.documents.get(`salesLeads/${accepted.leadId}`)
  const approval = db.documents.get(`contractApprovals/${accepted.approvalId}`)
  assert.equal(lead.status, 'contract_review')
  assert.equal(lead.sourceQuoteId, created.quote.id)
  assert.equal(approval.status, 'pending')
  assert.equal(approval.createdBy, adminActor.uid)
  assert.equal([...db.documents.keys()].some((path) => path.startsWith('students/')), false)
  assert.equal([...db.documents.keys()].some((path) => path.startsWith('contracts/')), false)
})

test('accept accepts an explicit student only when it exists in the same branch and does not match by name', async () => {
  const db = memoryDb(seedCatalog({ 'students/student-a': { displayName: 'Nguyễn Văn Aura', branchId: 'branch-a' } }))
  const functions = api(db)
  const created = await functions.createSalesQuote({ data: quoteInput({ customerName: 'Nguyễn Văn Aura', idempotencyKey: 'quote-student-0001' }) })
  const accepted = await functions.acceptSalesQuote({ data: { quoteId: created.quote.id, studentId: 'student-a', expectedRevision: 1, idempotencyKey: 'quote-student-accept-1' } })
  assert.equal(db.documents.get(`contractApprovals/${accepted.approvalId}`).linkedStudentId, 'student-a')
  const dbNoMatch = memoryDb(seedCatalog({ 'students/other': { displayName: 'Nguyễn Văn Aura', branchId: 'branch-a' } }))
  const other = await api(dbNoMatch).createSalesQuote({ data: quoteInput({ idempotencyKey: 'quote-no-match-1' }) })
  const acceptedNoMatch = await api(dbNoMatch).acceptSalesQuote({ data: { quoteId: other.quote.id, expectedRevision: 1, idempotencyKey: 'quote-no-match-accept' } })
  assert.notEqual(dbNoMatch.documents.get(`contractApprovals/${acceptedNoMatch.approvalId}`).linkedStudentId, 'other')
})

test('quote commands require capability and source has no browser-style destructive write', async () => {
  const db = memoryDb(seedCatalog())
  const actor = { ...managerActor(), capabilities: [] }
  await assert.rejects(api(db, actor).createSalesQuote({ data: quoteInput() }), /không có quyền/)
  const source = readFileSync(join(__dirname, 'quote-management.js'), 'utf8')
  assert.doesNotMatch(source, /transaction\.delete|\.delete\(\)/)
  assert.match(source, /requireCapability\(actor, QUOTE_CAPABILITY\)/)
  assert.match(source, /withFunctionTelemetry\('createSalesQuote'/)
})

test('legacy rejected quotes stay historical instead of returning to the pending queue', () => {
  const { normalizeLegacyQuotes } = require('./quote-management')
  const [quote] = normalizeLegacyQuotes([{ id: 'legacy-rejected', customerName: 'Khách cũ', status: 'rejected' }])
  assert.equal(quote.status, 'archived')
  assert.equal(quote.source, 'legacy')
})

test('sales quote facade keeps renewal quotes in their dedicated approval workspace', () => {
  const source = readFileSync(join(__dirname, 'quote-management.js'), 'utf8')
  assert.match(source, /if \(value\.type === 'renewal'\) continue/)
})
