'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const PROJECT = 'gen-lang-client-0815966909'
const DATABASE = 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'
const RELEASE = `projects/${PROJECT}/releases/cloud.firestore/${DATABASE}`
const RULESET = new RegExp(`^projects/${PROJECT}/rulesets/[a-zA-Z0-9-]+$`)
const sourceHash = value => createHash('sha256').update(value.replace(/\r\n/g, '\n')).digest('hex')

function expectedSource(root = process.cwd()) {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'))
  const databases = Array.isArray(config.firestore) ? config.firestore : [config.firestore]
  const targets = databases.filter(value => value?.database === DATABASE)
  if (targets.length !== 1 || targets[0].rules !== 'firestore.rules' || targets[0].target) {
    throw Error('The named production database must resolve to one explicit firestore.rules source.')
  }
  return fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8')
}

function assertRelease(release) {
  if (release?.name !== RELEASE || !RULESET.test(release.rulesetName || '') || !release.updateTime) {
    throw Error('Unexpected named-database rules release.')
  }
}

async function verifyRulesRelease({ getJson, source }) {
  const release = await getJson(RELEASE)
  assertRelease(release)
  const ruleset = await getJson(release.rulesetName)
  const files = ruleset?.source?.files
  if (ruleset?.name !== release.rulesetName || !Array.isArray(files) || files.length !== 1
    || files[0].name !== 'firestore.rules' || typeof files[0].content !== 'string') {
    throw Error('Unexpected deployed rules source files.')
  }
  const expectedHash = sourceHash(source), deployedHash = sourceHash(files[0].content)
  if (expectedHash !== deployedHash) throw Error('Deployed Firestore rules do not match the reviewed source.')
  // A concurrent release cannot pass using an already superseded ruleset.
  const current = await getJson(RELEASE)
  assertRelease(current)
  if (current.rulesetName !== release.rulesetName || current.updateTime !== release.updateTime) {
    throw Error('Firestore rules release changed during verification.')
  }
  return { observedAt: new Date().toISOString(), database: DATABASE, release: RELEASE,
    ruleset: release.rulesetName, releaseUpdatedAt: release.updateTime,
    expectedHash, deployedHash, sourceVerified: true }
}

async function accessToken() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_GHA_CREDS_PATH) {
    const { GoogleAuth } = require('google-auth-library')
    const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient()
    const value = await client.getAccessToken()
    const token = typeof value === 'string' ? value : value?.token
    if (!token) throw Error('Google deploy identity is unavailable.')
    return token
  }
  if (!process.env.APPDATA) throw Error('Google deploy identity is unavailable.')
  const auth = require(path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib/auth.js'))
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw Error('Firebase CLI is not signed in.')
  const token = (await auth.getAccessToken(account.tokens.refresh_token, [])).access_token
  if (!token) throw Error('Firebase CLI identity is unavailable.')
  return token
}

async function main() {
  if (process.argv.length !== 2) throw Error('Usage: node scripts/firebase-firestore-rules-verify.cjs')
  const source = expectedSource(), token = await accessToken()
  const getJson = async resource => {
    if (resource !== RELEASE && !RULESET.test(resource)) throw Error('Unexpected rules metadata resource.')
    const response = await fetch('https://firebaserules.googleapis.com/v1/' + resource, {
      headers: { authorization: 'Bearer ' + token }, redirect: 'error',
      cache: 'no-store', signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) throw Error('Rules metadata HTTP ' + response.status)
    return response.json()
  }
  console.log(JSON.stringify(await verifyRulesRelease({ getJson, source }), null, 2))
}

if (require.main === module) main().catch(error => {
  // Never print response bodies, auth objects or token-bearing request options.
  const message = error?.message || ''
  console.error(/^(Unexpected |Deployed Firestore |Firestore rules release |The named production |Usage: |Rules metadata HTTP |Google deploy identity |Firebase CLI )/.test(message)
    ? message : 'Firestore rules verification failed; request details omitted.')
  process.exitCode = 1
})

module.exports = { PROJECT, DATABASE, RELEASE, expectedSource, sourceHash, verifyRulesRelease }
