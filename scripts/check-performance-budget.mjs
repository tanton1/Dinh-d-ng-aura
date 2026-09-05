import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

const rootDir = process.cwd()
const assetsDir = path.join(rootDir, 'dist', 'assets')
const manifestPath = path.join(rootDir, 'dist', '.vite', 'manifest.json')

const budgets = {
  entryCss: 20_000,
  entryJs: 80_000,
  firebaseAuthVendor: 120_000,
  firebaseFirestoreVendor: 525_000,
  initialAssetsGzip: 180_000,
  startupTransfer: 200_000,
  authenticatedShellGzip: 360_000,
  splashImage: 100_000,
  adminDashboardJsGzip: 14_000,
  adminDashboardCssGzip: 10_000,
  courseDetailJsGzip: 15_000,
  courseRuntimeJsGzip: 56_000,
  student360JsGzip: 20_000,
  schedulerWorkspaceJsGzip: 29_000,
}

const routeBudgets = [
  { label: 'Dinh dưỡng', key: 'src/pages/student/NutritionPage.tsx', bytes: 84_000 },
  { label: 'Quản lý học viên PT', key: 'src/components/admin/pt/StudentManagement.tsx', bytes: 75_000 },
  { label: 'Tổng quan Admin mới', key: 'src/pages/admin/AdminDashboard.tsx', bytes: 34_000 },
]

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

async function gzipMatchingAsset(pattern) {
  const asset = await largestMatchingAsset(pattern)
  const contents = await readFile(path.join(assetsDir, asset.file))
  return { file: asset.file, bytes: gzipSync(contents).byteLength }
}

function assertWithinBudget(label, asset, budget) {
  if (asset.bytes > budget) {
    throw new Error(`${label} ${asset.file} vượt budget: ${formatBytes(asset.bytes)} > ${formatBytes(budget)}`)
  }
  console.log(`✓ ${label}: ${formatBytes(asset.bytes)} / ${formatBytes(budget)}`)
}

const [entryCss, entryJs, firebaseAuthVendor, firebaseFirestoreVendor, adminDashboardJs, adminDashboardCss, courseDetailJs, courseRuntimeJs, student360Js, schedulerWorkspaceJs, splashStats, html, builtHtml, appSource, onboardingSource] = await Promise.all([
  largestMatchingAsset(/^index-[\w-]+\.css$/),
  largestMatchingAsset(/^index-[\w-]+\.js$/),
  largestMatchingAsset(/^vendor-firebase-auth-[\w-]+\.js$/),
  largestMatchingAsset(/^vendor-firebase-firestore-[\w-]+\.js$/),
  gzipMatchingAsset(/^AdminDashboard-[\w-]+\.js$/),
  gzipMatchingAsset(/^AdminDashboard-[\w-]+\.css$/),
  gzipMatchingAsset(/^CourseDetailPage-[\w-]+\.js$/),
  gzipMatchingAsset(/^CourseLessonRuntime-[\w-]+\.js$/),
  gzipMatchingAsset(/^Student360Page-[\w-]+\.js$/),
  gzipMatchingAsset(/^SchedulerWrapper-[\w-]+\.js$/),
  stat(path.join(rootDir, 'public', 'aura-onboarding.webp')),
  readFile(path.join(rootDir, 'index.html'), 'utf8'),
  readFile(path.join(rootDir, 'dist', 'index.html'), 'utf8'),
  readFile(path.join(rootDir, 'src', 'App.tsx'), 'utf8'),
  readFile(path.join(rootDir, 'src', 'onboarding', 'screens', 'OnboardingScreens.tsx'), 'utf8'),
])

assertWithinBudget('CSS khởi động', entryCss, budgets.entryCss)
assertWithinBudget('JS khởi động', entryJs, budgets.entryJs)
assertWithinBudget('Firebase Auth vendor', firebaseAuthVendor, budgets.firebaseAuthVendor)
assertWithinBudget('Firebase Firestore vendor', firebaseFirestoreVendor, budgets.firebaseFirestoreVendor)
assertWithinBudget('Admin Dashboard JS gzip', adminDashboardJs, budgets.adminDashboardJsGzip)
assertWithinBudget('Admin Dashboard CSS gzip', adminDashboardCss, budgets.adminDashboardCssGzip)
assertWithinBudget('Trang đọc khóa học JS gzip', courseDetailJs, budgets.courseDetailJsGzip)
assertWithinBudget('Runtime media khóa học JS gzip', courseRuntimeJs, budgets.courseRuntimeJsGzip)
assertWithinBudget('Học viên 360 JS gzip', student360Js, budgets.student360JsGzip)
assertWithinBudget('Workspace xếp lịch JS gzip', schedulerWorkspaceJs, budgets.schedulerWorkspaceJsGzip)
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

const startupTransfer = initialAssetsGzip + gzipSync(Buffer.from(builtHtml)).byteLength
if (startupTransfer > budgets.startupTransfer) {
  throw new Error(`Tổng tải khởi động gồm HTML vượt budget: ${formatBytes(startupTransfer)} > ${formatBytes(budgets.startupTransfer)}`)
}
console.log(`✓ Tổng tải khởi động gồm HTML: ${formatBytes(startupTransfer)} / ${formatBytes(budgets.startupTransfer)}`)

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const initialAssetFiles = new Set(initialAssetNames.map((file) => `assets/${file}`))

function collectStaticRouteAssets(manifestKey, visited = new Set()) {
  if (visited.has(manifestKey)) return new Set()
  visited.add(manifestKey)
  const entry = manifest[manifestKey]
  if (!entry) throw new Error(`Không tìm thấy route ${manifestKey} trong Vite manifest.`)

  const files = new Set([entry.file, ...(entry.css ?? [])])
  for (const importKey of entry.imports ?? []) {
    for (const file of collectStaticRouteAssets(importKey, visited)) files.add(file)
  }
  return files
}

function resolveRouteManifestKey(sourceKey) {
  if (manifest[sourceKey]) return sourceKey
  const routeName = path.basename(sourceKey, path.extname(sourceKey))
  const match = Object.entries(manifest).find(([, entry]) => entry.src === sourceKey || (entry.isDynamicEntry && entry.name === routeName))
  if (!match) throw new Error(`Không tìm thấy route ${sourceKey} trong Vite manifest.`)
  return match[0]
}

// The authenticated shell is intentionally lazy. Route budgets measure only
// what each page adds after this shared shell has loaded, matching the previous
// metric while keeping the public/auth startup budget much smaller.
const authenticatedShellFiles = collectStaticRouteAssets(resolveRouteManifestKey('src/AuraApplication.tsx'))
const authenticatedShellOnlyFiles = [...authenticatedShellFiles].filter((file) => !initialAssetFiles.has(file))
const authenticatedBaselineFiles = new Set([...initialAssetFiles, ...authenticatedShellFiles])

const shellGzipSizes = await Promise.all(authenticatedShellOnlyFiles.map(async (file) => {
  const contents = await readFile(path.join(rootDir, 'dist', file))
  return gzipSync(contents).byteLength
}))
assertWithinBudget('Shell sau đăng nhập · tải thêm', {
  file: `${authenticatedShellOnlyFiles.length} assets`,
  bytes: shellGzipSizes.reduce((sum, bytes) => sum + bytes, 0),
}, budgets.authenticatedShellGzip)

for (const route of routeBudgets) {
  const routeFiles = [...collectStaticRouteAssets(resolveRouteManifestKey(route.key))]
    .filter((file) => !authenticatedBaselineFiles.has(file))
  const gzipSizes = await Promise.all(routeFiles.map(async (file) => {
    const contents = await readFile(path.join(rootDir, 'dist', file))
    return gzipSync(contents).byteLength
  }))
  const total = gzipSizes.reduce((sum, bytes) => sum + bytes, 0)
  assertWithinBudget(`${route.label} · tải thêm`, { file: `${routeFiles.length} assets`, bytes: total }, route.bytes)
}

const startupSources = [html, appSource, onboardingSource].join('\n')
if (startupSources.includes('/aura-onboarding.png')) {
  throw new Error('Luồng khởi động vẫn tham chiếu ảnh PNG dung lượng lớn.')
}

console.log('✓ Không còn tải ảnh splash PNG trong luồng khởi động')

if (/rel=["']preload["'][^>]+aura-onboarding\.webp|class=["']app-loader-image["']/.test(html)) {
  throw new Error('HTML khởi động vẫn tải ảnh splash trước khi biết trạng thái đăng nhập.')
}
console.log('✓ HTML khởi động không còn cạnh tranh băng thông với ảnh splash')
