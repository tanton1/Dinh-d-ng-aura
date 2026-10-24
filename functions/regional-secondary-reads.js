'use strict'

const { createCashbookFunctions } = require('./cashbook')
const { createFinanceLedgerFunctions } = require('./finance-ledger')
const { createContractRenewalFunctions } = require('./contract-renewals')
const { createIdentityAccessFunctions } = require('./identity-access')
const { createLoyaltyFunctions } = require('./loyalty')

const SECONDARY_READ_OPTIONS = Object.freeze({
  memory: '256MiB',
  cpu: 0.1666,
  minInstances: 0,
  maxInstances: 2,
  concurrency: 1,
  timeoutSeconds: 60,
})
const SECONDARY_READ_TARGETS = Object.freeze([
  Object.freeze({ name: 'listAccountingCatalogRegional', canonical: 'listAccountingCatalog', factory: 'cashbook', region: 'asia-east1' }),
  Object.freeze({ name: 'listCashAccountsRegional', canonical: 'listCashAccounts', factory: 'cashbook', region: 'asia-east1' }),
  Object.freeze({ name: 'listCashTransactionsRegional', canonical: 'listCashTransactions', factory: 'cashbook', region: 'asia-east1' }),
  Object.freeze({ name: 'listExpenseVouchersRegional', canonical: 'listExpenseVouchers', factory: 'cashbook', region: 'asia-east1' }),
  Object.freeze({ name: 'listFinanceLedgerRegional', canonical: 'listFinanceLedger', factory: 'finance', region: 'asia-east1' }),
  Object.freeze({ name: 'listRenewalMessageTemplatesRegional', canonical: 'listRenewalMessageTemplates', factory: 'renewal', region: 'asia-east1' }),
  Object.freeze({ name: 'listContractRenewalCasesRegional', canonical: 'listContractRenewalCases', factory: 'renewal', region: 'asia-east1' }),
  Object.freeze({ name: 'listLoyaltyAccountsRegional', canonical: 'listLoyaltyAccounts', factory: 'loyalty', region: 'asia-southeast2' }),
  Object.freeze({ name: 'getExerciseCatalogItemRegional', canonical: 'getExerciseCatalogItem', factory: 'exercise', region: 'asia-southeast2' }),
  Object.freeze({ name: 'getInternalNutritionCatalogItemRegional', canonical: 'getInternalNutritionCatalogItem', factory: 'identity', region: 'asia-southeast2' }),
])

// Capture the original callable definitions without registering SDK endpoints
// for unrelated writes, external-provider reads, or background jobs. The only
// real onCall registrations below are the explicit, reviewed read allow-list.
function callableDefinition(optionsOrHandler, maybeHandler) {
  return typeof optionsOrHandler === 'function'
    ? { options: {}, handler: optionsOrHandler }
    : { options: { ...optionsOrHandler }, handler: maybeHandler }
}

function createRegionalSecondaryReadAliases({ db, auth, onCall, logger, includeExerciseCatalog = true }) {
  if (!db || typeof onCall !== 'function') throw new Error('Regional secondary reads require the canonical database and callable wrapper.')
  const definitions = {
    cashbook: createCashbookFunctions({ db, onCall: callableDefinition }),
    finance: createFinanceLedgerFunctions({ db, onCall: callableDefinition }),
    // Intentionally omit onSchedule: renewal reconciliation stays single-active.
    renewal: createContractRenewalFunctions({ db, onCall: callableDefinition, logger }),
    identity: createIdentityAccessFunctions({ db, auth, onCall: callableDefinition, logger }),
    loyalty: createLoyaltyFunctions({ db, onCall: callableDefinition, logger }),
  }
  if (includeExerciseCatalog) {
    // Preserve the existing Student360 discovery boundary: loading the exercise
    // module there would declare an unrelated external-provider secret.
    definitions.exercise = require('./exercise-catalog').createExerciseCatalogFunctions({ db, onCall: callableDefinition })
  }
  const aliases = {}
  for (const target of SECONDARY_READ_TARGETS) {
    if (target.factory === 'exercise' && !includeExerciseCatalog) continue
    const definition = definitions[target.factory]?.[target.canonical]
    if (typeof definition?.handler !== 'function') throw new Error(`Missing canonical read definition: ${target.canonical}`)
    aliases[target.name] = onCall({
      ...definition.options,
      ...SECONDARY_READ_OPTIONS,
      // Keep the cash-account reader's existing stricter single-instance cap.
      maxInstances: Math.min(definition.options.maxInstances ?? SECONDARY_READ_OPTIONS.maxInstances, SECONDARY_READ_OPTIONS.maxInstances),
      region: target.region,
    }, definition.handler)
  }
  return aliases
}

module.exports = { createRegionalSecondaryReadAliases, SECONDARY_READ_OPTIONS, SECONDARY_READ_TARGETS }
