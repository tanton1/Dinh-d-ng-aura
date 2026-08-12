import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const rootDir = process.cwd()
const assetsDir = path.join(rootDir, 'dist', 'assets')

const budgets = {
  entryCss: 150_000,
  entryJs: 240_000,
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

const [entryCss, entryJs, splashStats, html, appSource, onboardingSource] = await Promise.all([
  largestMatchingAsset(/^index-[\w-]+\.css$/),
  largestMatchingAsset(/^index-[\w-]+\.js$/),
  stat(path.join(rootDir, 'public', 'aura-onboarding.webp')),
  readFile(path.join(rootDir, 'index.html'), 'utf8'),
  readFile(path.join(rootDir, 'src', 'App.tsx'), 'utf8'),
  readFile(path.join(rootDir, 'src', 'onboarding', 'screens', 'OnboardingScreens.tsx'), 'utf8'),
])

assertWithinBudget('CSS khởi động', entryCss, budgets.entryCss)
assertWithinBudget('JS khởi động', entryJs, budgets.entryJs)
assertWithinBudget('Ảnh splash WebP', { file: 'aura-onboarding.webp', bytes: splashStats.size }, budgets.splashImage)

const startupSources = [html, appSource, onboardingSource].join('\n')
if (startupSources.includes('/aura-onboarding.png')) {
  throw new Error('Luồng khởi động vẫn tham chiếu ảnh PNG dung lượng lớn.')
}

console.log('✓ Không còn tải ảnh splash PNG trong luồng khởi động')
