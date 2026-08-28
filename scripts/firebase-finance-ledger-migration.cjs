const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

/**
 * Target-only, idempotent migration of legacy `payments` into the immutable
 * `ledgerEntries` collection.
 *
 * Safety properties:
 * - defaults to a read-only dry run;
 * - never connects to or writes the retired source project;
 * - never updates/deletes legacy payments or contracts;
 * - creates one deterministic ledger document per evidenced legacy payment;
 * - never manufactures a payment to make `contract.paidAmount` reconcile;
 * - apply requires the exact target, a fresh dry-run digest and confirmation;
 * - reports contain aggregate values and hashes only (no raw document fields).
 */

const PLAN_VERSION = 'finance-ledger-legacy-payment-v1'
const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
})
const RETIRED_SOURCE_PROJECT_ID = 'gen-lang-client-0246058381'
const APPLY_CONFIRMATION = 'APPLY_FINANCE_LEDGER_MIGRATION_V1'
const PRIVATE_DIR = path.resolve('.migration-private')
const REPORT_PATHS = Object.freeze({
  'dry-run': path.join(PRIVATE_DIR, 'firebase-finance-ledger-migration-dry-run.json'),
  apply: path.join(PRIVATE_DIR, 'firebase-finance-ledger-migration-apply.json'),
  verify: path.join(PRIVATE_DIR, 'firebase-finance-ledger-migration-verify.json'),
})
const MAX_COMMIT_WRITES = 400
const HASH_SAMPLE_LIMIT = 100
const MAX_AMOUNT = 1_000_000_000

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonical(value[key])
      return result
    }, {})
  }
  return value
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value))
}

function parseArguments(argv) {
  const parsed = { mode: 'dry-run' }
  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') parsed.help = true
    else if (argument.startsWith('--mode=')) parsed.mode = argument.slice('--mode='.length)
    else if (argument.startsWith('--project=')) parsed.projectId = argument.slice('--project='.length)
    else if (argument.startsWith('--database=')) parsed.databaseId = argument.slice('--database='.length)
    else if (argument.startsWith('--digest=')) parsed.digest = argument.slice('--digest='.length)
    else if (argument.startsWith('--confirm=')) parsed.confirmation = argument.slice('--confirm='.length)
    else if (argument.startsWith('--allow-existing-branch-collisions=')) {
      const count = Number(argument.slice('--allow-existing-branch-collisions='.length))
      if (!Number.isInteger(count) || count < 0) throw new Error('Allowed branch collision count must be a non-negative integer.')
      parsed.allowedBranchCollisions = count
    }
    else throw new Error(`Unknown argument: ${argument.split('=')[0]}`)
  }
  if (!['dry-run', 'apply', 'verify'].includes(parsed.mode)) {
    throw new Error('Mode must be dry-run, apply, or verify.')
  }
  return parsed
}

function usage() {
  return [
    'Finance ledger migration (defaults to read-only dry run)',
    '',
    'Dry run:',
    '  node scripts/firebase-finance-ledger-migration.cjs',
    '',
    'Verify:',
    '  node scripts/firebase-finance-ledger-migration.cjs --mode=verify',
    '',
    'Apply (all guards are required):',
    `  node scripts/firebase-finance-ledger-migration.cjs --mode=apply --project=${TARGET.projectId} --database=${TARGET.databaseId} --digest=<DRY_RUN_DIGEST> --confirm=${APPLY_CONFIRMATION} [--allow-existing-branch-collisions=<EXACT_COUNT>]`,
  ].join('\n')
}

function assertTarget(arguments_) {
  if (TARGET.projectId === RETIRED_SOURCE_PROJECT_ID) throw new Error('Target configuration points to the retired source project.')
  if (arguments_.projectId && arguments_.projectId !== TARGET.projectId) throw new Error('Project override is not the approved target.')
  if (arguments_.databaseId && arguments_.databaseId !== TARGET.databaseId) throw new Error('Database override is not the approved named database.')
  if (arguments_.mode === 'apply') {
    if (arguments_.projectId !== TARGET.projectId || arguments_.databaseId !== TARGET.databaseId) {
      throw new Error('Apply requires explicit --project and --database values matching the approved target.')
    }
    if (!/^[a-f0-9]{64}$/.test(arguments_.digest || '')) throw new Error('Apply requires the 64-character digest from the latest dry run.')
    if (arguments_.confirmation !== APPLY_CONFIRMATION) throw new Error('Apply confirmation is missing or incorrect.')
  }
}

function firebaseCliAuth() {
  const appData = process.env.APPDATA
  if (!appData) throw new Error('APPDATA is unavailable.')
  const cliLib = path.join(appData, 'npm', 'node_modules', 'firebase-tools', 'lib')
  const auth = require(path.join(cliLib, 'auth.js'))
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI is not signed in.')
  return { auth, account }
}

async function accessToken() {
  const { auth, account } = firebaseCliAuth()
  const result = await auth.getAccessToken(account.tokens.refresh_token, [])
  if (!result?.access_token) throw new Error('Unable to obtain a Firebase access token.')
  return result.access_token
}

function databaseBase() {
  return `https://firestore.googleapis.com/v1/projects/${TARGET.projectId}/databases/${encodeURIComponent(TARGET.databaseId)}`
}

async function requestJson(token, endpoint, options = {}) {
  const response = await fetch(`${databaseBase()}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const raw = await response.text()
  if (!response.ok) {
    // Never print the response body; it can contain Firestore metadata.
    throw new Error(`Firestore request failed (${response.status}) at ${endpoint.split('?')[0]}.`)
  }
  return raw ? JSON.parse(raw) : null
}

async function assertLiveTarget(token) {
  const metadata = await requestJson(token, '')
  const expectedName = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}`
  if (metadata?.name !== expectedName) throw new Error('Firestore metadata did not match the approved target database.')
}

function decodeFirestoreValue(value = {}) {
  if ('nullValue' in value) return null
  if ('booleanValue' in value) return Boolean(value.booleanValue)
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('timestampValue' in value) return value.timestampValue
  if ('stringValue' in value) return value.stringValue
  if ('bytesValue' in value) return value.bytesValue
  if ('referenceValue' in value) return value.referenceValue
  if ('geoPointValue' in value) return value.geoPointValue
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map(decodeFirestoreValue)
  if ('mapValue' in value) return decodeFirestoreFields(value.mapValue?.fields || {})
  return undefined
}

function decodeFirestoreFields(fields = {}) {
  return Object.entries(fields).reduce((result, [key, value]) => {
    result[key] = decodeFirestoreValue(value)
    return result
  }, {})
}

function timestamp(value) {
  return Object.freeze({ __firestoreTimestamp: value })
}

function encodeFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null }
  if (value && typeof value === 'object' && typeof value.__firestoreTimestamp === 'string') {
    return { timestampValue: value.__firestoreTimestamp }
  }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Attempted to encode a non-finite number.')
    return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  }
  if (typeof value === 'string') return { stringValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestoreValue) } }
  if (value && typeof value === 'object') return { mapValue: { fields: encodeFirestoreFields(value) } }
  throw new Error('Unsupported Firestore value in migration plan.')
}

function encodeFirestoreFields(value) {
  return Object.entries(value).reduce((result, [key, item]) => {
    result[key] = encodeFirestoreValue(item)
    return result
  }, {})
}

async function readRootCollection(token, collectionId) {
  const rows = await requestJson(token, '/documents:runQuery', {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId, allDescendants: false }],
        orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      },
    }),
  })
  const prefix = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}/documents/${collectionId}/`
  return (Array.isArray(rows) ? rows : [rows])
    .filter((row) => row?.document?.name?.startsWith(prefix))
    .map((row) => ({
      id: row.document.name.slice(prefix.length),
      fields: decodeFirestoreFields(row.document.fields || {}),
      rawFingerprint: sha256(canonicalJson(row.document.fields || {})),
    }))
}

function safeText(value, maximum = 200) {
  return typeof value === 'string' && value.trim() && value.trim().length <= maximum ? value.trim() : ''
}

function safeInteger(value, { allowNegative = true } = {}) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || Math.abs(result) > MAX_AMOUNT) return null
  if (!allowNegative && result < 0) return null
  return result
}

function effectiveAt(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
    ? `${value.trim()}T12:00:00+07:00`
    : value.trim()
  const milliseconds = Date.parse(normalized)
  if (!Number.isFinite(milliseconds)) return null
  const date = new Date(milliseconds)
  const year = date.getUTCFullYear()
  return year >= 2000 && year <= 2100 ? date.toISOString() : null
}

function normalizedPaymentMethod(value) {
  const method = safeText(value, 50).toLowerCase()
  if (['cash', 'transfer', 'card'].includes(method)) return method
  return 'legacy-unknown'
}

function entityHash(collection, id) {
  return sha256(`${PLAN_VERSION}:${collection}/${id}`)
}

function deterministicLedgerId(paymentId) {
  return `legacy_pay_${sha256(`payments/${paymentId}`).slice(0, 40)}`
}

function deterministicIdempotencyKey(paymentId) {
  return `legacy-payment:v1:${sha256(`payments/${paymentId}`).slice(0, 40)}`
}

function comparableTimestamp(value) {
  const raw = value && typeof value === 'object' ? value.__firestoreTimestamp : value
  if (typeof raw !== 'string') return raw
  const milliseconds = Date.parse(raw)
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : raw
}

function expectedComparable(entry) {
  return {
    schemaVersion: Number(entry.schemaVersion || 0),
    type: entry.type || '',
    contractId: entry.contractId || '',
    studentId: entry.studentId || '',
    branchId: entry.branchId || '',
    installmentId: entry.installmentId ?? null,
    amount: Number(entry.amount || 0),
    effectiveAt: comparableTimestamp(entry.effectiveAt),
    createdBy: entry.createdBy || '',
    paymentMethod: entry.paymentMethod || '',
    referenceCode: entry.referenceCode || '',
    idempotencyKey: entry.idempotencyKey || '',
    status: entry.status || '',
    note: entry.note || '',
    migration: entry.migration || {},
  }
}

function desiredEntry(payment, contract, amount, date) {
  const ledgerId = deterministicLedgerId(payment.id)
  const sourceHash = entityHash('payments', payment.id)
  const type = amount > 0 ? 'payment' : 'refund'
  return {
    id: ledgerId,
    data: {
      schemaVersion: 1,
      type,
      contractId: safeText(payment.fields.contractId),
      studentId: safeText(contract.fields.studentId),
      branchId: safeText(contract.fields.branchId),
      installmentId: safeText(payment.fields.installmentId, 100) || null,
      amount,
      effectiveAt: timestamp(date),
      createdBy: `system:${PLAN_VERSION}`,
      paymentMethod: normalizedPaymentMethod(payment.fields.method || payment.fields.paymentMethod),
      referenceCode: `MIG-${sha256(`payments/${payment.id}`).slice(0, 12).toUpperCase()}`,
      idempotencyKey: deterministicIdempotencyKey(payment.id),
      status: 'posted',
      note: 'Migrated from an evidenced legacy payment record.',
      migration: {
        planVersion: PLAN_VERSION,
        sourceCollection: 'payments',
        sourceDocumentHash: sourceHash,
        sourceFingerprint: payment.rawFingerprint,
      },
    },
  }
}

function pushHash(bucket, collection, id) {
  bucket.push(entityHash(collection, id))
}

function hashesForReport(values) {
  return [...new Set(values)].sort().slice(0, HASH_SAMPLE_LIMIT)
}

function reconcileContracts(contracts, validPaymentsByContract) {
  const classification = {
    matched: [],
    missingPaymentEvidence: [],
    projectionBelowLegacy: [],
    overpaid: [],
    invalidContractAmounts: [],
  }
  const amounts = {
    projectedPaid: 0,
    evidencedLegacyNet: 0,
    missingPaymentEvidence: 0,
    projectionBelowLegacy: 0,
    amountAboveContractDue: 0,
  }

  for (const contract of contracts) {
    const projectedPaid = safeInteger(contract.fields.paidAmount, { allowNegative: false })
    const totalPrice = safeInteger(contract.fields.totalPrice, { allowNegative: false })
    const discount = safeInteger(contract.fields.discount || 0, { allowNegative: false })
    const evidenced = (validPaymentsByContract.get(contract.id) || []).reduce((sum, payment) => sum + payment.amount, 0)
    if (projectedPaid === null || totalPrice === null || discount === null || discount > totalPrice) {
      pushHash(classification.invalidContractAmounts, 'contracts', contract.id)
      continue
    }
    const due = totalPrice - discount
    amounts.projectedPaid += projectedPaid
    amounts.evidencedLegacyNet += evidenced
    if (projectedPaid > due || evidenced > due) {
      pushHash(classification.overpaid, 'contracts', contract.id)
      amounts.amountAboveContractDue += Math.max(projectedPaid, evidenced) - due
    }
    if (projectedPaid > evidenced) {
      pushHash(classification.missingPaymentEvidence, 'contracts', contract.id)
      amounts.missingPaymentEvidence += projectedPaid - evidenced
    } else if (evidenced > projectedPaid) {
      pushHash(classification.projectionBelowLegacy, 'contracts', contract.id)
      amounts.projectionBelowLegacy += evidenced - projectedPaid
    } else if (projectedPaid <= due) {
      pushHash(classification.matched, 'contracts', contract.id)
    }
  }
  return { classification, amounts }
}

async function buildPlan(token) {
  const [payments, contracts, ledgerEntries] = await Promise.all([
    readRootCollection(token, 'payments'),
    readRootCollection(token, 'contracts'),
    readRootCollection(token, 'ledgerEntries'),
  ])
  const contractsById = new Map(contracts.map((document) => [document.id, document]))
  const ledgerById = new Map(ledgerEntries.map((document) => [document.id, document]))
  const ledgerByIdempotencyKey = new Map()
  for (const document of ledgerEntries) {
    const key = safeText(document.fields.idempotencyKey, 200)
    if (key) {
      const current = ledgerByIdempotencyKey.get(key) || []
      current.push(document.id)
      ledgerByIdempotencyKey.set(key, current)
    }
  }

  const desired = []
  const validPaymentsByContract = new Map()
  const classifications = {
    invalidPayments: [],
    orphanPayments: [],
    relationshipMismatches: [],
    canonicalCollisions: [],
    alreadyMigrated: [],
    pendingMigration: [],
  }
  const collisionFieldCounts = {}
  const legacyAmounts = { grossPayments: 0, grossRefunds: 0, net: 0 }

  for (const payment of payments) {
    const contractId = safeText(payment.fields.contractId)
    const amount = safeInteger(payment.fields.amount)
    const date = effectiveAt(payment.fields.date)
    if (!contractId || amount === null || amount === 0 || !date) {
      pushHash(classifications.invalidPayments, 'payments', payment.id)
      continue
    }
    const contract = contractsById.get(contractId)
    if (!contract) {
      pushHash(classifications.orphanPayments, 'payments', payment.id)
      continue
    }
    const paymentStudentId = safeText(payment.fields.studentId)
    const contractStudentId = safeText(contract.fields.studentId)
    if (paymentStudentId && contractStudentId && paymentStudentId !== contractStudentId) {
      pushHash(classifications.relationshipMismatches, 'payments', payment.id)
      continue
    }

    const next = desiredEntry(payment, contract, amount, date)
    desired.push(next)
    const related = validPaymentsByContract.get(contractId) || []
    related.push({ paymentId: payment.id, amount })
    validPaymentsByContract.set(contractId, related)
    legacyAmounts.net += amount
    if (amount > 0) legacyAmounts.grossPayments += amount
    else legacyAmounts.grossRefunds += Math.abs(amount)

    const existingById = ledgerById.get(next.id)
    const duplicateIds = ledgerByIdempotencyKey.get(next.data.idempotencyKey) || []
    const collidingDuplicate = duplicateIds.some((id) => id !== next.id)
    if (collidingDuplicate || (existingById && canonicalJson(expectedComparable(existingById.fields)) !== canonicalJson(expectedComparable(next.data)))) {
      pushHash(classifications.canonicalCollisions, 'ledgerEntries', next.id)
      if (collidingDuplicate) collisionFieldCounts.idempotencyKey = (collisionFieldCounts.idempotencyKey || 0) + 1
      if (existingById) {
        const actualComparable = expectedComparable(existingById.fields)
        const desiredComparable = expectedComparable(next.data)
        for (const key of Object.keys(desiredComparable)) {
          if (canonicalJson(actualComparable[key]) !== canonicalJson(desiredComparable[key])) {
            collisionFieldCounts[key] = (collisionFieldCounts[key] || 0) + 1
          }
        }
      }
    } else if (existingById) {
      pushHash(classifications.alreadyMigrated, 'ledgerEntries', next.id)
    } else {
      pushHash(classifications.pendingMigration, 'ledgerEntries', next.id)
    }
  }

  desired.sort((left, right) => left.id.localeCompare(right.id))
  const reconciliation = reconcileContracts(contracts, validPaymentsByContract)
  const planDigest = sha256(canonicalJson({
    planVersion: PLAN_VERSION,
    target: TARGET,
    sourceCounts: { payments: payments.length, contracts: contracts.length },
    desired: desired.map((entry) => ({ id: entry.id, digest: sha256(canonicalJson(expectedComparable(entry.data))) })),
    blockers: {
      invalidPayments: classifications.invalidPayments.sort(),
      orphanPayments: classifications.orphanPayments.sort(),
      relationshipMismatches: classifications.relationshipMismatches.sort(),
      canonicalCollisions: classifications.canonicalCollisions.sort(),
      collisionFieldCounts,
    },
    reconciliation: Object.fromEntries(Object.entries(reconciliation.classification).map(([key, value]) => [key, [...value].sort()])),
  }))
  const blockers = {
    invalidPayments: classifications.invalidPayments.length,
    orphanPayments: classifications.orphanPayments.length,
    relationshipMismatches: classifications.relationshipMismatches.length,
    canonicalCollisions: classifications.canonicalCollisions.length,
    invalidContractAmounts: reconciliation.classification.invalidContractAmounts.length,
  }
  return {
    planDigest,
    payments,
    contracts,
    ledgerEntries,
    desired,
    pending: desired.filter((entry) => classifications.pendingMigration.includes(entityHash('ledgerEntries', entry.id))),
    classifications,
    reconciliation,
    legacyAmounts,
    blockers,
    collisionFieldCounts,
  }
}

function sanitizedReport(mode, plan, extra = {}) {
  const categories = Object.fromEntries(Object.entries(plan.classifications).map(([key, values]) => [key, {
    count: values.length,
    hashedIdSamples: hashesForReport(values),
    sampleLimit: HASH_SAMPLE_LIMIT,
  }]))
  const contractCategories = Object.fromEntries(Object.entries(plan.reconciliation.classification).map(([key, values]) => [key, {
    count: values.length,
    hashedIdSamples: hashesForReport(values),
    sampleLimit: HASH_SAMPLE_LIMIT,
  }]))
  return {
    generatedAt: new Date().toISOString(),
    mode,
    readScope: 'target-only',
    writeScope: mode === 'apply' ? 'ledgerEntries create-only' : 'none',
    target: TARGET,
    retiredSourceProjectAccessed: false,
    planVersion: PLAN_VERSION,
    planDigest: plan.planDigest,
    sourceInventory: {
      legacyPayments: plan.payments.length,
      legacyContracts: plan.contracts.length,
      canonicalLedgerEntriesBeforeRun: plan.ledgerEntries.length,
    },
    migration: {
      evidencedEntries: plan.desired.length,
      pendingEntries: plan.classifications.pendingMigration.length,
      alreadyMigratedEntries: plan.classifications.alreadyMigrated.length,
      fabricatedEntryCount: 0,
      legacyDocumentsUpdated: 0,
      legacyDocumentsDeleted: 0,
      legacyAmounts: plan.legacyAmounts,
    },
    paymentClassifications: categories,
    contractReconciliation: {
      classifications: contractCategories,
      amounts: plan.reconciliation.amounts,
    },
    blockers: plan.blockers,
    collisionFieldCounts: plan.collisionFieldCounts,
    ...extra,
  }
}

function writePrivateReport(filePath, report) {
  fs.mkdirSync(PRIVATE_DIR, { recursive: true })
  const temporary = `${filePath}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, filePath)
}

function loadApprovedDryRun(digest) {
  const reportPath = REPORT_PATHS['dry-run']
  if (!fs.existsSync(reportPath)) throw new Error('Approved dry-run report is missing. Run dry-run again.')
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
  if (report?.mode !== 'dry-run' || report?.planVersion !== PLAN_VERSION) throw new Error('Dry-run report is incompatible with this migration version.')
  if (canonicalJson(report?.target) !== canonicalJson(TARGET)) throw new Error('Dry-run report target does not match the approved target.')
  if (report?.planDigest !== digest) throw new Error('Provided digest does not match the latest saved dry-run report.')
  return report
}

function writeForEntry(entry) {
  return {
    update: {
      name: `projects/${TARGET.projectId}/databases/${TARGET.databaseId}/documents/ledgerEntries/${entry.id}`,
      fields: encodeFirestoreFields(entry.data),
    },
    currentDocument: { exists: false },
    updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
  }
}

async function commitPendingEntries(token, pending) {
  let created = 0
  for (let index = 0; index < pending.length; index += MAX_COMMIT_WRITES) {
    const batch = pending.slice(index, index + MAX_COMMIT_WRITES)
    await requestJson(token, '/documents:commit', {
      method: 'POST',
      body: JSON.stringify({ writes: batch.map(writeForEntry) }),
    })
    created += batch.length
  }
  return created
}

function assertApplySafe(arguments_, plan) {
  loadApprovedDryRun(arguments_.digest)
  if (plan.planDigest !== arguments_.digest) throw new Error('Live source plan changed after dry run. Run and review a new dry run.')
  const nonCollisionBlockerCount = Object.entries(plan.blockers)
    .filter(([key]) => key !== 'canonicalCollisions')
    .reduce((sum, [, count]) => sum + count, 0)
  if (nonCollisionBlockerCount > 0) {
    throw new Error('Apply blocked by orphaned, invalid, mismatched, or invalid-contract records. Review the dry-run report.')
  }

  const collisionCount = plan.blockers.canonicalCollisions
  if (collisionCount === 0) {
    if ((arguments_.allowedBranchCollisions || 0) !== 0) throw new Error('No canonical branch collision exists to approve.')
    return
  }
  const collisionFields = Object.keys(plan.collisionFieldCounts).sort()
  const branchOnly = collisionFields.length === 1
    && collisionFields[0] === 'branchId'
    && plan.collisionFieldCounts.branchId === collisionCount
  if (!branchOnly || arguments_.allowedBranchCollisions !== collisionCount) {
    throw new Error('Canonical collisions remain quarantined. Only an exact, branchId-only collision count may be explicitly preserved.')
  }
}

function safeMigrationVerified(plan) {
  const nonCollisionBlockerCount = Object.entries(plan.blockers)
    .filter(([key]) => key !== 'canonicalCollisions')
    .reduce((sum, [, count]) => sum + count, 0)
  return plan.classifications.pendingMigration.length === 0
    && nonCollisionBlockerCount === 0
    && plan.desired.length === plan.classifications.alreadyMigrated.length + plan.classifications.canonicalCollisions.length
}

async function runDryRun(token) {
  const plan = await buildPlan(token)
  const report = sanitizedReport('dry-run', plan, {
    applyEligible: Object.values(plan.blockers).every((count) => count === 0),
    applyConfirmation: APPLY_CONFIRMATION,
  })
  writePrivateReport(REPORT_PATHS['dry-run'], report)
  console.log(JSON.stringify({
    mode: 'dry-run',
    target: TARGET,
    planDigest: plan.planDigest,
    legacyPayments: plan.payments.length,
    evidencedEntries: plan.desired.length,
    pendingEntries: plan.classifications.pendingMigration.length,
    fabricatedEntryCount: 0,
    blockers: plan.blockers,
    reportPath: REPORT_PATHS['dry-run'],
  }, null, 2))
}

async function runApply(token, arguments_) {
  const planBefore = await buildPlan(token)
  assertApplySafe(arguments_, planBefore)
  const created = await commitPendingEntries(token, planBefore.pending)
  const planAfter = await buildPlan(token)
  const verified = safeMigrationVerified(planAfter)
  const report = sanitizedReport('apply', planAfter, {
    approvedDryRunDigest: arguments_.digest,
    createdEntries: created,
    preservedCanonicalCollisions: planAfter.classifications.canonicalCollisions.length,
    verifiedAfterApply: verified,
  })
  writePrivateReport(REPORT_PATHS.apply, report)
  console.log(JSON.stringify({ mode: 'apply', createdEntries: created, verifiedAfterApply: verified, reportPath: REPORT_PATHS.apply }, null, 2))
  if (!verified) process.exitCode = 2
}

async function runVerify(token) {
  const plan = await buildPlan(token)
  const verified = safeMigrationVerified(plan)
  const report = sanitizedReport('verify', plan, { verified })
  writePrivateReport(REPORT_PATHS.verify, report)
  console.log(JSON.stringify({
    mode: 'verify',
    verified,
    evidencedEntries: plan.desired.length,
    alreadyMigratedEntries: plan.classifications.alreadyMigrated.length,
    pendingEntries: plan.classifications.pendingMigration.length,
    blockers: plan.blockers,
    reportPath: REPORT_PATHS.verify,
  }, null, 2))
  if (!verified) process.exitCode = 2
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2))
  if (arguments_.help) {
    console.log(usage())
    return
  }
  assertTarget(arguments_)
  const token = await accessToken()
  await assertLiveTarget(token)
  if (arguments_.mode === 'dry-run') await runDryRun(token)
  else if (arguments_.mode === 'apply') await runApply(token, arguments_)
  else await runVerify(token)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Finance ledger migration failed.')
  process.exitCode = 1
})
