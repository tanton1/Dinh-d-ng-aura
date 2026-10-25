'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { auditProject, renderReport, operationHint } = require('./audit-callable-usage.cjs')

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-callable-audit-test-'))
  t.after(() => {
    const resolved = path.resolve(root)
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()))
    assert.ok(path.basename(resolved).startsWith('aura-callable-audit-test-'))
    fs.rmSync(resolved, { recursive: true, force: true })
  })
  const contents = {
    'node_modules/firebase/package.json': '{"name":"firebase","types":"functions.d.ts"}',
    'node_modules/firebase/functions.d.ts': 'export declare function httpsCallable<I, O>(client: unknown, name: string): (data: I) => Promise<O>; export declare function getFunctions(app: unknown, region: string): unknown;',
    ...files,
  }
  for (const [file, content] of Object.entries(contents)) {
    const target = path.join(root, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  return root
}

test('follows generic renamed transports, wrapper suffixes and literal lazy imports, excluding comments/types', (t) => {
  const root = fixture(t, {
    'src/clients.ts': "import { getFunctions } from 'firebase/functions'; export let primary: unknown = null; primary = getFunctions({}, 'asia-east1');",
    'src/service.ts': `import { httpsCallable as rpc } from 'firebase/functions'; import { primary } from './clients';
      export interface Shape { value: string }
      function call<I, O>(name: string, input: I) { return rpc<I, O>(primary, \`\${name}V2\`)(input) }
      export function load() { return call('getLedger', { note: 'notAnEndpoint' }) }
      // httpsCallable(primary, 'commentOnly')
      type Example = 'typeOnlyEndpoint';`,
    'src/Page.tsx': "import { load } from './service'; export function Page() { load(); return null }",
    'src/LazyPage.tsx': "export const load = () => import('./service')",
    'src/TypesPage.tsx': "import type { Shape } from './service'; export const value: Shape = { value: '' }",
    'functions/index.js': "exports.getLedgerV2 = onCall(async () => ({}));",
  })
  const report = auditProject(root)
  assert.deepEqual(report.frontendCallables.map((row) => row.name), ['getLedgerV2'])
  const endpoint = report.frontendCallables[0]
  assert.deepEqual(endpoint.uiModuleReachability, ['src/LazyPage.tsx', 'src/Page.tsx'])
  assert.ok(endpoint.references.some((row) => row.possibleRegions.includes('asia-east1')))
  assert.equal(report.coverage.directTransportSites, 1)
  assert.equal(report.coverage.unresolvedDynamicImports, 0)
  assert.equal(endpoint.foundBackendExport, true)
})

test('enumerates factory spreads, optional require assignments and schedules without executing backend code', (t) => {
  const root = fixture(t, {
    'functions/factory.js': `function create({ onCall, onSchedule }) {
      const getLedger = onCall(() => ({})); const schedule = onSchedule({}, () => {});
      return { getLedger, ...(schedule ? { updateLedgerScheduled: schedule } : {}) };
    } module.exports = { create };`,
    'functions/optional.js': 'function createOptional() { return { getOptional: onCall(() => ({})) } }; module.exports = { createOptional };',
    'functions/index.js': `throw new Error('Audit must never execute this module');
      const { create } = require('./factory'); const handlers = create({ onCall, onSchedule });
      Object.assign(exports, handlers); exports.getLedger = handlers.getLedger;
      exports.getLedgerRegional = handlers.getLedger;
      let createOptional; if (false) { ({ createOptional } = require('./optional')) }
      Object.assign(exports, createOptional());`,
  })
  const report = auditProject(root)
  assert.equal(report.coverage.backendExportNames, 4)
  assert.equal(report.coverage.unresolvedExportSpreads, 0)
  assert.deepEqual(report.backendExports.find((row) => row.name === 'updateLedgerScheduled').kinds, ['scheduled'])
  assert.deepEqual(report.backendExports.find((row) => row.name === 'getLedger').kinds, ['callable'])
  assert.deepEqual(report.duplicateBindings.map((row) => row.name), ['getLedger'])
  assert.equal(report.aliasFamilies[0].alias, 'getLedgerRegional')
  assert.match(renderReport(report), /NOT SAFE TO DELETE/)
  assert.equal(report.coverage.backendExportsWithoutResolvedFrontendReference, 4)
})

test('includes computed exports from finite tuple and string loops without executing entry points', (t) => {
  const root = fixture(t, {
    'functions/index.js': `throw new Error('Inventory must stay static');
      const sources = Object.freeze([['syncMeal', 'mealLogs'], ['syncWater', 'waterLogs'], ['syncActivity', 'activityLogs']]);
      for (const [name, collection] of sources) {
        exports[name] = onDocumentWritten({ document: collection }, () => {});
      }
      for (const name of ['getOne', 'getTwo']) exports[name] = onCall(() => ({}));
      exports['getOne'] = onCall(() => ({}));
      module.exports['scheduledJob'] = onSchedule({}, () => {});
      for (const name of []) exports[name] = onCall(() => ({}));`,
  })
  const report = auditProject(root)
  assert.deepEqual(report.backendExports.map((row) => row.name), ['getOne', 'getTwo', 'scheduledJob', 'syncActivity', 'syncMeal', 'syncWater'])
  assert.deepEqual(report.backendExports.find((row) => row.name === 'syncMeal').kinds, ['event-trigger'])
  assert.deepEqual(report.backendExports.find((row) => row.name === 'scheduledJob').kinds, ['scheduled'])
  assert.deepEqual(report.duplicateBindings.map((row) => row.name), ['getOne'])
  assert.equal(report.coverage.unresolvedComputedExports, 0)
})

test('retains known computed candidates but reports unknown loop rows, tuple positions and runtime names', (t) => {
  const root = fixture(t, {
    'functions/index.js': `throw new Error('Inventory must not evaluate runtime names');
      for (const name of ['getKnown', ...runtimeNames]) exports[name] = onCall(() => ({}));
      for (const [name] of runtimeTuples) exports[name] = onCall(() => ({}));
      for (const [name] of [[...runtimeTuple, 'notTheFirstColumn']]) exports[name] = onCall(() => ({}));
      exports[flag ? 'getConditional' : runtimeName] = onCall(() => ({}));
      module.exports[computedName()] = onCall(() => ({}));`,
  })
  const report = auditProject(root)
  assert.deepEqual(report.backendExports.map((row) => row.name), ['getConditional', 'getKnown'])
  assert.equal(report.coverage.unresolvedComputedExports, 5)
  assert.equal(report.coverage.unresolvedExportSpreads, 0)
  assert.ok(report.unresolvedComputedExports.some((row) => row.resolvedCandidates.includes('getKnown')))
  assert.match(renderReport(report), /UNRESOLVED COMPUTED BACKEND EXPORTS/)
  assert.match(renderReport(report), /module\.exports\[computedName\(\)\]/)
})

test('keeps loop bindings separate when nested scopes reuse the same name', (t) => {
  const root = fixture(t, {
    'functions/index.js': `for (const [name] of [['syncOuter']]) {
      exports[name] = onDocumentWritten({}, () => {});
      for (const name of ['getInner']) exports[name] = onCall(() => ({}));
    }`,
  })
  const report = auditProject(root)
  assert.deepEqual(report.backendExports.map((row) => [row.name, row.kinds]), [['getInner', ['callable']], ['syncOuter', ['event-trigger']]])
  assert.equal(report.coverage.unresolvedComputedExports, 0)
})

test('resolves finite alias maps while retaining dynamic names and unmatched conditional candidates for review', (t) => {
  const root = fixture(t, {
    'src/service.ts': `import { httpsCallable } from 'firebase/functions';
      const aliases = { getOne: 'getOneRegional', getTwo: 'getTwoRegional' } as const;
      function read(name: keyof typeof aliases) { return httpsCallable({}, aliases[name])({}) }
      export function load() { return read('getOne') }
      export function unknown() { return httpsCallable({}, globalThis.endpoint)({}) }
      export function loadExternal() { return import('firebase/functions') }
      export function dynamicImport(file: string) { return import(file) }`,
    'functions/index.js': 'exports.getOneRegional = onCall(() => ({}));',
  })
  const report = auditProject(root)
  assert.deepEqual(report.frontendCallables.map((row) => row.name), ['getOneRegional'])
  assert.ok(report.unresolvedCallableSites.some((row) => row.nameExpression === 'globalThis.endpoint' && !row.parameterized))
  assert.ok(report.unresolvedCallableSites.some((row) => row.parameterized))
  assert.equal(report.coverage.unresolvedDynamicImports, 1)
  assert.match(report.limitations.join(' '), /unmatched candidate is not proof/)
})

test('joins supplied live inventory without converting missing metrics into zero or read names into safety guarantees', (t) => {
  const root = fixture(t, {
    'src/service.ts': "import { httpsCallable } from 'firebase/functions'; export const load = () => httpsCallable({}, 'getThing')({});",
    'functions/index.js': 'exports.getThing = onCall(() => ({})); exports.saveThing = onCall(() => ({}));',
  })
  const report = auditProject(root, { liveInventory: { functions: [{ name: 'getThing', region: 'asia-southeast2', kind: 'callable', requests7d: null }] } })
  assert.deepEqual(report.frontendCallables[0].liveDeployments, [{ region: 'asia-southeast2', kind: 'callable', requests7d: null }])
  assert.match(operationHint('getThing'), /side effects require handler review/)
  assert.match(operationHint('saveThing'), /do not auto-retry/)
  assert.match(operationHint('unknownThing'), /unknown/)
})
