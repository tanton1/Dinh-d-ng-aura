import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

const rootDir = process.cwd()
const assetsDir = path.join(rootDir, 'dist', 'assets')

const budgets = {
  entryCss: 150_000,
  entryJs: 240_000,
  firebaseVendor: 725_000,
  initialAssetsGzip: 410_000,
  startupTransfer: 480_000,
  splashImage: 100_000,
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`
}

async function largestMatchingAsset(pattern) {
  const files = (await readdir(assetsDir)).filter((file) => pattern.test(file))
  if (files.length === 0) throw new Error(`Không tìm thấy asset khớp ${pattern}`)

  const sizes = await Promise.all(files.map(async (file) => ({
    file,
    bytes: (await stat(path.join(assetsDir, file))).size,
  })))
  return sizes.sort((a, b) => b.bytes - a.bytes)[0]
}

function assertWithinBudget(label, asset, budget) {
  if (asset.bytes > budget) {
    throw new Error(`${label} ${asset.file} vượt budget: ${formatBytes(asset.bytes)} > ${formatBytes(budget)}`)
  }
  console.log(`✓ ${label}: ${formatBytes(asset.bytes)} / ${formatBytes(budget)}`)
}

const [entryCss, entryJs, firebaseVendor, splashStats, html, builtHtml, appSource, onboardingSource] = await Promise.all([
  largestMatchingAsset(/^index-[\w-]+\.css$/),
  largestMatchingAsset(/^index-[\w-]+\.js$/),
  largestMatchingAsset(/^vendor-firebase-(?!app-check|messaging)[\w-]+\.js$/),
  stat(path.join(rootDir, 'public', 'aura-onboarding.webp')),
  readFile(path.join(rootDir, 'index.html'), 'utf8'),
  readFile(path.join(rootDir, 'dist', 'index.html'), 'utf8'),
  readFile(path.join(rootDir, 'src', 'App.tsx'), 'utf8'),
  readFile(path.join(rootDir, 'src', 'onboarding', 'screens', 'OnboardingScreens.tsx'), 'utf8'),
])

assertWithinBudget('CSS khởi động', entryCss, budgets.entryCss)
assertWithinBudget('JS khởi động', entryJs, budgets.entryJs)
assertWithinBudget('Firebase vendor', firebaseVendor, budgets.firebaseVendor)
assertWithinBudget('Ảnh splash WebP', { file: 'aura-onboarding.webp', bytes: splashStats.size }, budgets.splashImage)

const initialAssetNames = [...builtHtml.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="\/assets\/([^"]+)"/g)]
  .map((match) => match[1])
const initialAssets = await Promise.all(initialAssetNames.map(async (file) => {
  const contents = await readFile(path.join(assetsDir, file))
  return { file, gzipBytes: gzipSync(contents).byteLength }
}))
const initialAssetsGzip = initialAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0)
if (initialAssetsGzip > budgets.initialAssetsGzip) {
  throw new Error(`Tổng tài nguyên khởi động gzip vượt budget: ${formatBytes(initialAssetsGzip)} > ${formatBytes(budgets.initialAssetsGzip)}`)
}
if (initialAssets.length > 6) {
  throw new Error(`HTML đang tải trước ${initialAssets.length} assets; cần giữ tối đa 6 tài nguyên khởi động.`)
}
if (initialAssets.length < 4) {
  throw new Error(`Chỉ phát hiện ${initialAssets.length} assets khởi động; bộ đo không đọc đúng manifest HTML production.`)
}
console.log(`✓ Tổng tài nguyên khởi động gzip: ${formatBytes(initialAssetsGzip)} / ${formatBytes(budgets.initialAssetsGzip)} (${initialAssets.length} assets)`)

const startupTransfer = initialAssetsGzip + splashStats.size + gzipSync(Buffer.from(builtHtml)).byteLength
if (startupTransfer > budgets.startupTransfer) {
  throw new Error(`Tổng tải khởi động gồm HTML và splash vượt budget: ${formatBytes(startupTransfer)} > ${formatBytes(budgets.startupTransfer)}`)
}
console.log(`✓ Tổng tải khởi động gồm HTML và splash: ${formatBytes(startupTransfer)} / ${formatBytes(budgets.startupTransfer)}`)

const startupSources = [html, appSource, onboardingSource].join('\n')
if (startupSources.includes('/aura-onboarding.png')) {
  throw new Error('Luồng khởi động vẫn tham chiếu ảnh PNG dung lượng lớn.')
}

console.log('✓ Không còn tải ảnh splash PNG trong luồng khởi động')
