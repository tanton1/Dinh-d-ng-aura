import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from '@playwright/test'

const mockModule = `
window.reviewFixture = { requests: [] };
function pending(kind, input) { return new Promise(resolve => window.reviewFixture.requests.push({kind,input,resolve})); }
export const listStudent360Directory = input => pending('directory', input);
export const listTrainerFeedbackAdmin = input => pending('quality', input);
export const listPerformanceReviewQueue = input => pending('performance', input);
export const PERFORMANCE_PROFILE_KEYS = ['photo','bio','certifications','expertise','case_studies','reviews','intro_video','social_links','schedule','contact'];
export const trackProductEvent = async () => {};
export const listPtScheduleBranches = async () => ({ branches: [] });
export const provisionStudentAccount = async () => ({});
export const createStudentCommandKey = () => 'fixture';
export const hardDeleteStudent = async () => ({});
export const isHardDeleteConfirmation = () => false;
export const updateStudentProfile = async () => ({});
export const reviewTrainerFeedback = async () => ({});
export const reviewPerformanceBrandEvidence = async () => ({});
export const savePerformanceProfileChecklist = async () => ({});
`
const entryModule = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import '/src/styles-bootstrap.css';
import '/src/styles-aura-tokens.css';
import Directory from '/src/components/admin/pt/AdminStudentDirectoryV2.tsx';
import Quality from '/src/pages/admin/TrainerQualityPage.tsx';
import Performance from '/src/components/performance/PerformanceBrandReviewPanel.tsx';
const surface = new URLSearchParams(location.search).get('surface');
createRoot(document.getElementById('root')).render(surface === 'directory' ? React.createElement(Directory, {canManage:true, initialSearchQuery:'rare', onOpenStudent360:()=>{}}) : surface === 'quality' ? React.createElement(Quality) : React.createElement(Performance));
`

const row = (studentId, name) => ({ studentId, name, status: 'active', phone: '', branchId: 'a', branchName: 'A', remainingSessions: 10, daysRemaining: 30, nextSession: null, alertCount: 0, healthAvailable: true, health: { score: 90, status: 'stable', confidence: 'high', observedWeight: 100, components: [] } })
const directoryPage = (rows, scanned, nextCursor, matchedSoFar, scannedTotal) => ({ rows, scanned, nextCursor, hasMore: Boolean(nextCursor), matchedSoFar, scannedTotal, totalMatched: nextCursor ? null : matchedSoFar, countComplete: !nextCursor, truncated: Boolean(nextCursor) })
const qualityPage = title => ({ rows: [{ id: title, sessionId: title, studentId: title, studentName: title, trainerId: 'pt', trainerName: title, branchId: 'a', branchName: 'A', sessionDate: '2026-10-30', sessionHour: 9, overallScore: 5, status: 'submitted', tags: [], comment: '', anonymousToTrainer: false, issueCategory: 'none', submittedAt: null, reviewedAt: null, reviewedBy: '', resolutionNote: '' }], trainers: [], branches: [], truncated: false, attendanceTruncated: false, hasMore: false, nextCursor: null, summary: { total: 1, averageScore: 5, lowCount: 0, needsReview: 0, responseRate: 100, responseCount: 1, eligibleAttendanceCount: 1, complete: true, responseComplete: true, byTrainer: [] } })

test('real components keep bounded directory scans, reject stale filter responses and load exact profile checklists', { timeout: 120000 }, async () => {
  const server = await createServer({
    configFile: false, cacheDir: 'test-results/pt-review-directory-vite-cache',
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'lucide-react'] },
    server: { host: '127.0.0.1', port: 0, strictPort: false },
    plugins: [{ name: 'review-fixture', enforce: 'pre',
      resolveId(source, importer) {
        if (source === '/review-entry.jsx') return '\0review-entry.jsx'
        if (!importer?.replaceAll('\\', '/').includes('/src/')) return
        if (source === './PerformanceScorecardReviewPanel') return '\0scorecard.jsx'
        if (/\/(student360Service|sessionFeedbackService|performanceScoreService|analyticsService|identityAccessService|studentManagementService|ptSchedulePublishService)$/.test(source)) return '\0review-mocks.js'
      },
      load(id) {
        if (id === '\0review-entry.jsx') return entryModule
        if (id === '\0review-mocks.js') return mockModule
        if (id === '\0scorecard.jsx') return 'export default function Scorecard(){return null}'
      },
      configureServer(vite) { vite.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith('/?surface=')) return next()
        response.setHeader('Content-Type', 'text/html'); response.end(await vite.transformIndexHtml(request.url, '<div id="root"></div><script type="module" src="/review-entry.jsx"></script>'))
      }) },
    }, react()],
  })
  let browser
  try {
    await server.listen()
    const port = server.httpServer.address().port
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) })
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
    const open = async surface => {
      await page.goto(`http://127.0.0.1:${port}/?surface=${surface}`)
      try { await page.waitForFunction(() => window.reviewFixture?.requests.length === 1, null, { timeout: 10000 }) }
      catch (error) { throw new Error(`${surface}: ${errors.join(' | ')}; ${await page.locator('body').innerText()}; ${error.message}`) }
    }
    const waitCount = count => page.waitForFunction(value => window.reviewFixture.requests.length === value, count)
    const resolve = (index, value) => page.evaluate(({ index, value }) => window.reviewFixture.requests[index].resolve(value), { index, value })
    const render = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

    await open('directory')
    assert.equal(await page.getByRole('button', { name: 'Bộ lọc học viên', exact: true }).getAttribute('aria-expanded'), 'false')
    assert.equal(await page.getByRole('combobox').count(), 0, 'advanced filters stay hidden on initial load')
    for (let index = 0; index < 3; index++) { await waitCount(index + 1); await resolve(index, directoryPage([], 500, `cursor_${index}`, 0, (index + 1) * 500)) }
    await page.getByRole('button', { name: 'Tiếp tục tìm học viên' }).waitFor()
    await render()
    assert.equal(await page.evaluate(() => window.reviewFixture.requests.length), 3, 'must stop after three empty source pages')
    assert.equal(await page.getByText('Chưa có học viên phù hợp', { exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Tiếp tục tìm học viên' }).click()
    for (let index = 3; index < 5; index++) { await waitCount(index + 1); await resolve(index, directoryPage([], 500, `cursor_${index}`, 0, (index + 1) * 500)) }
    await waitCount(6)
    await resolve(5, directoryPage([row('last', 'Rare learner after 2500')], 1, null, 1, 2501))
    await page.getByText('Rare learner after 2500', { exact: true }).waitFor()
    await page.getByText('hồ sơ khớp bộ lọc', { exact: false }).waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    assert.ok((await page.getByText('Rare learner after 2500', { exact: true }).boundingBox()).y < 300, 'the first learner stays visible near the search bar on mobile')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: 'test-results/student-directory-mobile-20261030.png', fullPage: true })
    await page.getByRole('button', { name: 'Bộ lọc học viên', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'Bộ lọc học viên', exact: true }).getAttribute('aria-expanded'), 'true')
    await page.screenshot({ path: 'test-results/student-directory-mobile-filters-20261030.png', fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.setViewportSize({ width: 1280, height: 720 })

    await open('directory')
    await page.getByRole('button', { name: 'Bộ lọc học viên', exact: true }).click()
    await page.getByRole('combobox', { name: /^Hợp đồng/ }).selectOption('active')
    await waitCount(2)
    await resolve(0, directoryPage([row('stale', 'STALE DIRECTORY')], 1, null, 1, 1))
    await render()
    assert.equal(await page.getByText('STALE DIRECTORY', { exact: true }).count(), 0)
    await resolve(1, directoryPage([row('fresh', 'FRESH DIRECTORY')], 1, null, 1, 1))
    await page.getByText('FRESH DIRECTORY', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Bộ lọc học viên', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'Bộ lọc học viên', exact: true }).innerText(), '1')
    assert.equal(await page.getByRole('combobox').count(), 0)
    await page.getByRole('button', { name: 'Bộ lọc học viên', exact: true }).click()
    assert.equal(await page.getByRole('combobox', { name: /^Hợp đồng/ }).inputValue(), 'active')
    assert.equal(await page.evaluate(() => window.reviewFixture.requests.length), 2, 'opening and closing filters does not reload the directory')

    await open('quality')
    const startInput = page.getByLabel('Buổi tập từ ngày', { exact: true })
    await startInput.fill(await startInput.inputValue() === '2026-10-01' ? '2026-10-02' : '2026-10-01')
    await waitCount(2)
    await resolve(0, qualityPage('STALE QUALITY'))
    await render()
    assert.equal(await page.getByText('STALE QUALITY', { exact: true }).count(), 0)
    await resolve(1, qualityPage('FRESH QUALITY'))
    await page.getByText('FRESH QUALITY', { exact: true }).first().waitFor()
    await page.getByText('100%', { exact: true }).waitFor()

    await open('performance')
    const staff = [{ staffId: 'pt', ownerUid: 'pt', name: 'PT beyond first page', branchIds: ['a'] }]
    await resolve(0, { rows: [], profiles: [], staff, nextCursor: null })
    await page.getByRole('tab', { name: 'Hồ sơ PT' }).click()
    await waitCount(2)
    await resolve(1, { rows: [], profiles: [], staff, nextCursor: null })
    await page.getByRole('combobox', { name: /^Chọn PT/ }).selectOption('pt')
    await waitCount(3)
    assert.equal(await page.getByRole('button', { name: 'Lưu đánh giá hồ sơ' }).isDisabled(), true)
    assert.equal(await page.evaluate(() => window.reviewFixture.requests[2].input.profileStaffId), 'pt')
    await resolve(2, { rows: [], profiles: [{ id: 'profile', staffId: 'pt', checklist: { bio: true } }], staff: [], nextCursor: null })
    await page.getByRole('checkbox', { name: /Bio rõ định vị/ }).waitFor()
    assert.equal(await page.getByRole('checkbox', { name: /Bio rõ định vị/ }).isChecked(), true)
    assert.equal(await page.getByRole('button', { name: 'Lưu đánh giá hồ sơ' }).isDisabled(), false)
    assert.deepEqual(errors, [])
  } finally { await browser?.close(); await server.close() }
})
