const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const SOURCE_PROJECT = 'gen-lang-client-0246058381'
const TARGET_PROJECT = 'gen-lang-client-0815966909'
const TARGET_DATABASE = 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'
const ADMIN_EMAIL = 'nhattank16.1@gmail.com'
const REPORT_DIRECTORY = path.resolve('.migration-private')
const MAX_READ_BATCH_SIZE = 300
const MAX_WRITE_BATCH_SIZE = 400

const DEFAULT_NOTIFICATION_SETTINGS = Object.freeze({
  enabled: false,
  mealReminders: false,
  migrationOptInRequired: true,
})

const USAGE = [
  'Usage:',
  '  node scripts/firebase-migration-post-import-normalize.cjs dry-run --source-export=<source.json> --target-before-export=<target-before.json> [--report=<report.json>]',
  `  node scripts/firebase-migration-post-import-normalize.cjs apply --source-export=<source.json> --target-before-export=<target-before.json> --dry-run-report=<dry-run.json> --confirm-production-target=${TARGET_PROJECT} [--report=<report.json>]`,
].join('\n')

class PublicError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function fileDigest(filePath) {
  return sha256(fs.readFileSync(filePath))
}

function uidHash(uid) {
  return sha256(String(uid))
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
    if (!argument.startsWith('--')) throw new PublicError('invalid_argument', USAGE)
    const separator = argument.indexOf('=')
    if (separator < 3) throw new PublicError('invalid_argument', USAGE)
    flags[argument.slice(2, separator)] = argument.slice(separator + 1)
  }
  return { command, flags }
}

function requiredFlag(flags, name) {
  const value = flags[name]
  if (!value) throw new PublicError('missing_argument', `Missing --${name}.\n${USAGE}`)
  return value
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'))
  } catch {
    throw new PublicError('invalid_input_file', `Unable to read a valid ${label} JSON file.`)
  }
}

function readAuthUsers(filePath, label) {
  const parsed = readJson(filePath, label)
  if (!Array.isArray(parsed.users)) {
    throw new PublicError('invalid_auth_export', `The ${label} is not a Firebase Auth JSON export.`)
  }
  return parsed.users
}

function defaultReportPath(command) {
  return path.join(REPORT_DIRECTORY, `post-import-normalize-${command}-report.json`)
}

function ensurePrivatePath(filePath, label) {
  const resolved = path.resolve(filePath)
  const relative = path.relative(REPORT_DIRECTORY, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PublicError('unsafe_private_path', `${label} must remain under .migration-private.`)
  }
  return resolved
}

function writeReport(filePath, report) {
  const resolved = ensurePrivatePath(filePath, 'Migration report')
  fs.mkdirSync(REPORT_DIRECTORY, { recursive: true })
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  return path.relative(process.cwd(), resolved)
}

function addToIndex(index, key, userIndex) {
  if (!key) return
  const entries = index.get(key) || []
  entries.push(userIndex)
  index.set(key, entries)
}

function buildIndexes(users) {
  const uid = new Map()
  const email = new Map()
  const phone = new Map()
  users.forEach((user, index) => {
    addToIndex(uid, exactUid(user.localId), index)
    addToIndex(email, normalizedEmail(user.email), index)
    addToIndex(phone, normalizedPhone(user.phoneNumber), index)
  })
  return { uid, email, phone }
}

function duplicateIdentifiers(indexes) {
  const duplicates = []
  for (const [kind, index] of Object.entries(indexes)) {
    for (const [value, entries] of index.entries()) {
      if (value && entries.length > 1) {
        duplicates.push({ kind, valueHash: sha256(value), count: entries.length })
      }
    }
  }
  return duplicates
}

function analyzeAuthExports(sourceUsers, targetBeforeUsers) {
  const sourceIndexes = buildIndexes(sourceUsers)
  const targetIndexes = buildIndexes(targetBeforeUsers)
  const duplicateSourceIdentifiers = duplicateIdentifiers(sourceIndexes)
  const duplicateTargetIdentifiers = duplicateIdentifiers(targetIndexes)
  const candidates = []
  const conflicts = []

  sourceUsers.forEach((user, sourceIndex) => {
    const uid = exactUid(user.localId)
    if (!uid || uid.includes('/') || Buffer.byteLength(uid, 'utf8') > 128) {
      throw new PublicError('invalid_source_uid', 'The source export contains an invalid UID.')
    }
    const reasons = []
    if (targetIndexes.uid.has(uid)) reasons.push('uid')
    const email = normalizedEmail(user.email)
    const phone = normalizedPhone(user.phoneNumber)
    if (email && targetIndexes.email.has(email)) reasons.push('email')
    if (phone && targetIndexes.phone.has(phone)) reasons.push('phone')
    if (reasons.length) {
      conflicts.push({ sourceIndex, uid, reasons })
    } else {
      candidates.push({ sourceIndex, uid })
    }
  })

  if (duplicateSourceIdentifiers.length || duplicateTargetIdentifiers.length) {
    throw new PublicError('duplicate_auth_identifiers', 'An Auth export contains duplicate UID, email, or phone identifiers.')
  }

  const sourceAdminIndexes = sourceIndexes.email.get(ADMIN_EMAIL) || []
  const targetAdminIndexes = targetIndexes.email.get(ADMIN_EMAIL) || []
  if (sourceAdminIndexes.length !== 1 || targetAdminIndexes.length !== 1) {
    throw new PublicError('admin_identity_missing', 'The expected admin identity is not unique in both Auth exports.')
  }

  const sourceAdmin = sourceUsers[sourceAdminIndexes[0]]
  const targetAdmin = targetBeforeUsers[targetAdminIndexes[0]]
  const sourceAdminUid = exactUid(sourceAdmin.localId)
  const targetAdminUid = exactUid(targetAdmin.localId)
  if (!sourceAdminUid || !targetAdminUid || sourceAdminUid === targetAdminUid) {
    throw new PublicError('admin_identity_invalid', 'The expected admin identity mapping is not safe to normalize.')
  }

  const adminConflict = conflicts.find((entry) => entry.sourceIndex === sourceAdminIndexes[0])
  if (
    conflicts.length !== 1 ||
    !adminConflict ||
    adminConflict.reasons.length !== 1 ||
    adminConflict.reasons[0] !== 'email'
  ) {
    throw new PublicError('unexpected_auth_conflicts', 'Auth conflicts differ from the single approved admin email mapping.')
  }

  const candidateHashes = candidates.map(({ uid }) => uidHash(uid)).sort()
  return {
    candidates,
    conflicts,
    sourceAdminUid,
    targetAdminUid,
    candidateSetDigest: sha256(candidateHashes.join('\n')),
  }
}

function firebaseCliAuthModule() {
  const libraryCandidates = []
  if (process.env.APPDATA) {
    libraryCandidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', 'firebase-tools', 'lib'))
  }
  try {
    libraryCandidates.push(path.dirname(require.resolve('firebase-tools/lib/auth.js')))
  } catch {
    // A global Firebase CLI installation is sufficient.
  }
  const libraryPath = libraryCandidates.find((candidate) => (
    fs.existsSync(path.join(candidate, 'auth.js')) && fs.existsSync(path.join(candidate, 'api.js'))
  ))
  if (!libraryPath) throw new PublicError('firebase_cli_missing', 'Firebase CLI is not installed or cannot be resolved.')
  return require(path.join(libraryPath, 'auth.js'))
}

async function firebaseCliAccessToken() {
  const auth = firebaseCliAuthModule()
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

function parseResponsePayload(raw) {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    const rows = raw
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^,|,$/g, ''))
      .filter((line) => line && line !== '[' && line !== ']')
      .map((line) => JSON.parse(line))
    return rows
  }
}

async function requestJson(accessToken, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const raw = await response.text()
  if (!response.ok) {
    throw new PublicError(`firestore_http_${response.status}`, `Firestore request failed with HTTP ${response.status}.`)
  }
  try {
    return parseResponsePayload(raw)
  } catch {
    throw new PublicError('invalid_firestore_response', 'Firestore returned an unreadable response.')
  }
}

function databaseBase() {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(TARGET_PROJECT)}/databases/${encodeURIComponent(TARGET_DATABASE)}`
}

function documentName(uid) {
  return `projects/${TARGET_PROJECT}/databases/${TARGET_DATABASE}/documents/users/${uid}`
}

async function batchGetDocuments(accessToken, names) {
  if (names.length === 0) return []
  const response = await requestJson(accessToken, `${databaseBase()}/documents:batchGet`, {
    method: 'POST',
    body: JSON.stringify({ documents: names }),
  })
  return Array.isArray(response) ? response : [response]
}

async function commitWrites(accessToken, writes) {
  if (writes.length === 0) return { writeResults: [] }
  return requestJson(accessToken, `${databaseBase()}/documents:commit`, {
    method: 'POST',
    body: JSON.stringify({ writes }),
  })
}

function chunk(items, size) {
  const result = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function requireSafeMigrationFields(fields, label) {
  const migration = fields.migration
  if (!migration) return {}
  if (!migration.mapValue || typeof migration.mapValue !== 'object') {
    throw new PublicError('unsafe_migration_metadata', `${label} has incompatible migration metadata.`)
  }
  return migration.mapValue.fields || {}
}

function booleanValue(fields, name) {
  return fields[name]?.booleanValue === true
}

function stringValue(fields, name) {
  return typeof fields[name]?.stringValue === 'string' ? fields[name].stringValue : undefined
}

function stringArrayValue(fields, name, label) {
  const field = fields[name]
  if (!field) return undefined
  if (!field.arrayValue || !Array.isArray(field.arrayValue.values || [])) {
    throw new PublicError('unsafe_admin_metadata', `${label} has an incompatible type.`)
  }
  const values = field.arrayValue.values || []
  if (values.some((value) => typeof value.stringValue !== 'string')) {
    throw new PublicError('unsafe_admin_metadata', `${label} has an incompatible value.`)
  }
  return values.map((value) => value.stringValue)
}

async function readSnapshots(accessToken, names) {
  const snapshots = new Map()
  for (const nameBatch of chunk(names, MAX_READ_BATCH_SIZE)) {
    const rows = await batchGetDocuments(accessToken, nameBatch)
    for (const row of rows) {
      if (row?.found?.name) {
        snapshots.set(row.found.name, {
          exists: true,
          name: row.found.name,
          fields: row.found.fields || {},
          updateTime: row.found.updateTime,
        })
      } else if (typeof row?.missing === 'string') {
        snapshots.set(row.missing, {
          exists: false,
          name: row.missing,
          fields: {},
          updateTime: null,
        })
      }
    }
  }
  for (const name of names) {
    if (!snapshots.has(name)) {
      throw new PublicError('incomplete_firestore_response', 'Firestore did not return every requested user profile.')
    }
  }
  return snapshots
}

async function readUserDocuments(accessToken, analysis) {
  const candidateNames = analysis.candidates.map(({ uid }) => documentName(uid))
  const sourceAdminName = documentName(analysis.sourceAdminUid)
  const targetAdminName = documentName(analysis.targetAdminUid)
  const snapshots = await readSnapshots(accessToken, [...candidateNames, sourceAdminName, targetAdminName])
  const candidateSnapshots = []
  for (let index = 0; index < analysis.candidates.length; index += 1) {
    candidateSnapshots.push({
      candidate: analysis.candidates[index],
      snapshot: snapshots.get(candidateNames[index]),
    })
  }

  const sourceAdminSnapshot = snapshots.get(sourceAdminName)
  const targetAdminSnapshot = snapshots.get(targetAdminName)

  const missingProfiles = []
  const profilesWithSettings = []
  const profilesNeedingSettings = []
  for (const entry of candidateSnapshots) {
    if (!entry.snapshot.exists) {
      missingProfiles.push(entry)
      continue
    }
    if (hasOwn(entry.snapshot.fields, 'notificationSettings')) profilesWithSettings.push(entry)
    else profilesNeedingSettings.push(entry)
  }

  if (!sourceAdminSnapshot.exists || !targetAdminSnapshot.exists) {
    throw new PublicError('admin_profile_missing', 'Both source and target admin profiles must exist in the target database.')
  }

  const sourceAdminFields = sourceAdminSnapshot.fields
  const targetAdminFields = targetAdminSnapshot.fields
  const sourceMigration = requireSafeMigrationFields(sourceAdminFields, 'The legacy admin profile')
  const targetMigration = requireSafeMigrationFields(targetAdminFields, 'The current admin profile')
  const targetLegacyUids = stringArrayValue(targetMigration, 'legacyUids', 'The current admin legacy UID metadata')
  const targetSourceProjects = stringArrayValue(targetMigration, 'sourceProjects', 'The current admin source project metadata')

  const sourceAdminNeedsUpdate =
    !booleanValue(sourceAdminFields, 'disabled') ||
    !booleanValue(sourceMigration, 'identityMerged') ||
    stringValue(sourceMigration, 'mappedToUid') !== analysis.targetAdminUid ||
    stringValue(sourceMigration, 'sourceProject') !== SOURCE_PROJECT
  const targetAdminNeedsUpdate =
    !booleanValue(targetMigration, 'identityMerged') ||
    !targetLegacyUids?.includes(analysis.sourceAdminUid) ||
    !targetSourceProjects?.includes(SOURCE_PROJECT)

  return {
    missingProfiles,
    profilesWithSettings,
    profilesNeedingSettings,
    sourceAdminSnapshot,
    targetAdminSnapshot,
    sourceAdminNeedsUpdate,
    targetAdminNeedsUpdate,
    targetAdminRoleIsAdmin: stringValue(targetAdminFields, 'role') === 'admin',
    targetAdminDisabled: booleanValue(targetAdminFields, 'disabled'),
  }
}

function baseReport(mode, sourcePath, targetBeforePath, sourceUsers, targetBeforeUsers, analysis, inspection) {
  return {
    schemaVersion: 1,
    mode,
    generatedAt: new Date().toISOString(),
    sourceProject: SOURCE_PROJECT,
    targetProject: TARGET_PROJECT,
    targetDatabase: TARGET_DATABASE,
    inputDigests: {
      sourceAuthExport: fileDigest(sourcePath),
      targetBeforeAuthExport: fileDigest(targetBeforePath),
    },
    candidateSetDigest: analysis.candidateSetDigest,
    counts: {
      sourceAuthUsers: sourceUsers.length,
      targetAuthUsersBefore: targetBeforeUsers.length,
      nonconflictingSourceUsers: analysis.candidates.length,
      approvedConflicts: analysis.conflicts.length,
      existingCandidateProfiles: analysis.candidates.length - inspection.missingProfiles.length,
      missingCandidateProfiles: inspection.missingProfiles.length,
      profilesAlreadyWithNotificationSettings: inspection.profilesWithSettings.length,
      profilesNeedingNotificationSettings: inspection.profilesNeedingSettings.length,
      adminProfileWritesNeeded: Number(inspection.sourceAdminNeedsUpdate) + Number(inspection.targetAdminNeedsUpdate),
      totalWritesPlanned:
        inspection.profilesNeedingSettings.length +
        Number(inspection.sourceAdminNeedsUpdate) +
        Number(inspection.targetAdminNeedsUpdate),
    },
    uidHashes: {
      missingCandidateProfiles: inspection.missingProfiles.map(({ candidate }) => uidHash(candidate.uid)).sort(),
      profilesAlreadyWithNotificationSettings: inspection.profilesWithSettings.map(({ candidate }) => uidHash(candidate.uid)).sort(),
      profilesNeedingNotificationSettings: inspection.profilesNeedingSettings.map(({ candidate }) => uidHash(candidate.uid)).sort(),
      legacyAdmin: uidHash(analysis.sourceAdminUid),
      currentAdmin: uidHash(analysis.targetAdminUid),
    },
    adminNormalization: {
      conflictReasons: ['email'],
      legacyProfileExists: inspection.sourceAdminSnapshot.exists,
      currentProfileExists: inspection.targetAdminSnapshot.exists,
      legacyProfileNeedsUpdate: inspection.sourceAdminNeedsUpdate,
      currentProfileNeedsUpdate: inspection.targetAdminNeedsUpdate,
      currentProfileRoleIsAdmin: inspection.targetAdminRoleIsAdmin,
      currentProfileDisabled: inspection.targetAdminDisabled,
    },
    notificationDefaults: DEFAULT_NOTIFICATION_SETTINGS,
    writesPerformed: false,
  }
}

function validateApprovedDryRun(reportPath, sourcePath, targetBeforePath, analysis) {
  const approvedPath = ensurePrivatePath(reportPath, 'Dry-run report')
  const report = readJson(approvedPath, 'dry-run report')
  if (
    report.mode !== 'dry-run' ||
    report.sourceProject !== SOURCE_PROJECT ||
    report.targetProject !== TARGET_PROJECT ||
    report.targetDatabase !== TARGET_DATABASE ||
    report.inputDigests?.sourceAuthExport !== fileDigest(sourcePath) ||
    report.inputDigests?.targetBeforeAuthExport !== fileDigest(targetBeforePath) ||
    report.candidateSetDigest !== analysis.candidateSetDigest ||
    report.writesPerformed !== false
  ) {
    throw new PublicError('dry_run_mismatch', 'The approved dry-run report does not match the current migration inputs.')
  }
}

function buildWriteOperations(analysis, inspection) {
  const operations = inspection.profilesNeedingSettings.map(({ candidate, snapshot }) => ({
    kind: 'notification_defaults',
    uid: candidate.uid,
    name: snapshot.name,
    updateTime: snapshot.updateTime,
  }))

  if (inspection.sourceAdminNeedsUpdate) {
    operations.push({
      kind: 'legacy_admin',
      uid: analysis.sourceAdminUid,
      name: inspection.sourceAdminSnapshot.name,
      updateTime: inspection.sourceAdminSnapshot.updateTime,
    })
  }
  if (inspection.targetAdminNeedsUpdate) {
    operations.push({
      kind: 'current_admin',
      uid: analysis.targetAdminUid,
      name: inspection.targetAdminSnapshot.name,
      updateTime: inspection.targetAdminSnapshot.updateTime,
    })
  }
  return operations
}

function operationToWrite(operation, analysis) {
  const currentDocument = { updateTime: operation.updateTime }
  if (operation.kind === 'notification_defaults') {
    return {
      update: {
        name: operation.name,
        fields: {
          notificationSettings: {
            mapValue: {
              fields: {
                enabled: { booleanValue: false },
                mealReminders: { booleanValue: false },
                migrationOptInRequired: { booleanValue: true },
              },
            },
          },
        },
      },
      updateMask: { fieldPaths: ['notificationSettings'] },
      currentDocument,
    }
  }
  if (operation.kind === 'legacy_admin') {
    return {
      update: {
        name: operation.name,
        fields: {
          disabled: { booleanValue: true },
          migration: {
            mapValue: {
              fields: {
                identityMerged: { booleanValue: true },
                mappedToUid: { stringValue: analysis.targetAdminUid },
                sourceProject: { stringValue: SOURCE_PROJECT },
              },
            },
          },
        },
      },
      updateMask: {
        fieldPaths: [
          'disabled',
          'migration.identityMerged',
          'migration.mappedToUid',
          'migration.sourceProject',
        ],
      },
      updateTransforms: [{ fieldPath: 'migration.normalizedAt', setToServerValue: 'REQUEST_TIME' }],
      currentDocument,
    }
  }
  if (operation.kind === 'current_admin') {
    return {
      update: {
        name: operation.name,
        fields: {
          migration: {
            mapValue: {
              fields: { identityMerged: { booleanValue: true } },
            },
          },
        },
      },
      updateMask: { fieldPaths: ['migration.identityMerged'] },
      updateTransforms: [
        {
          fieldPath: 'migration.legacyUids',
          appendMissingElements: { values: [{ stringValue: analysis.sourceAdminUid }] },
        },
        {
          fieldPath: 'migration.sourceProjects',
          appendMissingElements: { values: [{ stringValue: SOURCE_PROJECT }] },
        },
        { fieldPath: 'migration.normalizedAt', setToServerValue: 'REQUEST_TIME' },
      ],
      currentDocument,
    }
  }
  throw new PublicError('unknown_write_operation', 'An unsupported normalization operation was planned.')
}

async function runWithAccessToken(callback) {
  const accessToken = await firebaseCliAccessToken()
  return callback(accessToken)
}

async function dryRun(flags) {
  const sourcePath = path.resolve(requiredFlag(flags, 'source-export'))
  const targetBeforePath = path.resolve(requiredFlag(flags, 'target-before-export'))
  const sourceUsers = readAuthUsers(sourcePath, 'source Auth export')
  const targetBeforeUsers = readAuthUsers(targetBeforePath, 'target-before Auth export')
  const analysis = analyzeAuthExports(sourceUsers, targetBeforeUsers)
  const report = await runWithAccessToken(async (accessToken) => {
    const inspection = await readUserDocuments(accessToken, analysis)
    return baseReport('dry-run', sourcePath, targetBeforePath, sourceUsers, targetBeforeUsers, analysis, inspection)
  })
  const reportPath = writeReport(flags.report || defaultReportPath('dry-run'), report)
  console.log(JSON.stringify({
    mode: report.mode,
    nonconflictingSourceUsers: report.counts.nonconflictingSourceUsers,
    existingCandidateProfiles: report.counts.existingCandidateProfiles,
    missingCandidateProfiles: report.counts.missingCandidateProfiles,
    profilesAlreadyWithNotificationSettings: report.counts.profilesAlreadyWithNotificationSettings,
    profilesNeedingNotificationSettings: report.counts.profilesNeedingNotificationSettings,
    adminProfileWritesNeeded: report.counts.adminProfileWritesNeeded,
    totalWritesPlanned: report.counts.totalWritesPlanned,
    reportPath,
    writesPerformed: false,
  }, null, 2))
}

async function apply(flags) {
  const confirmation = requiredFlag(flags, 'confirm-production-target')
  if (confirmation !== TARGET_PROJECT) {
    throw new PublicError('production_guard_failed', `Production confirmation must equal ${TARGET_PROJECT}.`)
  }

  const sourcePath = path.resolve(requiredFlag(flags, 'source-export'))
  const targetBeforePath = path.resolve(requiredFlag(flags, 'target-before-export'))
  const dryRunReportPath = requiredFlag(flags, 'dry-run-report')
  const sourceUsers = readAuthUsers(sourcePath, 'source Auth export')
  const targetBeforeUsers = readAuthUsers(targetBeforePath, 'target-before Auth export')
  const analysis = analyzeAuthExports(sourceUsers, targetBeforeUsers)
  validateApprovedDryRun(dryRunReportPath, sourcePath, targetBeforePath, analysis)

  const report = await runWithAccessToken(async (accessToken) => {
    const inspection = await readUserDocuments(accessToken, analysis)
    const result = baseReport('apply', sourcePath, targetBeforePath, sourceUsers, targetBeforeUsers, analysis, inspection)
    const operations = buildWriteOperations(analysis, inspection)
    result.apply = {
      attemptedWrites: operations.length,
      successfulWrites: 0,
      failedWrites: 0,
      batches: [],
      successfulUidHashes: [],
      errors: [],
    }

    for (const [batchIndex, operationBatch] of chunk(operations, MAX_WRITE_BATCH_SIZE).entries()) {
      const writes = operationBatch.map((operation) => operationToWrite(operation, analysis))
      try {
        const response = await commitWrites(accessToken, writes)
        if (!Array.isArray(response?.writeResults) || response.writeResults.length !== writes.length) {
          throw new PublicError('incomplete_commit_response', 'Firestore did not acknowledge every normalization write.')
        }
        result.apply.successfulWrites += operationBatch.length
        result.apply.successfulUidHashes.push(...operationBatch.map(({ uid }) => uidHash(uid)))
        result.apply.batches.push({ batchIndex, attempted: operationBatch.length, successful: operationBatch.length, failed: 0 })
      } catch (error) {
        result.apply.failedWrites += operationBatch.length
        result.apply.errors.push({
          batchIndex,
          affectedCount: operationBatch.length,
          code: typeof error?.code === 'string' ? error.code : 'batch_commit_failed',
          errorDigest: sha256(String(error?.message || error?.code || 'batch_commit_failed')),
          uidHashes: operationBatch.map(({ uid }) => uidHash(uid)).sort(),
        })
        result.apply.batches.push({ batchIndex, attempted: operationBatch.length, successful: 0, failed: operationBatch.length })
        break
      }
    }
    result.apply.successfulUidHashes.sort()
    result.writesPerformed = result.apply.successfulWrites > 0
    return result
  })

  const reportPath = writeReport(flags.report || defaultReportPath('apply'), report)
  console.log(JSON.stringify({
    mode: report.mode,
    attemptedWrites: report.apply.attemptedWrites,
    successfulWrites: report.apply.successfulWrites,
    failedWrites: report.apply.failedWrites,
    reportPath,
    writesPerformed: report.writesPerformed,
  }, null, 2))
  if (report.apply.failedWrites > 0) {
    throw new PublicError('partial_normalization', 'Post-import normalization stopped after a guarded batch failure; inspect the sanitized report.')
  }
}

async function main() {
  const { command, flags } = parseArguments(process.argv.slice(2))
  if (command === 'dry-run') return dryRun(flags)
  if (command === 'apply') return apply(flags)
  throw new PublicError('invalid_command', USAGE)
}

main().catch((error) => {
  if (error instanceof PublicError) {
    console.error(JSON.stringify({ code: error.code, message: error.message }, null, 2))
  } else {
    console.error(JSON.stringify({
      code: 'unexpected_failure',
      errorDigest: sha256(String(error?.message || error?.code || 'unexpected_failure')),
    }, null, 2))
  }
  process.exitCode = 1
})
