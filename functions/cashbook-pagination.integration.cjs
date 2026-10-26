'use strict'

const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { createCashbookFunctions } = require('./cashbook')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `cashbook-pages-${randomUUID()}`)
const clients = []
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })

test('real Firestore: read-only continuation can hold the first page snapshot while current data changes', async () => {
  const db = getFirestore(app, `cashbook-snapshot-${randomUUID()}`)
  clients.push(db)
  const reference = db.doc('snapshotProbe/row')
  await reference.set({ version: 1 })
  const first = await db.runTransaction(transaction => transaction.get(reference), { readOnly: true })
  await reference.update({ version: 2 })
  const second = await db.runTransaction(transaction => transaction.get(reference), { readOnly: true, readTime: first.readTime })
  assert.equal(first.data().version, 1)
  assert.equal(second.data().version, 1)
  assert.equal((await reference.get()).data().version, 2)
})

const stamp = index => new Timestamp(1792800000 - index, 123456000)
const payment = (index, extra = {}) => ({ type: 'payment', amount: 100000, status: 'posted', effectiveAt: stamp(index), createdAt: stamp(index), studentId: `learner-${index}`, journalEntryId: `journal-${index}`, cashAccountId: 'fund-a', ...extra })
const receipt = (index, extra = {}) => ({ documentType: 'receipt_voucher', status: 'posted', effectiveAt: stamp(index), createdAt: stamp(index), totalAmount: 100000, accountId: 'fund-a', payerName: 'Fixture payer', journalLines: [], ...extra })

async function fixture(seed = []) {
  const db = getFirestore(app, `cashbook-pages-${randomUUID()}`)
  clients.push(db)
  const rows = [
    ['users/admin', { role: 'admin' }], ['users/admin-b', { role: 'admin' }], ['users/student', { role: 'student' }],
    ['cashAccounts/fund-a', { balance: 12345, status: 'active' }], ...seed,
  ]
  for (let offset = 0; offset < rows.length; offset += 400) {
    const batch = db.batch()
    for (const [name, value] of rows.slice(offset, offset + 400)) batch.set(db.doc(name), value)
    await batch.commit()
  }
  const reads = [], transactions = []
  function query(target, metadata) {
    return {
      target, metadata,
      where: (...args) => query(target.where(...args), { ...metadata, filters: [...metadata.filters, args] }),
      orderBy: (...args) => query(target.orderBy(...args), metadata),
      startAfter: (...args) => query(target.startAfter(...args), metadata),
      select: (...args) => query(target.select(...args), { ...metadata, projection: args }),
      limit: maximum => query(target.limit(maximum), { ...metadata, maximum }),
    }
  }
  const reader = {
    doc: name => ({ path: name, target: db.doc(name), get: () => db.doc(name).get() }),
    collection: name => query(db.collection(name), { kind: 'query', collection: name, filters: [], maximum: null }),
    runTransaction: (action, options) => {
      assert.equal(options?.readOnly, true, 'a list cannot start a writable transaction')
      transactions.push(options)
      return db.runTransaction(transaction => action({
        get: async value => {
          assert.ok(value.target && value.metadata, 'only known bounded queries may run inside the snapshot')
          assert.ok(Number.isInteger(value.metadata.maximum) && value.metadata.maximum > 0)
          const result = await transaction.get(value.target)
          reads.push({ ...value.metadata, size: result.size })
          return result
        },
        getAll: async (...args) => {
          const options = args.at(-1)?.fieldMask ? args.pop() : null
          const references = args.map(value => { assert.ok(value.target && value.path); return value.target })
          reads.push({ kind: 'documents', paths: args.map(value => value.path), requested: references.length, fieldMask: options?.fieldMask || null })
          return transaction.getAll(...references, ...(options ? [options] : []))
        },
      }), options)
    },
  }
  const handlers = createCashbookFunctions({ db: reader, onCall: (options, handler) => typeof options === 'function' ? options : handler })
  const names = { cash: 'listCashTransactions', expenses: 'listExpenseVouchers', receipts: 'listReceiptVouchers' }
  const run = (kind, data = {}, uid = 'admin', token = { role: uid === 'student' ? 'student' : 'admin' }) => handlers[names[kind]]({ data, auth: { uid, token } })
  return { db, run, reads, transactions }
}

async function allPages(f, kind, input = {}) {
  const rows = [], cursors = new Set(), pages = []
  let cursor = null
  for (let index = 0; index < 100; index++) {
    const page = await f.run(kind, { pageSize: 25, ...input, cursor })
    assert.equal(page.paginationVersion, 1)
    pages.push(page)
    rows.push(...(page.transactions || page.vouchers))
    if (!page.hasMore) { assert.equal(page.nextCursor, null); return { rows, pages } }
    assert.ok(page.nextCursor && !cursors.has(page.nextCursor), 'every continuation must advance')
    cursors.add(page.nextCursor)
    cursor = page.nextCursor
  }
  assert.fail('pagination did not terminate')
}

test('real Firestore: cash pages use N+1, filter before reading and distinguish an exactly full last page', async () => {
  for (const count of [0, 25, 26, 127]) {
    const f = await fixture([
      ...Array.from({ length: count }, (_, index) => [`cashTransactions/row-${String(index).padStart(4, '0')}`, { accountId: 'fund-a', effectiveAt: stamp(Math.floor(index / 3)), amount: 100 }]),
      ...Array.from({ length: 150 }, (_, index) => [`cashTransactions/other-${index}`, { accountId: 'fund-b', effectiveAt: stamp(-index), amount: 200 }]),
    ])
    const result = await allPages(f, 'cash', { accountId: 'fund-a' })
    assert.equal(result.rows.length, count)
    assert.equal(new Set(result.rows.map(row => row.id)).size, count)
    assert.equal(result.pages[0].hasMore, count > 25)
    assert.ok(f.reads.every(read => read.kind === 'query' && read.maximum === 26 && read.size <= 26 && read.filters.some(filter => filter[0] === 'accountId')))
    assert.equal((await f.db.doc('cashAccounts/fund-a').get()).data().balance, 12345)
    if (count > 25) assert.ok(f.transactions.slice(1).every(options => options.readTime instanceof Timestamp))
  }
})

test('real Firestore: a stable snapshot preserves boundary deletion and edits between pages, while refresh is current', async () => {
  const f = await fixture(Array.from({ length: 6 }, (_, index) => [`cashTransactions/cash-${index}`, { accountId: 'fund-a', effectiveAt: new Timestamp(1792800000, index * 1000), amount: index }]))
  const first = await f.run('cash', { pageSize: 2 })
  assert.deepEqual(first.transactions.map(row => row.id), ['cash-5', 'cash-4'])
  await f.db.doc('cashTransactions/cash-4').delete()
  await f.db.doc('cashTransactions/cash-3').update({ amount: 999, effectiveAt: stamp(-100) })
  const second = await f.run('cash', { pageSize: 2, cursor: first.nextCursor })
  assert.deepEqual(second.transactions.map(row => [row.id, row.amount]), [['cash-3', 3], ['cash-2', 2]])
  assert.equal(second.asOf, first.asOf)
  const fresh = await allPages(f, 'cash')
  assert.equal(fresh.rows.length, 5)
  assert.equal(fresh.rows[0].id, 'cash-3')
  assert.equal(fresh.rows[0].amount, 999)
})

test('real Firestore: expenses beyond hundreds of unrelated documents are paged without unrelated scans', async () => {
  const f = await fixture([
    ...Array.from({ length: 600 }, (_, index) => [`accountingDocuments/unrelated-${index}`, receipt(-index)]),
    ...Array.from({ length: 52 }, (_, index) => [`accountingDocuments/expense-${String(index).padStart(3, '0')}`, { documentType: index % 2 ? 'expense_voucher' : 'expense_voucher_reversal', accountId: index % 2 ? 'fund-a' : 'fund-b', createdAt: stamp(index + 1), effectiveAt: stamp(index + 1), status: ['draft', 'pending_approval', 'posted', 'reversed'][index % 4], totalAmount: 100 }]),
  ])
  const result = await allPages(f, 'expenses', { pageSize: 13, accountId: 'fund-a' })
  assert.equal(result.rows.length, 52, 'the expense list preserves its existing all-account scope')
  assert.equal(result.pages.length, 4)
  assert.equal(result.pages.at(-1).hasMore, false)
  assert.ok(f.reads.every(read => read.kind === 'query' && read.maximum === 14 && read.size <= 14 && read.filters.some(filter => filter[0] === 'documentType')))
})

test('real Firestore: malformed, expired, cross-account, cross-reader and cross-owner cursors fail before business reads', async () => {
  const f = await fixture(Array.from({ length: 3 }, (_, index) => [`cashTransactions/row-${index}`, { effectiveAt: stamp(index), accountId: 'fund-a', amount: 100 }]))
  const first = await f.run('cash', { pageSize: 1, accountId: 'fund-a' })
  const before = f.reads.length
  for (const [kind, data, owner] of [
    ['cash', { cursor: first.nextCursor, accountId: 'fund-b' }],
    ['cash', { cursor: first.nextCursor, accountId: 'fund-a' }, 'admin-b'],
    ['expenses', { cursor: first.nextCursor }],
    ...['{', 'A'.repeat(4097), {}, 12].map(cursor => ['cash', { cursor }]),
  ]) await assert.rejects(f.run(kind, data, owner), error => error.code === 'invalid-argument')
  const decoded = JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString('utf8'))
  decoded.readTime.seconds -= 901
  await assert.rejects(f.run('cash', { accountId: 'fund-a', cursor: Buffer.from(JSON.stringify(decoded)).toString('base64url') }), error => error.details?.reason === 'cashbook-cursor-expired')
  await assert.rejects(f.run('cash', {}, 'student'), error => error.code === 'permission-denied')
  await f.db.doc('users/admin').update({ disabled: true })
  await assert.rejects(f.run('cash', { cursor: first.nextCursor, accountId: 'fund-a' }), error => error.code === 'permission-denied')
  assert.equal(f.reads.length, before)
})

test('real Firestore: role revocation and a new authorization version are checked outside the historical snapshot', async () => {
  const f = await fixture(Array.from({ length: 3 }, (_, index) => [`cashTransactions/row-${index}`, { effectiveAt: stamp(index), amount: 100 }]))
  const first = await f.run('cash', { pageSize: 1 })
  const before = f.reads.length
  await f.db.doc('roleAssignments/admin').set({ accessRole: 'staff', positions: ['trainer_pt'], branchIds: [], authzVersion: 2, status: 'active' })
  await assert.rejects(f.run('cash', { cursor: first.nextCursor }), error => error.code === 'permission-denied')
  await f.db.doc('roleAssignments/admin').update({ accessRole: 'admin', positions: [] })
  await assert.rejects(f.run('cash', { cursor: first.nextCursor }, 'admin', { accessRole: 'admin', authzVersion: 2 }), error => error.details?.reason === 'cashbook-cursor-invalid')
  assert.equal(f.reads.length, before)
})

test('real Firestore: receipt pagination reaches historical payments and deduplicates materialized links outside the current page', async () => {
  const seed = [
    ...Array.from({ length: 510 }, (_, index) => [`ledgerEntries/payment-${index}`, payment(index)]),
    ...Array.from({ length: 700 }, (_, index) => [`ledgerEntries/unrelated-${index}`, { type: 'revenue_recognition', amount: 1, effectiveAt: stamp(-index) }]),
    ...Array.from({ length: 600 }, (_, index) => [`accountingDocuments/unrelated-${index}`, { documentType: 'expense_voucher', createdAt: stamp(-index), effectiveAt: stamp(-index) }]),
    ...Array.from({ length: 35 }, (_, index) => [`accountingDocuments/manual-${index}`, receipt(index + 1)]),
    ['accountingDocuments/older-custom-receipt', receipt(800, { ledgerEntryId: 'payment-0', createdAt: stamp(-9999) })],
    ['accountingDocuments/receipt_payment-500', receipt(500, { ledgerEntryId: 'payment-500' })],
    ['accountingDocuments/reversal', receipt(20, { documentType: 'receipt_voucher_reversal', ledgerEntryId: 'reversal-ledger', totalAmount: -100000 })],
    ...Array.from({ length: 510 }, (_, index) => [`students/learner-${index}`, { name: `Payer ${index}` }]),
    ...Array.from({ length: 510 }, (_, index) => [`journalEntries/journal-${index}`, { lines: [{ debit: 100000, credit: 0, accountCode: '1111' }] }]),
  ]
  const f = await fixture(seed)
  const first = await f.run('receipts', { pageSize: 25 })
  assert.equal(first.vouchers.length, 25)
  assert.equal(first.vouchers.some(row => row.id === 'derived_payment-0'), false)
  const hydrated = f.reads.filter(read => read.kind === 'documents').flatMap(read => read.paths)
  const returnedLegacy = first.vouchers.filter(row => row.derived)
  assert.equal(hydrated.filter(name => name.startsWith('students/')).length, returnedLegacy.length)
  assert.equal(hydrated.filter(name => name.startsWith('journalEntries/')).length, returnedLegacy.length)
  assert.ok(f.reads.filter(read => read.kind === 'query' && !read.projection).every(read => read.maximum === 26 && read.size <= 26))
  const result = await allPages(f, 'receipts')
  assert.equal(result.rows.length, 546)
  assert.equal(new Set(result.rows.map(row => row.listIdentity)).size, 546)
  assert.equal(result.rows.filter(row => row.derived).length, 508)
  assert.equal(result.rows.filter(row => row.ledgerEntryId === 'payment-0').length, 1)
  assert.equal(result.rows.at(-1).id, 'older-custom-receipt')
})

test('real Firestore: dense materialized receipts return full pages without scanning linked legacy history ahead', async () => {
  const f = await fixture(Array.from({ length: 600 }, (_, index) => [
    [`ledgerEntries/payment-${index}`, payment(index)],
    [`accountingDocuments/receipt-${index}`, receipt(index, { ledgerEntryId: `payment-${index}` })],
  ]).flat())
  const first = await f.run('receipts', { pageSize: 25 })
  assert.deepEqual(first.vouchers.map(row => row.id), Array.from({ length: 25 }, (_, index) => `receipt-${index}`))
  assert.equal(first.scanLimited, false)
  assert.equal(f.reads.filter(read => read.collection === 'ledgerEntries').length, 1)
  assert.equal(f.reads.filter(read => read.collection === 'ledgerEntries')[0].size, 26)
  assert.equal(f.reads.filter(read => read.kind === 'documents').length, 0)
  const result = await allPages(f, 'receipts')
  assert.equal(result.rows.length, 600)
  assert.equal(new Set(result.rows.map(row => row.listIdentity)).size, 600)
  assert.equal(result.pages.length, 24)
  assert.ok(result.pages.every(page => page.vouchers.length === 25))
})

test('real Firestore: sparse receipt pages advance within a bounded budget instead of reporting false exhaustion', async () => {
  const f = await fixture([
    ...Array.from({ length: 220 }, (_, index) => [`ledgerEntries/zero-${index}`, payment(index, { amount: 0 })]),
    ['ledgerEntries/positive-old', payment(300, { amount: '25000' })],
  ])
  const first = await f.run('receipts', { pageSize: 25 })
  assert.deepEqual(first.vouchers, [])
  assert.equal(first.hasMore, true)
  assert.equal(first.scanLimited, true)
  assert.equal(f.reads.filter(read => read.collection === 'ledgerEntries').length, 4)
  assert.ok(f.reads.every(read => read.size <= 26))
  const result = await allPages(f, 'receipts')
  assert.deepEqual(result.rows.map(row => row.id), ['derived_positive-old'])
  assert.ok(result.pages.slice(0, -1).every(page => page.hasMore && page.nextCursor))
})

test('real Firestore: late materialization, backdating and reversal changes do not lose or duplicate the snapshot continuation', async () => {
  const f = await fixture(Array.from({ length: 6 }, (_, index) => [`ledgerEntries/payment-${index}`, payment(index)]))
  const first = await f.run('receipts', { pageSize: 2 })
  assert.deepEqual(first.vouchers.map(row => row.id), ['derived_payment-0', 'derived_payment-1'])
  await f.db.doc('accountingDocuments/new-materialized').set(receipt(3, { ledgerEntryId: 'payment-3' }))
  await f.db.doc('ledgerEntries/payment-3').update({ accountingDocumentId: 'new-materialized', status: 'reversed' })
  await f.db.doc('ledgerEntries/payment-4').update({ effectiveAt: stamp(-50) })
  const second = await f.run('receipts', { pageSize: 2, cursor: first.nextCursor })
  const third = await f.run('receipts', { pageSize: 2, cursor: second.nextCursor })
  assert.deepEqual([...first.vouchers, ...second.vouchers, ...third.vouchers].map(row => row.id), Array.from({ length: 6 }, (_, index) => `derived_payment-${index}`))
  assert.equal(second.vouchers[1].status, 'posted')
  const refreshed = await allPages(f, 'receipts')
  assert.equal(refreshed.rows.length, 6)
  assert.equal(refreshed.rows.filter(row => row.ledgerEntryId === 'payment-3').length, 1)
  assert.equal(refreshed.rows.find(row => row.ledgerEntryId === 'payment-3').id, 'new-materialized')
  assert.equal(refreshed.rows[0].id, 'derived_payment-4')
})

test('real Firestore: receipt account filters are selective and explicit legacy pointers avoid duplicate hydration', async () => {
  const f = await fixture([
    ...Array.from({ length: 620 }, (_, index) => [`ledgerEntries/outside-${index}`, payment(-index, { cashAccountId: 'fund-b' })]),
    ['ledgerEntries/linked', payment(1, { accountingDocumentId: 'pointer-only' })],
    ['ledgerEntries/remaining', payment(2)],
    ['accountingDocuments/pointer-only', receipt(1)],
  ])
  const result = await f.run('receipts', { accountId: 'fund-a', pageSize: 25 })
  assert.deepEqual(result.vouchers.map(row => row.id), ['pointer-only', 'derived_remaining'])
  assert.equal(result.hasMore, false)
  const sources = f.reads.filter(read => read.kind === 'query' && !read.projection)
  assert.ok(sources.every(read => read.size <= 2 && read.filters.some(filter => ['accountId', 'cashAccountId'].includes(filter[0]))))
  assert.ok(f.reads.some(read => read.kind === 'documents' && read.fieldMask?.includes('ledgerEntryId')))
})
