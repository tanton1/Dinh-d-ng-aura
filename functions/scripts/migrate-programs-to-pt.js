'use strict'

const { applicationDefault, initializeApp } = require('firebase-admin/app')
const { FieldValue, getFirestore } = require('firebase-admin/firestore')

const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...value] = argument.split('=')
  return [key, value.join('=') || true]
}))
const apply = args.has('--apply')
const overwrite = args.has('--overwrite')
const fallbackCoachId = args.get('--coach-id')
const selectedProgramId = args.get('--program-id')
const projectId = args.get('--project') || 'gen-lang-client-0815966909'
const databaseId = args.get('--database') || 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'

function integerInRange(value, fallback, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback
}

function knownStatus(value) {
  return ['draft', 'review', 'published', 'archived'].includes(value) ? value : 'draft'
}

async function main() {
  const app = initializeApp({ credential: applicationDefault(), projectId })
  const db = getFirestore(app, databaseId)
  const sourceSnapshots = selectedProgramId
    ? [await db.doc(`programs/${selectedProgramId}`).get()]
    : (await db.collection('programs').get()).docs
  let planned = 0
  let written = 0

  for (const sourceSnapshot of sourceSnapshots) {
    if (!sourceSnapshot.exists) {
      console.warn(`SKIP missing programs/${selectedProgramId}`)
      continue
    }
    const programId = sourceSnapshot.id
    const source = sourceSnapshot.data()
    const coachId = source.coachId || source.createdBy || fallbackCoachId
    if (typeof coachId !== 'string' || !coachId.trim()) {
      console.warn(`SKIP programs/${programId}: missing coachId; pass --coach-id=<uid>`)
      continue
    }

    const versionSnapshots = await sourceSnapshot.ref.collection('versions').get()
    const currentVersionId = typeof source.currentVersionId === 'string' && source.currentVersionId
      ? source.currentVersionId
      : versionSnapshots.docs.find((item) => item.data().status === 'published')?.id
        || versionSnapshots.docs[0]?.id
    if (!currentVersionId || !versionSnapshots.size) {
      console.warn(`SKIP programs/${programId}: no immutable version snapshot`)
      continue
    }
    const destinationReference = db.doc(`coachingPrograms/${programId}`)
    const destinationSnapshot = await destinationReference.get()
    if (destinationSnapshot.exists && !overwrite) {
      console.warn(`SKIP coachingPrograms/${programId}: already exists (use --overwrite intentionally)`)
      continue
    }

    planned += 1
    console.log(`${apply ? 'APPLY' : 'DRY'} programs/${programId} -> coachingPrograms/${programId} (${versionSnapshots.size} versions)`)
    if (!apply) continue

    const batch = db.batch()
    batch.set(destinationReference, {
      domain: 'pt-coaching',
      schemaVersion: 2,
      coachId: coachId.trim(),
      title: typeof source.title === 'string' ? source.title : 'Giáo án PT Aura',
      description: typeof source.description === 'string' ? source.description : '',
      durationWeeks: integerInRange(source.durationWeeks, 4, 1, 52),
      daysPerWeek: integerInRange(source.daysPerWeek, 3, 1, 7),
      status: knownStatus(source.status),
      currentVersionId,
      createdAt: source.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    versionSnapshots.docs.forEach((versionSnapshot) => {
      const version = versionSnapshot.data()
      const versionId = versionSnapshot.id
      const versionWrite = {
        programId,
        versionId,
        schemaVersion: 2,
        domain: 'pt-coaching',
        coachId: coachId.trim(),
        title: typeof version.title === 'string' ? version.title : source.title || 'Giáo án PT Aura',
        description: typeof version.description === 'string' ? version.description : source.description || '',
        durationWeeks: integerInRange(version.durationWeeks, integerInRange(source.durationWeeks, 4, 1, 52), 1, 52),
        daysPerWeek: integerInRange(version.daysPerWeek, integerInRange(source.daysPerWeek, 3, 1, 7), 1, 7),
        status: ['draft', 'review', 'published'].includes(version.status)
          ? version.status
          : knownStatus(source.status) === 'published' ? 'published' : 'draft',
        sessionsByDay: version.sessionsByDay && typeof version.sessionsByDay === 'object'
          ? version.sessionsByDay
          : {},
        createdAt: version.createdAt || FieldValue.serverTimestamp(),
      }
      if (version.weeksByWeek && typeof version.weeksByWeek === 'object') {
        versionWrite.weeksByWeek = version.weeksByWeek
      }
      batch.set(destinationReference.collection('versions').doc(versionId), versionWrite)
    })
    await batch.commit()
    written += 1
  }

  console.log(`Done. planned=${planned}, written=${written}, mode=${apply ? 'apply' : 'dry-run'}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
