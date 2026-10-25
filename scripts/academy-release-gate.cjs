'use strict'

// Read-only release checks. This helper cannot publish content, grant reviewer
// status, change IAM, migrate data, deploy functions or roll back privacy rules.
const fs = require('node:fs')
const path = require('node:path')
const { PROJECT, DATABASE, RELEASE, sourceHash, expectedSource, verifyRulesRelease } = require('./firebase-firestore-rules-verify.cjs')
const STORAGE_BUCKET = 'gen-lang-client-0815966909.firebasestorage.app'
const STORAGE_RELEASE = `projects/${PROJECT}/releases/firebase.storage/${STORAGE_BUCKET}`
const RUNTIME_TARGETS = [
  'academySubmissionAction', 'completeCourseLesson', 'enrollInCourse',
  'getCourseMediaUrl', 'getCourseMediaUrlRegional', 'getCourseRevisionDiff',
  'getCourseRevisionHistory', 'getCourseWorkoutSession', 'gradeCourseQuiz',
  'listAcademyCourses', 'listAcademyCoursesRegional', 'manageAcademyEnrollment', 'saveCourseWorkoutLog',
]
// Old editors cannot invoke these new writers without the chapter protocol.
// Install the last legacy-to-chapter writer only after the other two are fenced.
const AUTHORING_TARGETS = ['restoreCourseRevisionToDraft', 'transitionCoursePublicationStatus', 'saveCourseDraftAtomic']
const TARGETS = [...RUNTIME_TARGETS, ...AUTHORING_TARGETS]

function validateScope({ enabled, backendOnly, targets }) {
  if (!['true', 'false', ''].includes(enabled) || !['true', 'false', ''].includes(backendOnly)) throw Error('Invalid Academy release mode.')
  const requested = targets ? targets.split(',') : []
  if (enabled !== 'true') {
    if (requested.some(name => TARGETS.includes(name))) throw Error('Academy targets require the reviewed Academy release mode.')
    return { academy: false }
  }
  if (backendOnly !== 'true' || JSON.stringify(requested) !== JSON.stringify(TARGETS)) {
    throw Error('Academy requires backend_only=true and the exact 16 targets in runtime-before-authoring order.')
  }
  return { academy: true, project: PROJECT, database: DATABASE, targets: [...TARGETS], automaticRollback: false, contentPublication: false }
}

async function verifyStorageRules({ getJson, source }) {
  const release = await getJson(STORAGE_RELEASE)
  const valid = value => value?.name === STORAGE_RELEASE && value?.updateTime
    && new RegExp(`^projects/${PROJECT}/rulesets/[a-zA-Z0-9-]+$`).test(value?.rulesetName || '')
  if (!valid(release)) throw Error('Unexpected Academy Storage rules release.')
  const ruleset = await getJson(release.rulesetName)
  const files = ruleset?.source?.files
  if (ruleset?.name !== release.rulesetName || !Array.isArray(files) || files.length !== 1
      || files[0].name !== 'storage.rules' || typeof files[0].content !== 'string'
      || sourceHash(files[0].content) !== sourceHash(source)) throw Error('Academy Storage rules differ from reviewed source.')
  const current = await getJson(STORAGE_RELEASE)
  if (!valid(current) || current.rulesetName !== release.rulesetName || current.updateTime !== release.updateTime) {
    throw Error('Academy Storage rules changed during verification.')
  }
  return { release: STORAGE_RELEASE, ruleset: release.rulesetName, sourceHash: sourceHash(source), sourceVerified: true }
}

async function accessToken() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_GHA_CREDS_PATH) {
    const { GoogleAuth } = require('google-auth-library')
    const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient()
    const value = await client.getAccessToken()
    const token = typeof value === 'string' ? value : value?.token
    if (!token) throw Error('Academy deploy identity unavailable.')
    return token
  }
  if (!process.env.APPDATA) throw Error('Academy deploy identity unavailable.')
  const auth = require(path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib/auth.js'))
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw Error('Academy deploy identity unavailable.')
  const token = (await auth.getAccessToken(account.tokens.refresh_token, [])).access_token
  if (!token) throw Error('Academy deploy identity unavailable.')
  return token
}

async function main() {
  const mode = process.argv[2]
  if (process.argv.length !== 3 || !['validate', 'verify-rules'].includes(mode)) throw Error('Usage: academy-release-gate.cjs validate|verify-rules')
  if (mode === 'validate') {
    console.log(JSON.stringify(validateScope({ enabled: process.env.ACADEMY_RELEASE || 'false',
      backendOnly: process.env.BACKEND_ONLY || 'false', targets: process.env.BACKEND_FUNCTIONS || '' })))
    return
  }
  const firestoreSource = expectedSource()
  const config = JSON.parse(fs.readFileSync('firebase.json', 'utf8'))
  if (config.storage?.rules !== 'storage.rules' || config.storage?.target) throw Error('Unexpected Academy Storage configuration.')
  const storageSource = fs.readFileSync('storage.rules', 'utf8'), token = await accessToken()
  const getJson = async resource => {
    if (![RELEASE, STORAGE_RELEASE].includes(resource)
        && !new RegExp(`^projects/${PROJECT}/rulesets/[a-zA-Z0-9-]+$`).test(resource)) throw Error('Unexpected Academy rules resource.')
    const response = await fetch('https://firebaserules.googleapis.com/v1/' + resource, {
      headers: { authorization: 'Bearer ' + token }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) throw Error('Academy rules metadata HTTP ' + response.status)
    return response.json()
  }
  const firestore = await verifyRulesRelease({ getJson, source: firestoreSource })
  const storage = await verifyStorageRules({ getJson, source: storageSource })
  console.log(JSON.stringify({ observedAt: new Date().toISOString(), firestore, storage, sourceVerified: true }))
}
if (require.main === module) main().catch(error => {
  const message = error?.message || ''
  console.error(/^(Academy |Unexpected Academy |Invalid Academy |Usage: |Deployed Firestore |Firestore rules release |Unexpected named|Unexpected deployed|The named production)/.test(message)
    ? message : 'Academy release verification failed; request details omitted.')
  process.exitCode = 1
})
module.exports = { TARGETS, RUNTIME_TARGETS, AUTHORING_TARGETS, STORAGE_RELEASE, validateScope, verifyStorageRules }
