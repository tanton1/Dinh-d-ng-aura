'use strict'

// Derived directory only: never edits profiles, wallets, points or financial
// evidence. Default is read-only; apply is pinned to the named Aura database.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createRequire } = require('node:module')
const functionsRequire = createRequire(path.resolve(__dirname, '../functions/package.json'))
const { Firestore, FieldPath, FieldValue } = functionsRequire('@google-cloud/firestore')
const { GoogleAuth, OAuth2Client } = functionsRequire('google-auth-library')
const { accessToken, assertTarget } = require('./firebase-firestore-index-deploy.cjs')
const { DIRECTORY_STATE, DIRECTORY_COLLECTION, DIRECTORY_VERSION, syncLoyaltyMemberDirectory } = require('../functions/loyalty-member-directory')
const PROJECT = 'gen-lang-client-0815966909'
const DATABASE = 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'
const CONFIRM = `projects/${PROJECT}/databases/${DATABASE}:rebuild-loyalty-member-directory`

async function main() {
  const [mode = 'dry-run', ...args] = process.argv.slice(2)
  if (!['dry-run', 'apply'].includes(mode)) throw Error('Use dry-run or apply.')
  const flags = Object.fromEntries(args.map(arg => { const split = arg.indexOf('='); if (!arg.startsWith('--') || split < 3) throw Error('Invalid flag.'); return [arg.slice(2, split), arg.slice(split + 1)] }))
  if (Object.keys(flags).some(key => !['confirm', 'expected-sha'].includes(key))) throw Error('Unknown flag.')
  if (process.env.FIRESTORE_EMULATOR_HOST) throw Error('Unset emulator variables before an explicit production backfill.')
  const root = path.resolve(__dirname, '..')
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  if (mode === 'apply') {
    if (flags.confirm !== CONFIRM || flags['expected-sha'] !== sha) throw Error('Exact database and source revision confirmation required.')
    if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) throw Error('Apply requires a clean committed worktree.')
  }
  await assertTarget(await accessToken())
  const authClient = new OAuth2Client()
  authClient.refreshHandler = async () => ({ access_token: await accessToken(), expiry_date: Date.now() + 45 * 60 * 1000 })
  const db = new Firestore({ projectId: PROJECT, databaseId: DATABASE, auth: new GoogleAuth({ projectId: PROJECT, authClient }) })
  const report = { mode, sourceCommit: sha, database: DATABASE, startedAt: new Date().toISOString(), profilesExamined: 0, directoryChanged: 0, managedMembers: 0, orphansRemoved: 0, sourceWrites: 0 }
  try {
    if (mode === 'apply') await db.doc(DIRECTORY_STATE).set({ schemaVersion: DIRECTORY_VERSION, status: 'building', sourceCommit: sha, startedAt: FieldValue.serverTimestamp() })
    let cursor
    do {
      let query = db.collection('students').orderBy(FieldPath.documentId()).select('loyaltyMembership', 'status', 'accountDeletedAt').limit(200)
      if (cursor) query = query.startAfter(cursor)
      const page = await query.get()
      report.profilesExamined += page.size
      if (mode === 'apply') {
        for (let start = 0; start < page.size; start += 8) {
          const results = await Promise.all(page.docs.slice(start, start + 8).map(item => syncLoyaltyMemberDirectory({ db, studentId: item.id })))
          report.directoryChanged += results.filter(result => result.changed).length
          report.managedMembers += results.filter(result => result.present).length
        }
      } else report.managedMembers += page.docs.filter(item => item.data().loyaltyMembership?.managed && item.data().status !== 'inactive' && !item.data().accountDeletedAt).length
      cursor = page.size === 200 ? page.docs.at(-1).id : null
    } while (cursor)
    if (mode === 'apply') {
      // Replays also remove old rows whose profile was deleted before triggers
      // were installed. Each deletion rechecks current source transactionally.
      let directoryCursor
      do {
        let query = db.collection(DIRECTORY_COLLECTION).orderBy(FieldPath.documentId()).select().limit(200)
        if (directoryCursor) query = query.startAfter(directoryCursor)
        const page = await query.get()
        const profiles = page.size ? await db.getAll(...page.docs.map(item => db.doc(`students/${item.id}`))) : []
        for (const profile of profiles.filter(item => !item.exists)) {
          const result = await syncLoyaltyMemberDirectory({ db, studentId: profile.id })
          if (result.changed && !result.present) report.orphansRemoved++
        }
        directoryCursor = page.size === 200 ? page.docs.at(-1).id : null
      } while (directoryCursor)
      report.directoryCount = Number((await db.collection(DIRECTORY_COLLECTION).count().get()).data().count)
      await db.doc(DIRECTORY_STATE).set({ schemaVersion: DIRECTORY_VERSION, status: 'ready', sourceCommit: sha, profilesExamined: report.profilesExamined, completedAt: FieldValue.serverTimestamp() }, { merge: true })
    }
    report.completedAt = new Date().toISOString()
    const directory = path.join(root, '.tools'); fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, `loyalty-directory-backfill-${mode}-${Date.now()}.json`), JSON.stringify(report, null, 2)+'\n')
    console.log(JSON.stringify(report, null, 2))
  } finally { await db.terminate() }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { CONFIRM, PROJECT, DATABASE }
