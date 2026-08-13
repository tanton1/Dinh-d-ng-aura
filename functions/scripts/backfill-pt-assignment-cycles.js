'use strict'

const { createHash } = require('node:crypto')
const { applicationDefault, initializeApp } = require('firebase-admin/app')
const { FieldValue, getFirestore } = require('firebase-admin/firestore')

const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...value] = argument.split('=')
  return [key, value.join('=') || true]
}))
const apply = args.has('--apply')
const selectedClientId = args.get('--client-id')
const projectId = args.get('--project') || 'gen-lang-client-0815966909'
const databaseId = args.get('--database') || 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'

function legacyAssignmentId(clientId, programId) {
  return `pt_${clientId}_${programId}`
}

function legacyCycleId(clientId, programId, versionId) {
  const digest = createHash('sha256')
    .update(`${clientId}\u0000${programId}\u0000${versionId}`)
    .digest('hex')
    .slice(0, 40)
  return `legacy_${digest}`
}

function nonEmptyString(value) {
  return typeof value === 'string' && Boolean(value.trim())
}

function assertExistingCycle(cycle, expected) {
  return cycle
    && cycle.schemaVersion === 2
    && cycle.domain === 'pt-coaching'
    && cycle.cycleId === expected.cycleId
    && cycle.clientId === expected.clientId
    && cycle.coachId === expected.coachId
    && cycle.programId === expected.programId
    && cycle.versionId === expected.versionId
}

async function main() {
  const app = initializeApp({ credential: applicationDefault(), projectId })
  const db = getFirestore(app, databaseId)
  const relationshipSnapshots = selectedClientId
    ? [await db.doc(`coachClients/${selectedClientId}`).get()]
    : (await db.collection('coachClients').get()).docs
  let eligible = 0
  let plannedCycles = 0
  let plannedPointers = 0
  let writtenCycles = 0
  let writtenPointers = 0
  let skipped = 0

  for (const relationshipSnapshot of relationshipSnapshots) {
    if (!relationshipSnapshot.exists) {
      console.warn(`SKIP missing coachClients/${selectedClientId}`)
      skipped += 1
      continue
    }
    const clientId = relationshipSnapshot.id
    const relationship = relationshipSnapshot.data()
    if (relationship.clientId !== clientId
        || !nonEmptyString(relationship.coachId)
        || !nonEmptyString(relationship.currentProgramId)
        || !nonEmptyString(relationship.currentVersionId)
        || !['active', 'paused', 'completed'].includes(relationship.coachingStatus)) {
      console.warn(`SKIP coachClients/${clientId}: no complete legacy assignment to backfill`)
      skipped += 1
      continue
    }
    eligible += 1
    const coachId = relationship.coachId.trim()
    const programId = relationship.currentProgramId.trim()
    const versionId = relationship.currentVersionId.trim()
    const cycleId = legacyCycleId(clientId, programId, versionId)
    const legacyId = legacyAssignmentId(clientId, programId)
    const cycleReference = db.doc(`programAssignmentCycles/${cycleId}`)
    const legacyReference = db.doc(`programAssignments/${legacyId}`)
    const [cycleSnapshot, legacySnapshot] = await Promise.all([
      cycleReference.get(),
      legacyReference.get(),
    ])
    const existingCycle = cycleSnapshot.data()
    if (cycleSnapshot.exists && (!assertExistingCycle(existingCycle, {
      cycleId,
      clientId,
      coachId,
      programId,
      versionId,
    }) || existingCycle.status !== relationship.coachingStatus)) {
      console.error(`CONFLICT programAssignmentCycles/${cycleId}: identity mismatch; no writes made for client`)
      skipped += 1
      continue
    }
    const legacy = legacySnapshot.data() ?? {}
    if (legacySnapshot.exists
        && (legacy.clientId !== clientId || legacy.coachId !== coachId || legacy.programId !== programId)) {
      console.error(`CONFLICT programAssignments/${legacyId}: identity mismatch; no writes made for client`)
      skipped += 1
      continue
    }

    const pointerField = relationship.coachingStatus === 'completed'
      ? 'lastAssignmentCycleId'
      : 'activeAssignmentCycleId'
    const needsCycle = !cycleSnapshot.exists
    const needsPointer = relationship[pointerField] !== cycleId
    if (relationship[pointerField] && relationship[pointerField] !== cycleId) {
      console.warn(`SKIP coachClients/${clientId}: ${pointerField} already points to another cycle`)
      skipped += 1
      continue
    }
    plannedCycles += needsCycle ? 1 : 0
    plannedPointers += needsPointer ? 1 : 0
    console.log(`${apply ? 'APPLY' : 'DRY'} coachClients/${clientId} -> programAssignmentCycles/${cycleId} (${relationship.coachingStatus}) cycle=${needsCycle ? 'create' : 'exists'} pointer=${needsPointer ? 'set' : 'exists'}`)
    if (!apply || (!needsCycle && !needsPointer)) continue

    await db.runTransaction(async (transaction) => {
      const freshRelationshipSnapshot = await transaction.get(relationshipSnapshot.ref)
      const freshCycleSnapshot = await transaction.get(cycleReference)
      const freshLegacySnapshot = await transaction.get(legacyReference)
      if (!freshRelationshipSnapshot.exists) throw new Error(`coachClients/${clientId} disappeared during migration`)
      const freshRelationship = freshRelationshipSnapshot.data()
      if (freshRelationship.clientId !== clientId
          || freshRelationship.coachId !== coachId
          || freshRelationship.currentProgramId !== programId
          || freshRelationship.currentVersionId !== versionId
          || freshRelationship.coachingStatus !== relationship.coachingStatus) {
        throw new Error(`coachClients/${clientId} assignment changed during migration`)
      }
      if (freshRelationship[pointerField] && freshRelationship[pointerField] !== cycleId) {
        throw new Error(`coachClients/${clientId}.${pointerField} changed during migration`)
      }
      if (freshCycleSnapshot.exists && (!assertExistingCycle(freshCycleSnapshot.data(), {
        cycleId,
        clientId,
        coachId,
        programId,
        versionId,
      }) || freshCycleSnapshot.data().status !== relationship.coachingStatus)) {
        throw new Error(`programAssignmentCycles/${cycleId} changed during migration`)
      }
      const freshLegacy = freshLegacySnapshot.data() ?? {}
      if (freshLegacySnapshot.exists
          && (freshLegacy.clientId !== clientId
              || freshLegacy.coachId !== coachId
              || freshLegacy.programId !== programId
              || freshLegacy.versionId !== versionId)) {
        throw new Error(`programAssignments/${legacyId} changed during migration`)
      }
      if (!freshCycleSnapshot.exists) {
        const startedAt = freshLegacy.startDate || freshRelationship.createdAt || FieldValue.serverTimestamp()
        const completed = relationship.coachingStatus === 'completed'
        transaction.create(cycleReference, {
          schemaVersion: 2,
          domain: 'pt-coaching',
          cycleId,
          clientId,
          coachId,
          programId,
          versionId,
          programTitleSnapshot: nonEmptyString(freshRelationship.currentProgramName)
            ? freshRelationship.currentProgramName.trim().slice(0, 200)
            : 'Giáo án PT Aura',
          status: relationship.coachingStatus,
          endReason: completed ? 'completed' : '',
          startedAt,
          progressStartedAt: startedAt,
          endedAt: completed ? freshLegacy.endDate || freshRelationship.updatedAt || FieldValue.serverTimestamp() : null,
          source: 'legacy-backfill',
          legacyAssignmentId: legacyId,
          historyCompleteness: 'legacy-collapsed',
          createdBy: 'migration:backfill-pt-assignment-cycles',
          updatedBy: 'migration:backfill-pt-assignment-cycles',
          createdAt: freshLegacy.createdAt || FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
      if (freshRelationship[pointerField] !== cycleId) {
        transaction.set(relationshipSnapshot.ref, {
          [pointerField]: cycleId,
          ...(pointerField === 'activeAssignmentCycleId' ? { lastAssignmentCycleId: freshRelationship.lastAssignmentCycleId || '' } : {}),
          ...(pointerField === 'lastAssignmentCycleId' ? { activeAssignmentCycleId: '' } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      }
    })
    writtenCycles += needsCycle ? 1 : 0
    writtenPointers += needsPointer ? 1 : 0
  }

  console.log(`Done. eligible=${eligible}, plannedCycles=${plannedCycles}, plannedPointers=${plannedPointers}, writtenCycles=${writtenCycles}, writtenPointers=${writtenPointers}, skipped=${skipped}, mode=${apply ? 'apply' : 'dry-run'}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
