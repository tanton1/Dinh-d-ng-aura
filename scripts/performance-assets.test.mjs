import test from 'node:test'
import assert from 'node:assert/strict'
import { viteEntryAsset } from './performance-assets.mjs'

test('startup JS is selected from the HTML entry, never a larger lazy index chunk', () => {
  const manifest = {
    '_index-lazy.js': { file: 'assets/index-lazy.js', name: 'index' },
    'index.html': { file: 'assets/index-startup.js', name: 'index', src: 'index.html', isEntry: true },
  }
  assert.equal(viteEntryAsset(manifest), 'assets/index-startup.js')
  const sizes = { 'assets/index-lazy.js': 118_040, 'assets/index-startup.js': 39_093 }
  assert.equal(sizes[viteEntryAsset(manifest)], 39_093)
  sizes['assets/index-startup.js'] = 80_001
  assert.ok(sizes[viteEntryAsset(manifest)] > 80_000, 'an oversized real entry must still fail the unchanged budget')
})

test('missing, non-entry and escaping manifest paths fail closed', () => {
  for (const entry of [undefined, { file: 'assets/index-lazy.js', src: 'index.html' },
    { file: '../entry.js', src: 'index.html', isEntry: true },
    { file: 'assets/../entry.js', src: 'index.html', isEntry: true },
    { file: 'assets/entry.js', src: 'other.html', isEntry: true },
  ]) assert.throws(() => viteEntryAsset({ 'index.html': entry }))
})
