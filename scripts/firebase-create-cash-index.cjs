'use strict'
const path = require('node:path')
const projectId = 'gen-lang-client-0815966909'
const databaseId = 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'
async function main() {
  const cliLib = path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'firebase-tools', 'lib')
  const auth = require(path.join(cliLib, 'auth.js'))
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI is not signed in.')
  const token = await auth.getAccessToken(account.tokens.refresh_token, [])
  const endpoint = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/collectionGroups/cashTransactions/indexes`
  const headers = { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' }
  const list = await fetch(endpoint, { headers })
  if (!list.ok) throw new Error(`Cannot list cash indexes (${list.status}).`)
  const existing = await list.json()
  const found = (existing.indexes || []).some((index) => index.queryScope === 'COLLECTION' && index.fields?.some((field) => field.fieldPath === 'accountId' && field.order === 'ASCENDING') && index.fields?.some((field) => field.fieldPath === 'effectiveAt' && field.order === 'DESCENDING'))
  if (found) { console.log(JSON.stringify({ unchanged: true, collectionGroup: 'cashTransactions' })); return }
  const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ queryScope: 'COLLECTION', fields: [{ fieldPath: 'accountId', order: 'ASCENDING' }, { fieldPath: 'effectiveAt', order: 'DESCENDING' }] }) })
  if (!response.ok) throw new Error(`Cannot create cash index (${response.status}).`)
  const operation = await response.json()
  console.log(JSON.stringify({ unchanged: false, collectionGroup: 'cashTransactions', operation: operation.name || '' }))
}
main().catch((error) => { console.error(error.message); process.exitCode = 1 })
