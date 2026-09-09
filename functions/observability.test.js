'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { domainForOperation, errorTaxonomy, retryableError } = require('./observability')

test('observability maps callable failures to the Aura error taxonomy', () => {
  assert.equal(errorTaxonomy('functions/unauthenticated'), 'AUTH')
  assert.equal(errorTaxonomy('permission-denied'), 'PERMISSION')
  assert.equal(errorTaxonomy('invalid-argument'), 'VALIDATION')
  assert.equal(errorTaxonomy('failed-precondition'), 'BUSINESS_RULE')
  assert.equal(errorTaxonomy('aborted'), 'CONFLICT')
  assert.equal(errorTaxonomy('deadline-exceeded'), 'TIMEOUT')
  assert.equal(errorTaxonomy('unavailable'), 'DEPENDENCY')
  assert.equal(errorTaxonomy('unknown'), 'INTERNAL')
})

test('observability identifies retryable infrastructure errors', () => {
  assert.equal(retryableError('unavailable'), true)
  assert.equal(retryableError('deadline-exceeded'), true)
  assert.equal(retryableError('permission-denied'), false)
})

test('operation names receive stable domain labels', () => {
  assert.equal(domainForOperation('getStudent360Overview'), 'student360')
  assert.equal(domainForOperation('reconcileContractUsage'), 'contract')
  assert.equal(domainForOperation('listOperationalActions'), 'action')
  assert.equal(domainForOperation('saveMealReview'), 'nutrition')
})

test('sales, finance and people operations receive product domains', () => {
  assert.equal(domainForOperation('createSalesQuote'), 'sales')
  assert.equal(domainForOperation('postFinanceLedgerEntry'), 'finance')
  assert.equal(domainForOperation('getMyPerformanceScore'), 'people')
})
