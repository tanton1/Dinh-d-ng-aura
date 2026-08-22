const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const { deleteApp, initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')

const SOURCE_PROJECT = 'gen-lang-client-0246058381'
const TARGET_PROJECT = 'gen-lang-client-0815966909'
const REPORT_DIRECTORY = path.resolve('.migration-private')
// Smaller than the API maximum so a retry/audit never spans the whole tenant.
const MAX_BATCH_SIZE = 100

const PUBLIC_USAGE = [
  'Usage:',
  '  node scripts/firebase-auth-production-migrate.cjs dry-run --source-export=<source.json> --target-export=<target.json> [--report=<report.json>]',
  `  node scripts/firebase-auth-production-migrate.cjs apply --source-export=<source.json> --target-export=<target.json> --dry-run-report=<dry-run.json> --confirm-production-target=${TARGET_PROJECT} [--report=<report.json>]`,
  '  node scripts/firebase-auth-production-migrate.cjs verify --apply-report=<apply.json> --target-export=<target-after.json> [--report=<report.json>]',
].join('\n')

class PublicError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
    this.publicMessage = message
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function fileDigest(filePath) {
  return sha256(fs.readFileSync(filePath))
}

function normalizedEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function normalizedPhone(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function exactUid(value) {
  return typeof value === 'string' ? value : ''
}

function parseArguments(argv) {
  const command = argv[0]
  const flags = {}
  for (const argument of argv.slice(1)) {
    if (!argument.startsWith('--')) {
      throw new PublicError('invalid_argument', PUBLIC_USAGE)
    }
    const separatorIndex = argument.indexOf('=')
    if (separatorIndex < 3) {
      throw new PublicError('invalid_argument', PUBLIC_USAGE)
    }
    flags[argument.slice(2, separatorIndex)] = argument.slice(separatorIndex + 1)
  }
  return { command, flags }
}

function requiredFlag(flags, name) {
  const value = flags[name]
  if (!value) throw new PublicError('missing_argument', `Missing --${name}.\n${PUBLIC_USAGE}`)
  return value
}

function readJson(filePath, label) {
  let raw
  try {
    raw = fs.readFileSync(path.resolve(filePath), 'utf8')
  } catch {
    throw new PublicError('file_unreadable', `Unable to read the ${label} file.`)
  }
  try {
    return JSON.parse(raw)
  } catch {
    throw new PublicError('invalid_json', `The ${label} file is not valid JSON.`)
  }
}

function readExportUsers(filePath, label) {
  const parsed = readJson(filePath, label)
  if (!Array.isArray(parsed.users)) {
    throw new PublicError('invalid_auth_export', `The ${label} file is not a Firebase Auth JSON export.`)
  }
  return parsed.users
}

function defaultReportPath(command) {
  return path.join(REPORT_DIRECTORY, `auth-production-${command}-report.json`)
}

function writeSanitizedReport(reportPath, report) {
  const resolvedPath = path.resolve(reportPath)
  const relative = path.relative(REPORT_DIRECTORY, resolvedPath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PublicError('unsafe_report_path', 'Migration reports must remain under .migration-private.')
  }
  fs.mkdirSync(REPORT_DIRECTORY, { recursive: true })
  fs.writeFileSync(resolvedPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  return resolvedPath
}

function decodeSecretBase64(value, fieldName) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PublicError('invalid_hash_material', `Source hash configuration is missing ${fieldName}.`)
  }
  if (!/^[A-Za-z0-9+/_=-]+$/.test(value)) {
    throw new PublicError('invalid_hash_material', `Source hash configuration has invalid ${fieldName}.`)
  }
  const decoded = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  if (decoded.length === 0) {
    throw new PublicError('invalid_hash_material', `Source hash configuration has empty ${fieldName}.`)
  }
  return decoded
}

function decodeOptionalUserBase64(value) {
  if (typeof value !== 'string' || value.length === 0) return undefined
  if (!/^[A-Za-z0-9+/_=-]+$/.test(value)) throw new Error('invalid_base64')
  const decoded = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  if (decoded.length === 0) throw new Error('invalid_base64')
  return decoded
}

function parseCustomClaims(value) {
  if (typeof value === 'undefined' || value === null || value === '') return undefined
  if (typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string') throw new Error('invalid_custom_claims')
  const claims = JSON.parse(value)
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
    throw new Error('invalid_custom_claims')
  }
  return claims
}

function millisToUtc(value) {
  if (typeof value === 'undefined' || value === null || value === '') return undefined
  const millis = Number(value)
  if (!Number.isFinite(millis) || millis < 0) throw new Error('invalid_timestamp')
  const date = new Date(millis)
  if (Number.isNaN(date.getTime())) throw new Error('invalid_timestamp')
  return date.toISOString()
}

function compactObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => typeof value !== 'undefined'))
}

function mapProvider(provider) {
  const providerId = typeof provider?.providerId === 'string' ? provider.providerId : ''
  const uid = typeof provider?.rawId === 'string'
    ? provider.rawId
    : (typeof provider?.federatedId === 'string' ? provider.federatedId : '')
  if (!providerId || !uid) throw new Error('invalid_provider')
  return compactObject({
    providerId,
    uid,
    email: typeof provider.email === 'string' && provider.email ? provider.email : undefined,
    displayName: typeof provider.displayName === 'string' && provider.displayName ? provider.displayName : undefined,
    photoURL: typeof provider.photoUrl === 'string' && provider.photoUrl ? provider.photoUrl : undefined,
    phoneNumber: typeof provider.phoneNumber === 'string' && provider.phoneNumber ? provider.phoneNumber : undefined,
  })
}

function mapMultiFactor(factor) {
  if (!factor || typeof factor.phoneInfo !== 'string' || !factor.phoneInfo) {
    throw new Error('unsupported_mfa_factor')
  }
  return compactObject({
    factorId: 'phone',
    phoneNumber: factor.phoneInfo,
    uid: typeof factor.mfaEnrollmentId === 'string' && factor.mfaEnrollmentId
      ? factor.mfaEnrollmentId
      : undefined,
    displayName: typeof factor.displayName === 'string' && factor.displayName
      ? factor.displayName
      : undefined,
    enrollmentTime: factor.enrolledAt ? new Date(factor.enrolledAt).toISOString() : undefined,
  })
}

function mapUser(user) {
  const uid = exactUid(user.localId)
  if (!uid || Buffer.byteLength(uid, 'utf8') > 128) throw new Error('invalid_uid')

  const providerData = Array.isArray(user.providerUserInfo)
    ? user.providerUserInfo.map(mapProvider)
    : undefined
  const enrolledFactors = Array.isArray(user.mfaInfo)
    ? user.mfaInfo.map(mapMultiFactor)
    : undefined
  const creationTime = millisToUtc(user.createdAt)
  // `firebase auth:export --format=json` currently emits `lastSignedInAt`.
  // Keep `lastLoginAt` as a compatibility fallback for older CLI exports.
  const lastSignInTime = millisToUtc(user.lastSignedInAt ?? user.lastLoginAt)

  return compactObject({
    uid,
    email: typeof user.email === 'string' && user.email ? user.email : undefined,
    emailVerified: typeof user.emailVerified === 'boolean' ? user.emailVerified : undefined,
    displayName: typeof user.displayName === 'string' && user.displayName ? user.displayName : undefined,
    phoneNumber: typeof user.phoneNumber === 'string' && user.phoneNumber ? user.phoneNumber : undefined,
    photoURL: typeof user.photoUrl === 'string' && user.photoUrl ? user.photoUrl : undefined,
    disabled: typeof user.disabled === 'boolean' ? user.disabled : undefined,
    metadata: creationTime || lastSignInTime ? compactObject({ creationTime, lastSignInTime }) : undefined,
    providerData: providerData?.length ? providerData : undefined,
    customClaims: parseCustomClaims(user.customAttributes),
    passwordHash: decodeOptionalUserBase64(user.passwordHash),
    passwordSalt: decodeOptionalUserBase64(user.salt),
    tenantId: typeof user.tenantId === 'string' && user.tenantId ? user.tenantId : undefined,
    multiFactor: enrolledFactors?.length ? { enrolledFactors } : undefined,
  })
}

function addToIndex(index, key, sourceIndex) {
  if (!key) return
  const existing = index.get(key) || []
  existing.push(sourceIndex)
  index.set(key, existing)
}

function buildTargetIndexes(targetUsers) {
  const uid = new Map()
  const email = new Map()
  const phone = new Map()
  targetUsers.forEach((user, index) => {
    addToIndex(uid, exactUid(user.localId), index)
    addToIndex(email, normalizedEmail(user.email), index)
    addToIndex(phone, normalizedPhone(user.phoneNumber), index)
  })
  return { uid, email, phone }
}

function analyzeExports(sourceUsers, targetUsers) {
  const targetIndexes = buildTargetIndexes(targetUsers)
  const sourceUid = new Map()
  const sourceEmail = new Map()
  const sourcePhone = new Map()
  const conflicts = []
  const validationErrors = []
  const candidates = []

  sourceUsers.forEach((user, sourceIndex) => {
    const uid = exactUid(user.localId)
    const email = normalizedEmail(user.email)
    const phone = normalizedPhone(user.phoneNumber)
    addToIndex(sourceUid, uid, sourceIndex)
    addToIndex(sourceEmail, email, sourceIndex)
    addToIndex(sourcePhone, phone, sourceIndex)

    const reasons = []
    if (uid && targetIndexes.uid.has(uid)) reasons.push('uid')
    if (email && targetIndexes.email.has(email)) reasons.push('email')
    if (phone && targetIndexes.phone.has(phone)) reasons.push('phone')
    if (reasons.length) {
      conflicts.push({ uidHash: uid ? sha256(uid) : null, reasons })
      return
    }

    try {
      candidates.push({ sourceIndex, record: mapUser(user) })
    } catch (error) {
      validationErrors.push({
        uidHash: uid ? sha256(uid) : null,
        code: typeof error?.message === 'string' && /^[a-z0-9_]+$/.test(error.message)
          ? error.message
          : 'invalid_user_record',
      })
    }
  })

  const sourceDuplicates = []
  for (const [kind, index] of [['uid', sourceUid], ['email', sourceEmail], ['phone', sourcePhone]]) {
    for (const [value, indexes] of index.entries()) {
      if (value && indexes.length > 1) {
        sourceDuplicates.push({ kind, valueHash: sha256(value), count: indexes.length })
      }
    }
  }

  return { candidates, conflicts, validationErrors, sourceDuplicates }
}

function cliAuthModule() {
  const candidates = []
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', 'firebase-tools', 'lib', 'auth.js'))
  }
  try {
    candidates.push(require.resolve('firebase-tools/lib/auth.js'))
  } catch {
    // A global Firebase CLI installation is sufficient.
  }
  const modulePath = candidates.find((candidate) => fs.existsSync(candidate))
  if (!modulePath) throw new PublicError('firebase_cli_missing', 'Firebase CLI is not installed or cannot be resolved.')
  return require(modulePath)
}

async function firebaseCliAccessToken() {
  const auth = cliAuthModule()
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) {
    throw new PublicError('firebase_cli_signed_out', 'Firebase CLI is not signed in.')
  }
  const result = await auth.getAccessToken(account.tokens.refresh_token, [])
  if (!result?.access_token) {
    throw new PublicError('oauth_token_unavailable', 'Unable to obtain a Firebase CLI OAuth token.')
  }
  return result.access_token
}

async function fetchSourceHashOptions() {
  const accessToken = await firebaseCliAccessToken()
  const response = await fetch(`https://identitytoolkit.googleapis.com/admin/v2/projects/${SOURCE_PROJECT}/config`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    throw new PublicError('hash_config_request_failed', `Unable to read source Auth hash configuration (HTTP ${response.status}).`)
  }
  const body = await response.json()
  const config = body?.signIn?.hashConfig || body?.hashConfig
  if (!config || typeof config.algorithm !== 'string') {
    throw new PublicError('hash_config_missing', 'Source Auth hash configuration is missing.')
  }

  const algorithm = config.algorithm.toUpperCase()
  const hash = { algorithm }
  const keyValue = config.base64SignerKey || config.signerKey
  const saltValue = config.base64SaltSeparator || config.saltSeparator
  if (keyValue) hash.key = decodeSecretBase64(keyValue, 'signer key')
  if (saltValue) hash.saltSeparator = decodeSecretBase64(saltValue, 'salt separator')
  for (const name of ['rounds', 'memoryCost', 'parallelization', 'blockSize', 'derivedKeyLength']) {
    if (typeof config[name] !== 'undefined') {
      const numericValue = Number(config[name])
      if (!Number.isInteger(numericValue) || numericValue < 0) {
        throw new PublicError('invalid_hash_config', `Source Auth hash configuration has invalid ${name}.`)
      }
      hash[name] = numericValue
    }
  }

  if (algorithm === 'SCRYPT') {
    if (!hash.key || !hash.saltSeparator || typeof hash.rounds !== 'number' || typeof hash.memoryCost !== 'number') {
      throw new PublicError('incomplete_scrypt_config', 'Source SCRYPT configuration is incomplete.')
    }
  }

  return {
    options: { hash },
    summary: {
      algorithm,
      rounds: hash.rounds ?? null,
      memoryCost: hash.memoryCost ?? null,
      parallelization: hash.parallelization ?? null,
      blockSize: hash.blockSize ?? null,
      derivedKeyLength: hash.derivedKeyLength ?? null,
      hasKey: Boolean(hash.key),
      hasSaltSeparator: Boolean(hash.saltSeparator),
    },
  }
}

function baseReport(command, sourcePath, targetPath, sourceUsers, targetUsers, analysis, hashSummary) {
  return {
    schemaVersion: 1,
    mode: command,
    generatedAt: new Date().toISOString(),
    sourceProject: SOURCE_PROJECT,
    targetProject: TARGET_PROJECT,
    exportDigests: {
      sourceSha256: fileDigest(sourcePath),
      targetBeforeSha256: fileDigest(targetPath),
    },
    counts: {
      sourceUsers: sourceUsers.length,
      targetUsersBefore: targetUsers.length,
      targetConflicts: analysis.conflicts.length,
      invalidSourceRecords: analysis.validationErrors.length,
      duplicateSourceIdentifiers: analysis.sourceDuplicates.length,
      eligibleForImport: analysis.candidates.length,
      sourcePasswordUsers: sourceUsers.filter((user) => Boolean(user.passwordHash)).length,
      sourceProviderUsers: sourceUsers.filter((user) => Array.isArray(user.providerUserInfo) && user.providerUserInfo.length > 0).length,
      sourceUsersWithCustomClaims: sourceUsers.filter((user) => Boolean(user.customAttributes)).length,
    },
    hashConfig: hashSummary,
    conflictRecords: analysis.conflicts,
    validationErrors: analysis.validationErrors,
    sourceDuplicateIdentifiers: analysis.sourceDuplicates,
    expectedImportedUidHashes: analysis.candidates.map(({ record }) => sha256(record.uid)).sort(),
    preexistingTargetUidHashes: targetUsers.map((user) => exactUid(user.localId)).filter(Boolean).map(sha256).sort(),
  }
}

function ensureSafeAnalysis(analysis) {
  if (analysis.validationErrors.length > 0) {
    throw new PublicError('invalid_source_records', 'Source Auth contains invalid records; apply is blocked.')
  }
  if (analysis.sourceDuplicates.length > 0) {
    throw new PublicError('duplicate_source_identifiers', 'Source Auth contains duplicate identifiers; apply is blocked.')
  }
}

function assertApprovedDryRun(dryRunReportPath, sourcePath, targetPath, analysis) {
  const report = readJson(dryRunReportPath, 'dry-run report')
  if (report.mode !== 'dry-run' || report.sourceProject !== SOURCE_PROJECT || report.targetProject !== TARGET_PROJECT) {
    throw new PublicError('invalid_dry_run_report', 'The supplied dry-run report does not match this migration.')
  }
  if (report.exportDigests?.sourceSha256 !== fileDigest(sourcePath)
    || report.exportDigests?.targetBeforeSha256 !== fileDigest(targetPath)) {
    throw new PublicError('stale_dry_run_report', 'Auth exports changed after dry-run; run dry-run again.')
  }
  const expected = analysis.candidates.map(({ record }) => sha256(record.uid)).sort()
  if (JSON.stringify(report.expectedImportedUidHashes) !== JSON.stringify(expected)) {
    throw new PublicError('dry_run_mismatch', 'Eligible users changed after dry-run; apply is blocked.')
  }
}

async function dryRun(flags) {
  const sourcePath = path.resolve(requiredFlag(flags, 'source-export'))
  const targetPath = path.resolve(requiredFlag(flags, 'target-export'))
  const sourceUsers = readExportUsers(sourcePath, 'source export')
  const targetUsers = readExportUsers(targetPath, 'target export')
  const analysis = analyzeExports(sourceUsers, targetUsers)
  const { summary } = await fetchSourceHashOptions()
  const report = baseReport('dry-run', sourcePath, targetPath, sourceUsers, targetUsers, analysis, summary)
  const reportPath = writeSanitizedReport(flags.report || defaultReportPath('dry-run'), report)

  console.log(JSON.stringify({
    mode: report.mode,
    sourceUsers: report.counts.sourceUsers,
    targetUsersBefore: report.counts.targetUsersBefore,
    targetConflicts: report.counts.targetConflicts,
    invalidSourceRecords: report.counts.invalidSourceRecords,
    duplicateSourceIdentifiers: report.counts.duplicateSourceIdentifiers,
    eligibleForImport: report.counts.eligibleForImport,
    hashAlgorithm: report.hashConfig.algorithm,
    reportPath,
    writesPerformed: false,
  }, null, 2))

  ensureSafeAnalysis(analysis)
}

function createCliCredential() {
  return {
    getAccessToken: async () => ({
      access_token: await firebaseCliAccessToken(),
      expires_in: 3600,
    }),
  }
}

function chunk(array, size) {
  const batches = []
  for (let index = 0; index < array.length; index += size) batches.push(array.slice(index, index + size))
  return batches
}

async function applyMigration(flags) {
  const confirmation = requiredFlag(flags, 'confirm-production-target')
  if (confirmation !== TARGET_PROJECT) {
    throw new PublicError('production_guard_failed', `Production confirmation must equal ${TARGET_PROJECT}.`)
  }

  const sourcePath = path.resolve(requiredFlag(flags, 'source-export'))
  const targetPath = path.resolve(requiredFlag(flags, 'target-export'))
  const dryRunReportPath = path.resolve(requiredFlag(flags, 'dry-run-report'))
  const sourceUsers = readExportUsers(sourcePath, 'source export')
  const targetUsers = readExportUsers(targetPath, 'target export')
  const analysis = analyzeExports(sourceUsers, targetUsers)
  ensureSafeAnalysis(analysis)
  assertApprovedDryRun(dryRunReportPath, sourcePath, targetPath, analysis)

  const { options, summary } = await fetchSourceHashOptions()
  const report = baseReport('apply', sourcePath, targetPath, sourceUsers, targetUsers, analysis, summary)
  report.import = {
    attempted: analysis.candidates.length,
    successCount: 0,
    failureCount: 0,
    successfulUidHashes: [],
    errors: [],
    batches: [],
  }

  const appName = `auth-production-migration-${Date.now()}`
  const app = initializeApp({ projectId: TARGET_PROJECT, credential: createCliCredential() }, appName)
  try {
    const batches = chunk(analysis.candidates, MAX_BATCH_SIZE)
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex]
      let result
      try {
        result = await getAuth(app).importUsers(batch.map(({ record }) => record), options)
      } catch (error) {
        report.import.failureCount += batch.length
        report.import.errors.push({
          batchIndex,
          code: typeof error?.code === 'string' ? error.code : 'batch_import_failed',
          errorDigest: sha256(String(error?.message || error?.code || 'batch_import_failed')),
          affectedCount: batch.length,
        })
        report.import.batches.push({ batchIndex, attempted: batch.length, successCount: 0, failureCount: batch.length })
        continue
      }

      const failedIndexes = new Set(result.errors.map((entry) => entry.index))
      report.import.successCount += result.successCount
      report.import.failureCount += result.failureCount
      report.import.batches.push({
        batchIndex,
        attempted: batch.length,
        successCount: result.successCount,
        failureCount: result.failureCount,
      })
      batch.forEach(({ record }, recordIndex) => {
        if (!failedIndexes.has(recordIndex)) report.import.successfulUidHashes.push(sha256(record.uid))
      })
      for (const entry of result.errors) {
        const candidate = batch[entry.index]
        report.import.errors.push({
          batchIndex,
          recordIndex: entry.index,
          uidHash: candidate ? sha256(candidate.record.uid) : null,
          code: typeof entry.error?.code === 'string' ? entry.error.code : 'user_import_failed',
          errorDigest: sha256(String(entry.error?.message || entry.error?.code || 'user_import_failed')),
        })
      }
    }
  } finally {
    await deleteApp(app)
  }

  report.import.successfulUidHashes.sort()
  const reportPath = writeSanitizedReport(flags.report || defaultReportPath('apply'), report)
  console.log(JSON.stringify({
    mode: report.mode,
    attempted: report.import.attempted,
    successCount: report.import.successCount,
    failureCount: report.import.failureCount,
    reportPath,
  }, null, 2))
  if (report.import.failureCount > 0) {
    throw new PublicError('partial_auth_import', 'Auth import completed with failures; inspect the sanitized apply report.')
  }
}

async function verify(flags) {
  const applyReportPath = path.resolve(requiredFlag(flags, 'apply-report'))
  const targetPath = path.resolve(requiredFlag(flags, 'target-export'))
  const applyReport = readJson(applyReportPath, 'apply report')
  if (applyReport.mode !== 'apply' || applyReport.targetProject !== TARGET_PROJECT) {
    throw new PublicError('invalid_apply_report', 'The supplied apply report does not match this migration.')
  }
  const targetUsers = readExportUsers(targetPath, 'target export')
  const targetUidHashes = new Set(targetUsers.map((user) => exactUid(user.localId)).filter(Boolean).map(sha256))
  const imported = Array.isArray(applyReport.import?.successfulUidHashes)
    ? applyReport.import.successfulUidHashes
    : []
  const preexisting = Array.isArray(applyReport.preexistingTargetUidHashes)
    ? applyReport.preexistingTargetUidHashes
    : []
  const missingImportedUidHashes = imported.filter((uidHash) => !targetUidHashes.has(uidHash))
  const missingPreexistingUidHashes = preexisting.filter((uidHash) => !targetUidHashes.has(uidHash))
  const expectedKnown = new Set([...imported, ...preexisting])
  const unexpectedTargetUidHashes = [...targetUidHashes].filter((uidHash) => !expectedKnown.has(uidHash)).sort()
  const report = {
    schemaVersion: 1,
    mode: 'verify',
    generatedAt: new Date().toISOString(),
    sourceProject: SOURCE_PROJECT,
    targetProject: TARGET_PROJECT,
    targetExportSha256: fileDigest(targetPath),
    counts: {
      targetUsersAfter: targetUsers.length,
      expectedImportedUsers: imported.length,
      preservedPreexistingUsers: preexisting.length,
      missingImportedUsers: missingImportedUidHashes.length,
      missingPreexistingUsers: missingPreexistingUidHashes.length,
      unexpectedTargetUsers: unexpectedTargetUidHashes.length,
    },
    missingImportedUidHashes,
    missingPreexistingUidHashes,
    unexpectedTargetUidHashes,
    verified: missingImportedUidHashes.length === 0 && missingPreexistingUidHashes.length === 0,
  }
  const reportPath = writeSanitizedReport(flags.report || defaultReportPath('verify'), report)
  console.log(JSON.stringify({ ...report.counts, verified: report.verified, reportPath }, null, 2))
  if (!report.verified) {
    throw new PublicError('auth_verification_failed', 'Target Auth verification failed; inspect the sanitized verify report.')
  }
}

async function main() {
  const { command, flags } = parseArguments(process.argv.slice(2))
  if (command === 'dry-run') return dryRun(flags)
  if (command === 'apply') return applyMigration(flags)
  if (command === 'verify') return verify(flags)
  throw new PublicError('unknown_command', PUBLIC_USAGE)
}

main().catch((error) => {
  if (error instanceof PublicError) {
    console.error(JSON.stringify({ error: error.code, message: error.publicMessage }, null, 2))
  } else {
    console.error(JSON.stringify({
      error: 'unexpected_failure',
      errorDigest: sha256(String(error?.message || error?.code || 'unexpected_failure')),
    }, null, 2))
  }
  process.exitCode = 1
})
