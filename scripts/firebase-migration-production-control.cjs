const fs = require('node:fs')
const path = require('node:path')

const TARGET_PROJECT = 'gen-lang-client-0815966909'
const TARGET_DATABASE = 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'
const STATE_PATH = path.resolve('.migration-private/production-control-state.json')
const PUSH_DOCUMENT_URL = `https://firestore.googleapis.com/v1/projects/${TARGET_PROJECT}/databases/${TARGET_DATABASE}/documents/system/push_settings`
const DATABASE_URL = `https://firestore.googleapis.com/v1/projects/${TARGET_PROJECT}/databases/${TARGET_DATABASE}`

function cliAuth() {
  const cliLib = path.join(process.env.APPDATA, 'npm', 'node_modules', 'firebase-tools', 'lib')
  const auth = require(path.join(cliLib, 'auth.js'))
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI is not signed in.')
  return { auth, account }
}

async function token() {
  const { auth, account } = cliAuth()
  const result = await auth.getAccessToken(account.tokens.refresh_token, [])
  if (!result?.access_token) throw new Error('Unable to obtain OAuth access token.')
  return result.access_token
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
  const body = raw ? JSON.parse(raw) : null
  if (!response.ok && !(options.allowStatuses || []).includes(response.status)) {
    throw new Error(`${response.status} ${body?.error?.message || response.statusText}`)
  }
  return { status: response.status, body }
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) } catch { return {} }
}

function writeState(value) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

function requireProductionConfirmation() {
  const expected = `--confirm-production-target=${TARGET_PROJECT}`
  if (!process.argv.includes(expected)) throw new Error(`Production mutation requires ${expected}.`)
}

function booleanField(document, fieldName) {
  const value = document?.fields?.[fieldName]
  return {
    existed: Boolean(value && Object.prototype.hasOwnProperty.call(value, 'booleanValue')),
    value: value?.booleanValue === true,
  }
}

async function getPushSettings(accessToken) {
  return requestJson(accessToken, PUSH_DOCUMENT_URL, { allowStatuses: [404] })
}

async function patchPushSettings(accessToken, fields, masks) {
  const query = masks.map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join('&')
  return requestJson(accessToken, `${PUSH_DOCUMENT_URL}?${query}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields }),
  })
}

async function status(accessToken) {
  const response = await getPushSettings(accessToken)
  console.log(JSON.stringify({
    targetProject: TARGET_PROJECT,
    targetDatabase: TARGET_DATABASE,
    documentExists: response.status === 200,
    enabled: response.body?.fields?.enabled?.booleanValue ?? null,
    automationEnabled: response.body?.fields?.automationEnabled?.booleanValue ?? null,
    migrationMaintenance: response.body?.fields?.migrationMaintenance?.booleanValue ?? null,
    updateTime: response.body?.updateTime || null,
    hasSavedRestorePoint: Boolean(readState().pushSettingsRestorePoint),
  }, null, 2))
}

async function disableReminders(accessToken) {
  requireProductionConfirmation()
  const current = await getPushSettings(accessToken)
  if (current.status !== 200) throw new Error('system/push_settings is missing; refusing to create production configuration implicitly.')
  const state = readState()
  if (!state.pushSettingsRestorePoint) {
    state.pushSettingsRestorePoint = {
      enabled: booleanField(current.body, 'enabled'),
      automationEnabled: booleanField(current.body, 'automationEnabled'),
      documentUpdateTime: current.body.updateTime || null,
      capturedAt: new Date().toISOString(),
    }
  }
  state.remindersDisabledAt = new Date().toISOString()
  writeState(state)
  await patchPushSettings(accessToken, {
    enabled: { booleanValue: false },
    automationEnabled: { booleanValue: false },
    migrationMaintenance: { booleanValue: true },
    migrationMaintenanceStartedAt: { timestampValue: state.remindersDisabledAt },
  }, ['enabled', 'automationEnabled', 'migrationMaintenance', 'migrationMaintenanceStartedAt'])
  await status(accessToken)
}

async function restoreReminders(accessToken) {
  requireProductionConfirmation()
  const state = readState()
  const restorePoint = state.pushSettingsRestorePoint
  if (!restorePoint) throw new Error('No saved push settings restore point exists.')
  const fields = {}
  if (restorePoint.enabled.existed) fields.enabled = { booleanValue: restorePoint.enabled.value }
  if (restorePoint.automationEnabled.existed) fields.automationEnabled = { booleanValue: restorePoint.automationEnabled.value }
  await patchPushSettings(accessToken, fields, [
    'enabled',
    'automationEnabled',
    'migrationMaintenance',
    'migrationMaintenanceStartedAt',
  ])
  state.remindersRestoredAt = new Date().toISOString()
  writeState(state)
  await status(accessToken)
}

async function databaseStatus(accessToken) {
  const response = await requestJson(accessToken, DATABASE_URL)
  console.log(JSON.stringify({
    targetProject: TARGET_PROJECT,
    targetDatabase: TARGET_DATABASE,
    locationId: response.body?.locationId || null,
    pointInTimeRecoveryEnablement: response.body?.pointInTimeRecoveryEnablement || null,
    deleteProtectionState: response.body?.deleteProtectionState || null,
    earliestVersionTime: response.body?.earliestVersionTime || null,
  }, null, 2))
}

async function protectDatabase(accessToken) {
  requireProductionConfirmation()
  const current = await requestJson(accessToken, DATABASE_URL)
  const state = readState()
  if (!state.databaseProtectionRestorePoint) {
    state.databaseProtectionRestorePoint = {
      pointInTimeRecoveryEnablement: current.body?.pointInTimeRecoveryEnablement || null,
      deleteProtectionState: current.body?.deleteProtectionState || null,
      capturedAt: new Date().toISOString(),
    }
  }
  state.databaseProtectedAt = new Date().toISOString()
  writeState(state)
  const updateMask = encodeURIComponent('pointInTimeRecoveryEnablement,deleteProtectionState')
  await requestJson(accessToken, `${DATABASE_URL}?updateMask=${updateMask}`, {
    method: 'PATCH',
    body: JSON.stringify({
      name: `projects/${TARGET_PROJECT}/databases/${TARGET_DATABASE}`,
      pointInTimeRecoveryEnablement: 'POINT_IN_TIME_RECOVERY_ENABLED',
      deleteProtectionState: 'DELETE_PROTECTION_ENABLED',
    }),
  })
  await databaseStatus(accessToken)
}

async function main() {
  const action = process.argv[2]
  const accessToken = await token()
  if (action === 'status') return status(accessToken)
  if (action === 'database-status') return databaseStatus(accessToken)
  if (action === 'disable-reminders') return disableReminders(accessToken)
  if (action === 'restore-reminders') return restoreReminders(accessToken)
  if (action === 'protect-database') return protectDatabase(accessToken)
  throw new Error('Unknown action. Use status, database-status, disable-reminders, restore-reminders, or protect-database.')
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
