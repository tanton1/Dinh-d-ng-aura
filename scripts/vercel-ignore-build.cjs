'use strict'

// Vercel runs this before installing dependencies: 0 skips, 1 builds.
// Compare with the last SUCCESSFUL deployment on this branch, never HEAD^.
// Unknown inputs deliberately build. CI and Firebase releases are unaffected.
const { execFileSync } = require('node:child_process')
const { readFileSync, lstatSync } = require('node:fs')
const path = require('node:path')

const command = 'node scripts/vercel-ignore-build.cjs'
const sharedFunctions = new Set([
  'functions/nutrition-core.mjs',
  'functions/nutrition-core.d.mts',
  'functions/delivery-location-policy.json',
])

function backendOrDocumentation(file) {
  if (sharedFunctions.has(file)) return false
  if (file === 'README.md' || file === 'CHANGELOG.md') return true
  if (/^docs\/.+\.md$/i.test(file)) return true
  if (/^ops\/.+\.(?:json|md|txt)$/i.test(file)) return true
  return /^functions\/.+\.(?:js|cjs|json)$/.test(file)
    && !file.startsWith('functions/generated/')
    && file !== 'functions/package.json'
}

function decide({ cwd = process.cwd(), env = process.env, args = [] } = {}) {
  const build = (reason) => ({ skip: false, reason })
  if (args.length || (env.AURA_VERCEL_FORCE_BUILD && env.AURA_VERCEL_FORCE_BUILD !== '0')) {
    return build('Forced or explicitly requested rebuild.')
  }
  const previous = env.VERCEL_GIT_PREVIOUS_SHA || ''
  const current = env.VERCEL_GIT_COMMIT_SHA || ''
  if (![previous, current].every((sha) => /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i.test(sha))) {
    return build('Missing or invalid last successful deployment / current commit SHA.')
  }
  const git = (...parameters) => execFileSync('git', parameters, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000,
    maxBuffer: 8 * 1024 * 1024,
  })
  try {
    if (git('rev-parse', '--show-prefix').trim()) return build('Project is not the repository root.')
    if (git('rev-parse', 'HEAD').trim() !== current.toLowerCase()) return build('Checkout does not match deployment SHA.')
    git('cat-file', '-e', `${previous}^{commit}`)
    if (previous.toLowerCase() === current.toLowerCase()) return build('Same commit redeploy may contain environment changes.')
    git('merge-base', '--is-ancestor', previous, current)
    if (git('status', '--porcelain', '--untracked-files=normal').trim()) return build('Checkout contains uncommitted inputs.')
    const changed = git('diff', '--name-only', '--no-renames', '-z', previous, current, '--').split('\0').filter(Boolean)
    if (!changed.length) return build('Empty diff may be an intentional redeploy.')
    const relevant = changed.find((file) => !backendOrDocumentation(file))
    if (relevant) return build(`Frontend, configuration, generated asset, or unknown input changed: ${relevant}`)

    const read = (file) => readFileSync(path.join(cwd, file), 'utf8')
    const pkg = JSON.parse(read('package.json'))
    const config = JSON.parse(read('vercel.json'))
    if (pkg.scripts?.build !== 'tsc -b && vite build'
      || ['preinstall', 'install', 'postinstall', 'prepare', 'prebuild', 'postbuild'].some((hook) => pkg.scripts?.[hook])
      || config.ignoreCommand !== command
      || (config.buildCommand && config.buildCommand !== 'npm run build')
      || config.installCommand) return build('Build configuration needs a fresh dependency-boundary review.')

    // These are the current build/typecheck and Academy-generation inputs. Never
    // assume that everything in functions/ is backend-only: the browser shares
    // nutrition policy/types and delivery-location policy with Functions.
    const files = git('ls-files', '-z').split('\0').filter(Boolean)
    const roots = files.filter((file) => /^(?:src|content)\//.test(file)
      || /^(?:vite\.config\.ts|tsconfig(?:\.[\w-]+)?\.json)$/.test(file)
      || file === 'index.html' || file === 'scripts/build-academy-runtime-assets.cjs' || sharedFunctions.has(file))
    if ([...roots, ...files.filter((file) => file.startsWith('public/'))]
      .some((file) => lstatSync(path.join(cwd, file)).isSymbolicLink())) {
      return build('Frontend symlink dependencies need a fresh review.')
    }
    if (!roots.includes('vite.config.ts') || !roots.some((file) => file.startsWith('src/'))) {
      return build('Expected frontend inputs are missing.')
    }
    for (const file of roots) {
      if (!/\.(?:[cm]?[jt]sx?|json|css|html)$/.test(file)) continue
      const source = read(file)
      // Resolve no aliases/globs/computed imports speculatively before install.
      if (/import\.meta\.glob|\b(?:import|require)\s*\(\s*[^\s'"`]/.test(source)
        || /\b(?:import|require)\s*\(\s*`[^`]*\$\{/.test(source)
        || (/^(?:vite|tsconfig)/.test(file) && /\balias\s*:|"paths"\s*:/.test(source))) {
        return build(`Unreviewed dynamic dependency in ${file}.`)
      }
      for (const match of source.matchAll(/['"`]((?:(?:\.\.?\/)+|\/)[^'"`\r\n]+)['"`]/g)) {
        const reference = match[1].split('?')[0]
        const dependency = reference.startsWith('/') ? reference.slice(1)
          : path.posix.normalize(path.posix.join(path.posix.dirname(file), reference))
        if (/^(?:functions|docs|ops)(?:\/|$)/.test(dependency) && !sharedFunctions.has(dependency)) {
          return build(`Additional shared build dependency in ${file}: ${dependency}`)
        }
      }
    }
    return { skip: true, reason: `Only ${changed.length} backend/documentation input(s) changed since the last successful deployment.` }
  } catch {
    // Shallow/missing history, unavailable Git, malformed files, and read errors
    // must never suppress a release. Do not fetch or expose command stderr.
    return build('Could not prove the frontend is unchanged; continuing the build.')
  }
}

if (require.main === module) {
  const result = decide({ args: process.argv.slice(2) })
  console.log(`[aura-build] ${result.skip ? 'SKIP' : 'BUILD'}: ${result.reason}`)
  process.exitCode = result.skip ? 0 : 1
}

module.exports = { decide, backendOrDocumentation }
