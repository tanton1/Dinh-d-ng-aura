'use strict'

// Static, read-only inventory. Never imports application/backend code, reads
// environment files, contacts production, or decides that an endpoint is unused.
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const SOURCE = /\.[cm]?[jt]sx?$/
const TEST = /(?:\.(?:test|spec|integration)\.[cm]?[jt]sx?$|\.d\.ts$)/
const REGION = /^\w+-\w+\d$/
const normalize = (value) => value.replaceAll('\\', '/')
const unique = (values) => [...new Set(values)].sort()
function walk(node, visit) { visit(node); ts.forEachChild(node, (child) => walk(child, visit)) }
function filesUnder(directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', '.git', 'dist'].includes(entry.name)) return []
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(file) : SOURCE.test(entry.name) && !TEST.test(entry.name) ? [file] : []
  }).sort()
}
function functionNode(node) { return Boolean(node && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node))) }
function enclosingFunctions(node) {
  const result = []
  for (let parent = node.parent; parent; parent = parent.parent) if (functionNode(parent)) result.push(parent)
  return result
}
function unwrap(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression
  return node
}
function propertyName(node) { return node && (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) ? node.text : null }
function returnValues(fn) {
  if (!fn?.body) return []
  if (!ts.isBlock(fn.body)) return [fn.body]
  const values = []
  function visit(node) {
    if (node !== fn && functionNode(node)) return
    if (ts.isReturnStatement(node) && node.expression) values.push(node.expression)
    ts.forEachChild(node, visit)
  }
  visit(fn.body)
  return values
}
function operationHint(name) {
  if (/^(get|list|search|fetch|preview|compare|check|validate)/i.test(name)) return 'read-shaped-name; side effects require handler review'
  if (/^(save|create|update|delete|remove|archive|set|submit|approve|decide|renew|record|assign|transfer|cancel|confirm|publish|revoke|register|unregister|claim|resolve|snooze|complete|enroll|provision|restore|suspend|dispatch|track|report|rebuild|reconcile|refresh|sync|import|export|generate|analyze|grade|accept|resend|ensure|prepare)/i.test(name)) return 'command-or-compute-shaped-name; do not auto-retry/deduplicate'
  return 'unknown; requires handler review'
}

function auditProject(root, { liveInventory = null } = {}) {
  root = path.resolve(root)
  const frontendFiles = filesUnder(path.join(root, 'src'))
  const backendFiles = filesUnder(path.join(root, 'functions'))
  const selected = [...frontendFiles, ...backendFiles]
  const program = ts.createProgram(selected, { allowJs: true, noEmit: true, noLib: true, types: [], skipLibCheck: true, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext, jsx: ts.JsxEmit.ReactJSX })
  const checker = program.getTypeChecker()
  const sources = new Map(selected.map((file) => [normalize(path.resolve(file)), program.getSourceFile(file)]).filter(([, source]) => source))
  const relative = (file) => normalize(path.relative(root, file))
  const location = (node) => ({ file: relative(node.getSourceFile().fileName), line: node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1 })
  const nodeKey = (node) => `${normalize(node.getSourceFile().fileName)}:${node.pos}`
  function symbol(node) {
    let found = checker.getSymbolAtLocation(node)
    if (found?.flags & ts.SymbolFlags.Alias) found = checker.getAliasedSymbol(found)
    return found
  }
  function declarations(node) { return symbol(node)?.declarations || [] }
  const lateRequireFunctions = new Map()
  function calleeFunction(expression) {
    expression = unwrap(expression)
    if (!expression) return null
    if (functionNode(expression)) return expression
    for (const declaration of declarations(expression)) {
      if (functionNode(declaration)) return declaration
      if (ts.isVariableDeclaration(declaration) && functionNode(unwrap(declaration.initializer))) return unwrap(declaration.initializer)
    }
    return lateRequireFunctions.get(symbol(expression)) || null
  }
  const assignments = new Map()
  const frontendSources = frontendFiles.map((file) => sources.get(normalize(path.resolve(file)))).filter(Boolean)
  const allSources = [...sources.values()]
  for (const source of allSources) walk(source, (node) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
      const key = symbol(node.left)
      if (key) assignments.set(key, [...(assignments.get(key) || []), node.right])
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isObjectLiteralExpression(node.left)
      && ts.isCallExpression(node.right) && node.right.expression.getText() === 'require' && ts.isStringLiteralLike(node.right.arguments[0])) {
      const resolved = ts.resolveModuleName(node.right.arguments[0].text, source.fileName, program.getCompilerOptions(), ts.sys).resolvedModule
      const targetSource = resolved && sources.get(normalize(path.resolve(resolved.resolvedFileName)))
      if (!targetSource) return
      for (const property of node.left.properties) {
        const importedName = propertyName(property.name)
        const local = ts.isShorthandPropertyAssignment(property) ? property.name : ts.isPropertyAssignment(property) ? property.initializer : null
        const fn = targetSource.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === importedName)
        if (fn && local) lateRequireFunctions.set(ts.isShorthandPropertyAssignment(property) ? checker.getShorthandAssignmentValueSymbol(property) : symbol(local), fn)
      }
    }
  })
  const lookupTables = new Map()
  // Finite string sets, including explicit parameter markers. Unknown values
  // stay unknown: naming conventions never invent missing endpoints.
  function strings(expression, seen = new Set()) {
    const node = unwrap(expression)
    if (!node || seen.has(node)) return { values: [], unknown: true }
    seen = new Set(seen).add(node)
    const merge = (results) => ({ values: unique(results.flatMap((item) => item.values)), unknown: results.some((item) => item.unknown) })
    if (ts.isStringLiteralLike(node)) return { values: [node.text], unknown: false }
    if (ts.isConditionalExpression(node)) return merge([strings(node.whenTrue, seen), strings(node.whenFalse, seen)])
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) return merge([strings(node.left, seen), strings(node.right, seen)])
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = strings(node.left, seen), right = strings(node.right, seen)
      return { values: left.values.flatMap((a) => right.values.map((b) => a + b)).slice(0, 500), unknown: left.unknown || right.unknown }
    }
    if (ts.isTemplateExpression(node)) {
      let values = [node.head.text], unknown = false
      for (const span of node.templateSpans) {
        const result = strings(span.expression, seen)
        unknown ||= result.unknown
        values = values.flatMap((value) => result.values.map((part) => value + part + span.literal.text)).slice(0, 500)
      }
      return { values, unknown }
    }
    if (ts.isIdentifier(node)) {
      const results = []
      for (const declaration of declarations(node)) {
        if (ts.isParameter(declaration)) results.push({ values: [`\u0001${nodeKey(declaration)}\u0001`], unknown: false })
        else if (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) {
          if (declaration.initializer && declaration.initializer.kind !== ts.SyntaxKind.NullKeyword) results.push(strings(declaration.initializer, seen))
        }
      }
      for (const assignment of assignments.get(symbol(node)) || []) results.push(strings(assignment, seen))
      return results.length ? merge(results) : { values: [], unknown: true }
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const properties = objectProperties(node.expression)
      const keys = ts.isPropertyAccessExpression(node) ? { values: [node.name.text], unknown: false } : strings(node.argumentExpression, seen)
      const values = keys.values.flatMap((key) => properties.get(key) || [])
      if (properties.size && keys.values.some((key) => key.includes('\u0001'))) {
        const tableId = nodeKey(node.expression)
        lookupTables.set(tableId, properties)
        return { values: keys.values.map((key) => `\u0002${tableId}\u0002${key}\u0002`), unknown: keys.unknown }
      }
      return values.length ? merge(values.map((value) => strings(value, seen))) : { values: [], unknown: true }
    }
    if (ts.isCallExpression(node)) {
      const called = node.expression.getText()
      if (/^(?:Object\.)?freeze$/.test(called)) return strings(node.arguments[0], seen)
      if (/(?:^|\.)getFunctions$/.test(called)) return strings(node.arguments[1], seen)
      const values = returnValues(calleeFunction(node.expression))
      if (values.length) return merge(values.map((value) => strings(value, seen)))
    }
    return { values: [], unknown: true }
  }
  const objectCache = new Map()
  function objectProperties(expression, seen = new Set()) {
    const node = unwrap(expression)
    if (!node || seen.has(node)) return new Map()
    if (!seen.size && objectCache.has(node)) return objectCache.get(node)
    const initial = !seen.size
    seen = new Set(seen).add(node)
    const result = new Map()
    function add(key, value) { if (key) result.set(key, [...(result.get(key) || []), value]) }
    function merge(value) { for (const [key, values] of objectProperties(value, seen)) for (const item of values) add(key, item) }
    if (ts.isObjectLiteralExpression(node)) for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) merge(property.expression)
      else if (ts.isPropertyAssignment(property)) add(propertyName(property.name), property.initializer)
      else if (ts.isShorthandPropertyAssignment(property)) {
        const declaration = checker.getShorthandAssignmentValueSymbol(property)?.valueDeclaration
        add(property.name.text, declaration?.initializer || property.name)
      }
    }
    else if (ts.isConditionalExpression(node)) { merge(node.whenTrue); merge(node.whenFalse) }
    else if (ts.isIdentifier(node)) for (const declaration of declarations(node)) { if (declaration.initializer) merge(declaration.initializer) }
    else if (ts.isCallExpression(node)) {
      if (node.expression.getText() === 'Object.freeze') merge(node.arguments[0])
      else for (const value of returnValues(calleeFunction(node.expression))) merge(value)
    } else if (ts.isPropertyAccessExpression(node)) for (const value of objectProperties(node.expression, seen).get(node.name.text) || []) merge(value)
    if (initial) objectCache.set(node, result)
    return result
  }

  const moduleEdges = new Map(frontendSources.map((source) => [relative(source.fileName), new Set()]))
  const dynamicImports = []
  const calls = []
  function moduleTarget(source, specifier) {
    const resolved = ts.resolveModuleName(specifier, source.fileName, program.getCompilerOptions(), ts.sys).resolvedModule
    return resolved && sources.has(normalize(path.resolve(resolved.resolvedFileName))) ? relative(resolved.resolvedFileName) : null
  }
  for (const source of frontendSources) walk(source, (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.importClause?.isTypeOnly || node.isTypeOnly || !node.moduleSpecifier || !ts.isStringLiteralLike(node.moduleSpecifier)) return
      const bindings = node.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings) && !node.importClause.name && bindings.elements.every((binding) => binding.isTypeOnly)) return
      const target = moduleTarget(source, node.moduleSpecifier.text)
      if (target) moduleEdges.get(relative(source.fileName)).add(target)
    }
    if (ts.isCallExpression(node)) {
      calls.push(node)
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments[0]
        const target = argument && ts.isStringLiteralLike(argument) ? moduleTarget(source, argument.text) : null
        if (target) moduleEdges.get(relative(source.fileName)).add(target)
        else if (!argument || !ts.isStringLiteralLike(argument) || argument.text.startsWith('.')) dynamicImports.push(location(node))
      }
    }
  })
  // Identify transport wrappers by parameter flow, including renamed imports,
  // generic calls, local factories, conditional names and nested fallback helpers.
  const wrappers = new Map()
  function transport(node) {
    const declarationsAtCall = declarations(node.expression)
    const imported = declarationsAtCall.some((item) => /[\\/]@?firebase[\\/].*functions|[\\/]firebase[\\/]functions/.test(item.getSourceFile().fileName))
    const expressionName = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ''
    const originalName = symbol(node.expression)?.name || expressionName
    if ((originalName === 'httpsCallable' || originalName === 'httpsCallableFromURL') && (imported || expressionName === originalName)) return { direct: true, name: originalName }
    const fn = calleeFunction(node.expression)
    const templates = fn && wrappers.get(fn)
    return templates?.size ? { templates, fn, direct: false, name: expressionName || originalName } : null
  }
  function endpointValues(call, target) {
    if (target.direct) return strings(call.arguments[1])
    let values = [...target.templates], unknown = false
    target.fn.parameters.forEach((parameter, index) => {
      const marker = `\u0001${nodeKey(parameter)}\u0001`
      if (!values.some((value) => value.includes(marker))) return
      const input = strings(call.arguments[index] || parameter.initializer)
      unknown ||= input.unknown
      values = values.flatMap((value) => value.includes(marker) ? input.values.map((argument) => value.replaceAll(marker, argument)) : [value]).slice(0, 500)
    })
    values = values.flatMap((value) => {
      if (!value.startsWith('\u0002') || value.includes('\u0001')) return [value]
      const [, tableId, key] = value.split('\u0002')
      const matches = lookupTables.get(tableId)?.get(key) || []
      if (!matches.length) unknown = true
      return matches.flatMap((match) => { const resolved = strings(match); unknown ||= resolved.unknown; return resolved.values })
    })
    return { values: unique(values), unknown }
  }
  let changed = true, passes = 0
  while (changed && passes++ < 30) {
    changed = false
    for (const call of calls) {
      const target = transport(call)
      if (!target) continue
      const values = endpointValues(call, target).values
      for (const fn of enclosingFunctions(call)) {
        if (!fn.parameters.some((parameter) => values.some((value) => value.includes(`\u0001${nodeKey(parameter)}\u0001`)))) continue
        if (!wrappers.has(fn)) wrappers.set(fn, new Set())
        for (const value of values) if (!wrappers.get(fn).has(value)) { wrappers.get(fn).add(value); changed = true }
      }
    }
  }
  const regionsByFunction = new Map()
  const siteRecords = []
  for (const call of calls) {
    const target = transport(call)
    if (!target) continue
    let regions = target.direct ? strings(call.arguments[0]).values.filter((value) => REGION.test(value)) : []
    if (target.direct) for (const fn of enclosingFunctions(call)) regionsByFunction.set(fn, unique([...(regionsByFunction.get(fn) || []), ...regions]))
    {
      const names = endpointValues(call, target)
      const candidates = names.values.filter((value) => /^[A-Za-z_$][\w$]*$/.test(value))
      const templates = names.values.filter((value) => value.includes('\u0001')).map((value) => value.replace(/\u0001[^\u0001]+\u0001/g, '{parameter}'))
      siteRecords.push({ ...location(call), transport: target.name, directTransport: target.direct, callableCandidates: unique(candidates), dynamic: names.unknown || templates.length > 0, parameterized: templates.length > 0, nameExpression: target.direct ? call.arguments[1]?.getText().slice(0, 180) || '<missing>' : call.arguments.map((argument) => argument.getText()).join(', ').slice(0, 180), templates: unique(templates.map((value) => value.replace(/\u0002[^\u0002]+\u0002/g, 'lookup[').replaceAll('\u0002', ']'))), possibleRegions: unique(regions), fn: calleeFunction(call.expression) })
    }
  }
  for (let iteration = 0; iteration < 20; iteration++) {
    let regionChanged = false
    for (const call of calls) {
      const regions = regionsByFunction.get(calleeFunction(call.expression)) || []
      if (!regions.length) continue
      for (const fn of enclosingFunctions(call)) {
        const current = regionsByFunction.get(fn) || []
        const next = unique([...current, ...regions])
        if (next.length !== current.length) { regionsByFunction.set(fn, next); regionChanged = true }
      }
    }
    if (!regionChanged) break
  }
  const callSites = siteRecords.map(({ fn, ...site }) => ({ ...site, possibleRegions: unique([...site.possibleRegions, ...(regionsByFunction.get(fn) || [])]) }))
  const reverse = new Map()
  for (const [file, dependencies] of moduleEdges) for (const dependency of dependencies) reverse.set(dependency, [...(reverse.get(dependency) || []), file])
  const uiFiles = frontendSources.map((source) => relative(source.fileName)).filter((file) => /\.[jt]sx$/.test(file))
  function uiConsumers(files) {
    const visited = new Set(files), pending = [...files]
    while (pending.length) for (const parent of reverse.get(pending.pop()) || []) if (!visited.has(parent)) { visited.add(parent); pending.push(parent) }
    return uiFiles.filter((file) => visited.has(file)).sort()
  }

  const indexSource = sources.get(normalize(path.join(root, 'functions/index.js')))
  const backend = new Map(), unresolvedExports = []
  function runtimeKinds(expression, seen = new Set()) {
    const node = unwrap(expression)
    if (!node || seen.has(node)) return []
    seen = new Set(seen).add(node)
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ''
      if (/^(firebaseOnCall|onCall)$/.test(name)) return ['callable']
      if (name === 'onSchedule') return ['scheduled']
      if (/^on(?:Document|Value|Object|Message|Task|Custom|Alert)/.test(name)) return ['event-trigger']
      if (name === 'onRequest') return ['http']
      return unique(returnValues(calleeFunction(node.expression)).flatMap((value) => runtimeKinds(value, seen)))
    }
    if (ts.isConditionalExpression(node)) return unique([...runtimeKinds(node.whenTrue, seen), ...runtimeKinds(node.whenFalse, seen)])
    if (ts.isIdentifier(node)) return unique(declarations(node).flatMap((declaration) => declaration.initializer ? runtimeKinds(declaration.initializer, seen) : []))
    if (ts.isPropertyAccessExpression(node)) return unique((objectProperties(node.expression).get(node.name.text) || []).flatMap((value) => runtimeKinds(value, seen)))
    return []
  }
  function addExport(name, value, binding) {
    if (!name) return
    const row = backend.get(name) || { name, bindings: [], kinds: [], sourceDefinitions: [] }
    row.bindings.push({ ...location(binding), expression: value.getText().replace(/\s+/g, ' ').slice(0, 180) })
    row.kinds = unique([...row.kinds, ...runtimeKinds(value)])
    row.sourceDefinitions = unique([...row.sourceDefinitions, location(value).file])
    backend.set(name, row)
  }
  if (indexSource) walk(indexSource, (node) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && node.left.expression.getText() === 'exports') addExport(node.left.name.text, node.right, node)
    if (ts.isCallExpression(node) && node.expression.getText() === 'Object.assign' && node.arguments[0]?.getText() === 'exports') {
      for (const argument of node.arguments.slice(1)) {
        const properties = objectProperties(argument)
        if (!properties.size) unresolvedExports.push({ ...location(node), expression: argument.getText().slice(0, 180) })
        for (const [name, values] of properties) for (const value of values) addExport(name, value, node)
      }
    }
  })
  const liveByName = new Map()
  for (const row of liveInventory?.functions || []) liveByName.set(row.name, [...(liveByName.get(row.name) || []), { region: row.region, kind: row.kind, requests7d: row.requests7d ?? null }])
  const callableNames = unique(callSites.flatMap((site) => site.callableCandidates))
  const frontendCallables = callableNames.map((name) => {
    const sites = callSites.filter((site) => site.callableCandidates.includes(name))
    const serviceFiles = unique(sites.map((site) => site.file))
    return { name, operationHint: operationHint(name), references: sites.map(({ callableCandidates, ...site }) => site), serviceFiles, uiModuleReachability: uiConsumers(serviceFiles), foundBackendExport: backend.has(name), liveDeployments: liveByName.get(name) || [] }
  })
  const backendExports = [...backend.values()].sort((a, b) => a.name.localeCompare(b.name)).map((row) => ({ ...row, operationHint: operationHint(row.name), hasResolvedFrontendReference: callableNames.includes(row.name), liveDeployments: liveByName.get(row.name) || [] }))
  const aliasFamilies = []
  for (const row of backendExports) {
    const base = row.name.replace(/(?:Regional|Overflow|V\d+)$/, '')
    if (base !== row.name && backend.has(base)) aliasFamilies.push({ base, alias: row.name, evidence: 'name similarity only; inspect bindings/handlers before removing or rerouting' })
  }
  const duplicateBindings = backendExports.filter((row) => row.bindings.length > 1).map((row) => ({ name: row.name, bindings: row.bindings, meaning: 'multiple export assignments; may intentionally re-expose the same function, not multiple deployments' }))
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    method: 'TypeScript AST, callable wrapper parameter flow, static/dynamic literal import graph and backend factory-return exports; no application code execution',
    limitations: [
      'Static candidates include conditional/fallback branches and may overapproximate parameter-dependent routing guards; an unmatched candidate is not proof of a missing backend endpoint.',
      'Static references are not request counts or proof that requests run simultaneously.',
      'UI reachability follows value imports by module, not exact component render paths or individual imported-symbol usage.',
      'Read/write labels use names only. A read-shaped handler may write caches, synchronize data or generate side effects.',
      'Possible regions contain only statically resolved client evidence; dynamic parameter/option overrides can add unresolved regions. Use liveDeployments for deployed regions.',
      'Parameterized wrapper declarations are expected; unresolved dynamic names and exports remain listed for manual review.',
      'No resolved frontend reference is not evidence of an unused endpoint: triggers, schedules, admin scripts and older clients still matter.',
      'Aliases and multiple export assignments are not automatically redundant services. No endpoint can be safely deleted from this report alone.',
    ],
    coverage: { frontendFiles: frontendSources.length, uiModules: uiFiles.length, backendFiles: backendFiles.length, importEdges: [...moduleEdges.values()].reduce((sum, values) => sum + values.size, 0), callableSites: callSites.length, directTransportSites: callSites.filter((site) => site.directTransport).length, staticCallableCandidates: callableNames.length, candidatesMatchingBackendExports: frontendCallables.filter((row) => row.foundBackendExport).length, parameterizedOrUnresolvedSites: callSites.filter((site) => site.dynamic).length, backendExportNames: backendExports.length, backendExportsWithoutResolvedFrontendReference: backendExports.filter((row) => !row.hasResolvedFrontendReference).length, unresolvedExportSpreads: unresolvedExports.length, unresolvedDynamicImports: dynamicImports.length, wrapperDiscoveryPasses: passes },
    frontendCallables,
    backendExports,
    multipleServiceReferences: frontendCallables.filter((row) => row.serviceFiles.length > 1).map(({ name, serviceFiles }) => ({ name, serviceFiles, meaning: 'review sharing opportunities; multiple callers alone do not prove redundant calls' })),
    duplicateBindings,
    aliasFamilies,
    unresolvedCallableSites: callSites.filter((site) => site.dynamic),
    unresolvedExports,
    unresolvedDynamicImports: dynamicImports,
    uiModules: uiFiles.map((file) => ({ file, callableCandidates: frontendCallables.filter((row) => row.uiModuleReachability.includes(file)).map((row) => row.name) })),
  }
}

function renderReport(report) {
  const lines = ['AURA STATIC CALLABLE USAGE AUDIT', '', JSON.stringify(report.coverage, null, 2), '', 'LIMITATIONS', ...report.limitations.map((note) => `- ${note}`), '', 'FRONTEND → CALLABLE → DEPLOYMENT']
  for (const row of report.frontendCallables) lines.push('', `${row.name} | ${row.operationHint}`, `  Services: ${row.serviceFiles.join(', ')}`, `  UI import reachability: ${row.uiModuleReachability.join(', ') || '(none resolved)'}`, `  Backend export: ${row.foundBackendExport}; live: ${row.liveDeployments.map((deployment) => deployment.region).join(', ') || '(not supplied / not found)'}`)
  lines.push('', 'MULTIPLE SERVICE REFERENCES (REVIEW CANDIDATES, NOT PROVEN DUPLICATION)', ...report.multipleServiceReferences.map((row) => `${row.name}: ${row.serviceFiles.join(', ')}`), '', 'DYNAMIC/PARAMETERIZED CALLABLE SITES')
  for (const row of report.unresolvedCallableSites) lines.push(`${row.file}:${row.line} ${row.transport}(${row.nameExpression})${row.parameterized ? ' [wrapper parameter]' : ''}`)
  lines.push('', 'UNRESOLVED BACKEND EXPORT SPREADS', ...report.unresolvedExports.map((row) => `${row.file}:${row.line} ${row.expression}`), '', 'BACKEND EXPORTS WITHOUT A RESOLVED FRONTEND REFERENCE (NOT SAFE TO DELETE)', ...report.backendExports.filter((row) => !row.hasResolvedFrontendReference).map((row) => `${row.name} [${row.kinds.join(', ') || 'unknown'}]`))
  return lines.join('\n') + '\n'
}

if (require.main === module) {
  const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
  const root = path.resolve(argument('root') || process.cwd())
  const livePath = argument('live-inventory')
  const report = auditProject(root, { liveInventory: livePath ? JSON.parse(fs.readFileSync(livePath, 'utf8')) : null })
  const output = argument('output')
  if (output) {
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true })
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
    fs.writeFileSync(output.replace(/\.json$/i, '') + '.txt', renderReport(report))
  }
  process.stdout.write(JSON.stringify({ coverage: report.coverage, multipleServiceReferences: report.multipleServiceReferences, output: output || null }, null, 2) + '\n')
}
module.exports = { auditProject, renderReport, operationHint }
