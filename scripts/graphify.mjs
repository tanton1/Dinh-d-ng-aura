import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const venv = join(root, '.tools', 'graphify', 'venv')
const python = join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const version = '0.9.97'
const input = process.argv.slice(2)
const command = input.shift() || 'help'
function option(name, fallback) {
  const index = input.indexOf(name)
  if (index < 0) return fallback
  if (!input[index + 1] || input[index + 1].startsWith('--')) throw new Error(`${name} needs a value`)
  return input.splice(index, 2)[1]
}
const source = resolve(option('--source', root))
const name = option('--name', '')
if (name && !/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Use letters, numbers, _ or - for --name')
const output = join(root, 'graphify-out', name)
const env = { ...process.env, PYTHONUTF8: '1', GRAPHIFY_OUT: output, GRAPHIFY_NO_UPDATE_CHECK: '1' }
function run(executable, args, { capture = false, cwd = root, extraEnv = {} } = {}) {
  const result = spawnSync(executable, args, {
    cwd, env: { ...env, ...extraEnv }, encoding: 'utf8', windowsHide: true,
    stdio: capture ? 'pipe' : 'inherit', maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${executable} exited ${result.status}${capture ? `\n${result.stderr || result.stdout}` : ''}`)
  return result.stdout?.trim() || ''
}
function graphify(args) { return run(python, ['-m', 'graphify', ...args], { cwd: source }) }
function requireInstalled() {
  if (!existsSync(python)) throw new Error('Run npm run graphify:install first')
  const installed = run(python, ['-c', "from importlib.metadata import version; print(version('graphifyy'))"], { capture: true })
  if (installed !== version) throw new Error(`Expected graphifyy ${version}; run npm run graphify:install`)
}
try {
  if (command === 'install') {
    if (input.length) throw new Error(`Unexpected arguments: ${input.join(' ')}`)
    if (!existsSync(python)) {
      const candidates = process.env.AURA_GRAPHIFY_PYTHON
        ? [[process.env.AURA_GRAPHIFY_PYTHON, []]]
        : [['python3', []], ['python', []], ['py', ['-3.12']],
          [join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'), []]]
      const candidate = candidates.find(([exe, args]) => {
        const check = spawnSync(exe, [...args, '-c', 'import sys; sys.exit(0 if sys.version_info[:2] == (3, 12) else 1)'], { windowsHide: true, stdio: 'ignore' })
        return !check.error && check.status === 0
      })
      if (!candidate) throw new Error('Python 3.12 is required for this tested lock. Set AURA_GRAPHIFY_PYTHON to its executable.')
      mkdirSync(dirname(venv), { recursive: true })
      run(candidate[0], [...candidate[1], '-m', 'venv', venv])
    }
    run(python, ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', '--only-binary=:all:', '-r', join(root, 'tools/graphify/requirements.txt')])
    run(python, ['-m', 'pip', 'check'])
    const npmCli = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
    if (!existsSync(npmCli)) throw new Error('Run installation through npm run graphify:install to resolve the npm CLI.')
    run(process.execPath, [npmCli, 'ci', '--prefix', join(root, 'tools/graphify'), '--ignore-scripts', '--no-audit', '--no-fund'])
    requireInstalled()
    console.log(`Graphify ${version} installed locally. No API key is required.`)
  } else if (command === 'build') {
    if (input.length) throw new Error(`Unexpected arguments: ${input.join(' ')}`)
    requireInstalled()
    try { createRequire(join(source, 'package.json')).resolve('firebase/functions') }
    catch { throw new Error('Install the source checkout dependencies with npm ci first: the callable auditor needs Firebase type declarations to resolve transport aliases.') }
    mkdirSync(output, { recursive: true })
    run(python, [join(root, 'tools/graphify/aura_graph.py'), 'preflight', source, output])
    const savedPath = join(output, 'aura-source-manifest.json')
    const saved = existsSync(savedPath) ? JSON.parse(readFileSync(savedPath, 'utf8')) : null
    const current = JSON.parse(readFileSync(join(output, 'aura-build-input.json'), 'utf8'))
    if (saved?.buildPolicy === 'fresh-ast-v1' && saved.sourceRoot === current.sourceRoot && saved.fingerprint === current.fingerprint &&
        ['graph.json', 'graph.html', 'GRAPH_REPORT.md', 'aura-structure.json', 'aura-callables.json'].every(file => existsSync(join(output, file)))) {
      run(python, [join(root, 'tools/graphify/aura_graph.py'), 'check', source, output])
      console.log(`Unchanged source; reusing the complete local graph: ${output}`)
      process.exit(0)
    }
    // Start from a fresh graph: upstream's --force can still merge/prune old
    // unresolved reference nodes. Preserve the last graph if extraction fails.
    const graphPath = join(output, 'graph.json')
    const previousGraph = existsSync(graphPath) ? readFileSync(graphPath) : null
    if (previousGraph) unlinkSync(graphPath)
    try {
      graphify(['extract', source, '--out', output, '--code-only', '--no-dedup', '--force', '--max-workers', '4', '--timing'])
      graphify(['cluster-only', source, '--no-label'])
      const audit = join(source, 'scripts/audit-callable-usage.cjs')
      run(process.execPath, [audit, `--root=${source}`, `--output=${join(output, 'aura-callables.json')}`], {
        capture: true,
        extraEnv: { NODE_PATH: [join(root, 'tools/graphify/node_modules'), process.env.NODE_PATH].filter(Boolean).join(delimiter) },
      })
      // Stamp freshness only after every required output succeeds.
      run(python, [join(root, 'tools/graphify/aura_graph.py'), 'report', source, output])
    } catch (error) {
      if (previousGraph) writeFileSync(graphPath, previousGraph)
      if (existsSync(savedPath)) unlinkSync(savedPath)
      throw error
    }
    console.log(`Graph, scope manifest, structural report and callable inventory: ${output}`)
  } else if (['query', 'explain', 'path', 'stats'].includes(command)) {
    requireInstalled()
    if (!existsSync(join(output, 'graph.json'))) throw new Error('Build the graph first with npm run graphify:build')
    run(python, [join(root, 'tools/graphify/aura_graph.py'), 'check', source, output])
    if (command === 'stats') {
      if (input.length) throw new Error('stats does not accept extra arguments')
      const metrics = JSON.parse(readFileSync(join(output, 'aura-structure.json'), 'utf8'))
      const audit = JSON.parse(readFileSync(join(output, 'aura-callables.json'), 'utf8'))
      console.log(JSON.stringify({ commit: metrics.commit, sourceFiles: metrics.sourceFiles, nodes: metrics.nodes,
        edges: metrics.edges, importEdges: metrics.importEdges, importCycleCandidates: metrics.importCycles.length,
        callableCoverage: audit.coverage }, null, 2))
    } else graphify([command, ...input])
  } else {
    console.log('Aura Graphify (local code analysis; no paid API calls)\n\n' +
      'npm run graphify:install\n' +
      'npm run graphify:build\n' +
      'npm run graphify -- query "DatabaseContext" --budget 1500\n' +
      'npm run graphify -- explain "DatabaseProvider"\n' +
      'npm run graphify -- stats\n\n' +
      'Optional --source <checkout> --name <snapshot> isolates a baseline graph.\n' +
      'Re-run build after source changes; unchanged source reuses the graph.\n' +
      'Only install, build, query, explain, path and stats are exposed here.')
    if (command !== 'help') process.exitCode = 1
  }
} catch (error) {
  console.error(`Graphify: ${error.message}`)
  process.exitCode = 1
}
