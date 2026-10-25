'use strict'

const crypto = require('node:crypto')
const ts = require('typescript')
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })

function topLevelGraph(source, localFiles = {}) {
  const file = ts.createSourceFile('index.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  if (file.parseDiagnostics.length) throw new Error('Cannot audit an invalid Functions entry point')
  const graph = new Map()
  const printed = (node) => printer.printNode(ts.EmitHint.Unspecified, node, file)
  const refs = (node) => {
    const found = new Set()
    function walk(child) {
      if (ts.isIdentifier(child)) found.add(child.text)
      if (ts.isPropertyAccessExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === 'exports') found.add(`exports.${child.name.text}`)
      if (ts.isCallExpression(child) && child.expression.getText(file) === 'require' && ts.isStringLiteral(child.arguments[0]) && child.arguments[0].text.startsWith('./')) {
        const base = child.arguments[0].text.slice(2)
        found.add(`file:${Object.hasOwn(localFiles, base) ? base : `${base}.js`}`)
      }
      ts.forEachChild(child, walk)
    }
    walk(node); return found
  }
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) graph.set(statement.name.text, { code: printed(statement), refs: refs(statement) })
    else if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      if (!declaration.initializer) continue
      if (ts.isIdentifier(declaration.name)) graph.set(declaration.name.text, { code: printed(declaration.initializer), refs: refs(declaration.initializer) })
      else if (ts.isObjectBindingPattern(declaration.name)) for (const binding of declaration.name.elements) {
        if (!ts.isIdentifier(binding.name) || binding.dotDotDotToken || binding.initializer) throw new Error('Unsupported top-level destructuring; review the release auditor')
        graph.set(binding.name.text, { code: `${printed(declaration.initializer)}.${binding.propertyName ? printed(binding.propertyName) : binding.name.text}`, refs: refs(declaration.initializer) })
      }
    }
    else if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)) {
      const expression = statement.expression
      if (ts.isPropertyAccessExpression(expression.left) && expression.left.expression.getText(file) === 'exports') {
        graph.set(`exports.${expression.left.name.text}`, { code: printed(expression.right), refs: refs(expression.right) })
      }
    }
  }
  // Imported local modules may change without changing the require expression.
  for (const [name, content] of Object.entries(localFiles)) {
    const dependencies = new Set()
    const module = ts.createSourceFile(name, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    const posix = require('node:path').posix
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require'
          && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text.startsWith('.')) {
        const base = posix.normalize(posix.join(posix.dirname(name), node.arguments[0].text))
        dependencies.add(`file:${Object.hasOwn(localFiles, base) ? base : `${base}.js`}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(module)
    graph.set(`file:${name}`, { code: content.replace(/\r\n/g, '\n'), refs: dependencies })
  }
  return graph
}

function functionImpact(before, after, oldFiles = {}, newFiles = {}) {
  const oldGraph = topLevelGraph(before, oldFiles), newGraph = topLevelGraph(after, newFiles)
  const changed = new Set([...new Set([...oldGraph.keys(), ...newGraph.keys()])]
    .filter((key) => oldGraph.get(key)?.code !== newGraph.get(key)?.code))
  const affected = new Set(changed)
  // Use both graphs: deleting a dependency must not silently drop its consumers.
  let expanded = true
  while (expanded) {
    expanded = false
    for (const graph of [oldGraph, newGraph]) for (const [name, item] of graph) {
      if (!affected.has(name) && [...item.refs].some((dependency) => affected.has(dependency))) {
        affected.add(name); expanded = true
      }
    }
  }
  return {
    changedBindings: [...changed].sort(),
    affectedFunctions: [...affected].filter((name) => name.startsWith('exports.')).map((name) => name.slice(8)).sort(),
    addedFunctions: [...newGraph.keys()].filter((name) => name.startsWith('exports.') && !oldGraph.has(name)).map((name) => name.slice(8)).sort(),
    removedFunctions: [...oldGraph.keys()].filter((name) => name.startsWith('exports.') && !newGraph.has(name)).map((name) => name.slice(8)).sort(),
  }
}

function sanitizeFunctionInventory(raw, targetIds) {
  if (raw.status !== 'success' || !Array.isArray(raw.result)) throw new Error('Live function inventory is not a successful structured response')
  const wanted = new Set(targetIds)
  const selected = raw.result.filter((item) => wanted.has(item.id))
  const services = (raw.cloudRun ?? []).flatMap((region) => region.services.flatMap((item) => {
    const target = selected.find((entry) => (entry.runServiceId ?? entry.id.toLowerCase()) === item.metadata?.name)
    if (!target) return []
    if (target.project !== region.project || target.region !== region.region) throw new Error('Cloud Run snapshot target mismatch')
    return [{ functionId: target.id, project: region.project, region: region.region, service: item.metadata.name,
      latestReadyRevision: item.status?.latestReadyRevisionName ?? null, latestCreatedRevision: item.status?.latestCreatedRevisionName ?? null,
      traffic: (Array.isArray(item.status?.traffic) ? item.status.traffic : item.status?.traffic ? [item.status.traffic] : []).map((traffic) => ({ revision: traffic.revisionName ?? null, percent: traffic.percent ?? null, latest: traffic.latestRevision === true })),
      serviceMinScale: item.metadata?.annotations?.['run.googleapis.com/minScale'] ?? null,
      templateMinScale: item.spec?.template?.metadata?.annotations?.['autoscaling.knative.dev/minScale'] ?? null,
    }]
  }))
  return { kind: 'read-only-firebase-functions-inventory', cloudRunServices: services, functions: selected.map((item) => ({
    id: item.id, project: item.project, region: item.region, state: item.state, platform: item.platform, runtime: item.runtime,
    memoryMiB: item.availableMemoryMb ?? null, cpu: item.cpu ?? null, minInstances: item.minInstances ?? null,
    maxInstances: item.maxInstances ?? null, concurrency: item.concurrency ?? null, timeoutSeconds: item.timeoutSeconds ?? null,
    service: item.runServiceId ?? null, sourceHash: item.hash ?? null,
    // Do not copy environmentVariables, credentials, URL query strings or auth.
    source: item.source ? { storageSource: item.source.storageSource ? {
      bucket: item.source.storageSource.bucket, object: item.source.storageSource.object,
      generation: item.source.storageSource.generation ?? null,
    } : null } : null,
  })).sort((a, b) => a.id.localeCompare(b.id)), missing: [...wanted].filter((id) => !raw.result.some((item) => item.id === id)).sort(),
    qualification: 'Missing minInstances is unknown, not proof of zero; source locators are provenance, not verified rollback artifacts.' }
}

function scanSecrets(file, bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : bytes
  if (text.includes('\0')) return []
  const patterns = [
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{48,}/],
    ['github-token', /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{28,}\b/],
    ['provider-key', /\bsk-or-v1-[A-Za-z0-9_-]{28,}\b/],
    ['google-oauth-token', /\bya29\.[A-Za-z0-9_-]{30,}\b/],
  ]
  const findings = patterns.filter(([, pattern]) => pattern.test(text)).map(([label]) => ({ file, label }))
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(APIKEY_FUN_API_KEY|OPENROUTER_API_KEY|GEMINI_API_KEY|DELIVERY_OTP_SECRET|FIREBASE_SERVICE_ACCOUNT_KEY)\s*=\s*(.+?)\s*$/i)
    if (match && !/^(?:$|your[_-]|change[_-]?me|replace[_-]|placeholder|example|test|<.*>|\$\{.*\})/i.test(match[2].replace(/^['"]|['"]$/g, ''))) findings.push({ file, label: 'sensitive-assignment' })
  }
  return findings
}

module.exports = { sha256, topLevelGraph, functionImpact, sanitizeFunctionInventory, scanSecrets }
