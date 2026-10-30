import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'

async function harness(databaseAvailable = true, demo = false, functionsAvailable = true) {
  const state = { auth: { currentUser: { uid: 'admin-a' } as object | null }, rows: [] as any[], reads: [] as any[], failure: null as Error | null,
    defer: false, pending: [] as Array<() => void>, overview: {} as any, overviewRequests: [] as any[], databaseAvailable, serverSettingsReads: 0,
    cachedSettings: null as any, serverSettingsFailure: null as Error | null, defaultDocumentReads: 0,
    writes: [] as any[], writeFailure: null as Error | null, documents: new Map<string, any>(), localCache: new Map<string, string>(), serverQueryReads: 0, serverQueryFailure: null as Error | null,
    functionsAvailable, callableFailure: null as Error | null, dispatchRequests: [] as any[] }
  ;(globalThis as any).__pushHistoryRead = state
  const result = await build({ stdin: { contents: `export { dispatchAdminPushBroadcast, getPushBroadcastLogsPage, getPushBroadcastLogs, getPushAdminOverview, getPushAutomationLogs, getSystemPushSettings, getPushTemplates, savePushTemplate, deletePushTemplate, togglePushTemplateActive, DEFAULT_PUSH_TEMPLATES } from './src/services/notificationService'; export { filterAudienceUsers } from './src/pages/admin/push/pushTypes'`, resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', format: 'esm',
    define: { 'import.meta.env': JSON.stringify({ MODE: 'production', VITE_FORCE_DEMO: demo ? 'true' : 'false' }) },
    plugins: [{ name: 'push-read-fakes', setup(builder) {
      builder.onResolve({ filter: /^(firebase\/(firestore|functions))$|lib\/firebase(?:Firestore|Functions)?$|lib\/safeStorage$/ }, args => ({ path: args.path, namespace: 'push-read-fakes' }))
      builder.onLoad({ filter: /.*/, namespace: 'push-read-fakes' }, ({ path }) => ({ contents: `const s = globalThis.__pushHistoryRead;\n` + (
        path === 'firebase/firestore' ? `
          export const collection = (_, ...parts) => ({ path: parts.join('/'), clauses: [] });
          export const doc = (_, ...parts) => ({ path: parts.join('/') });
          export const documentId = () => '__name__';
          export const query = (source, ...clauses) => ({ ...source, clauses });
          export const orderBy = (field, direction) => ({ kind: 'order', field, direction });
          export const startAfter = (snapshot) => ({ kind: 'cursor', snapshot });
          export const limit = value => ({ kind: 'limit', value });
          export const getDocs = async source => {
            s.reads.push(source); if (s.failure) throw s.failure;
            const rows = [...s.rows].sort((a,b) => b.createdAt-a.createdAt || b.id.localeCompare(a.id));
            const cursor = source.clauses.find(x => x.kind === 'cursor');
            const offset = cursor ? rows.findIndex(x => x.id === cursor.snapshot.id) + 1 : 0;
            const count = source.clauses.find(x => x.kind === 'limit')?.value;
            const selected = rows.slice(offset, count ? offset+count : undefined).map(row => ({ id: row.id, data: () => row }));
            if (s.defer) await new Promise(resolve => s.pending.push(resolve));
            return { docs: selected };
          };
          export const getDocsFromServer = async source => { s.serverQueryReads++; if (s.serverQueryFailure) throw s.serverQueryFailure; return getDocs(source); };
          export const onSnapshot = () => { throw Error('Unexpected listener'); };
          export const where = () => {}; export const serverTimestamp = () => 1;
          export const setDoc = async (ref,value,options) => { s.writes.push({ kind: 'set', ref, value, options }); if (s.writeFailure) throw s.writeFailure; s.documents.set(ref.path, value); };
          export const getDoc = async () => { s.defaultDocumentReads++; if (s.failure) throw s.failure; return { exists: () => Boolean(s.cachedSettings), data: () => s.cachedSettings, metadata: { fromCache: Boolean(s.cachedSettings) } }; };
          export const getDocFromServer = async () => { s.serverSettingsReads++; if (s.serverSettingsFailure) throw s.serverSettingsFailure; return getDoc(); };
          export const updateDoc = async (ref,value) => { s.writes.push({ kind: 'update', ref, value }); if (s.writeFailure) throw s.writeFailure; if (!s.documents.has(ref.path)) throw Error('not-found'); s.documents.set(ref.path, { ...s.documents.get(ref.path), ...value }); };
          export const deleteDoc = async ref => { s.writes.push({ kind: 'delete', ref }); if (s.writeFailure) throw s.writeFailure; s.documents.delete(ref.path); };
          export const writeBatch = () => { throw Error('Unexpected batch write'); };
        ` : path === 'firebase/functions' ? `export const httpsCallable = (_,name) => async input => { if (name === 'dispatchPushBroadcast') { s.dispatchRequests.push(input); if(s.callableFailure) throw s.callableFailure; } else { s.overviewRequests.push(input); } return { data: s.overview }; };`
          : path.endsWith('/firebaseFirestore') ? 'export const firestoreDb = s.databaseAvailable ? {} : null'
            : path.endsWith('/firebaseFunctions') ? 'export const firebaseFunctions = s.functionsAvailable ? {} : null'
              : path.endsWith('/safeStorage') ? 'export const safeLocalStorageSet = (key,value) => { s.localCache.set(key,value); }'
                : 'export const firebaseAuth = s.auth'
      ) }))
    } }],
  })
  const service = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${Math.random()}`)
  return { state, service }
}

const broadcastInput = { title: 'Draft title', message: 'Draft message', type: 'INFO', category: 'general', targetType: 'category', targetUserIds: ['student-a'], actionUrl: '/home' }

test('production send without Functions never reads or writes Firestore and explicit demo stays local', async () => {
  const production = await harness(true, false, false)
  await assert.rejects(production.service.dispatchAdminPushBroadcast(broadcastInput), /Chưa gửi thông báo nào/)
  assert.equal(production.state.reads.length, 0); assert.equal(production.state.writes.length, 0)
  assert.equal(production.state.dispatchRequests.length, 0); assert.equal(production.state.localCache.size, 0)
  const demo = await harness(true, true, true)
  assert.equal((await demo.service.dispatchAdminPushBroadcast(broadcastInput)).sentCount, 1)
  assert.equal(demo.state.reads.length, 0); assert.equal(demo.state.writes.length, 0); assert.equal(demo.state.dispatchRequests.length, 0)
})

test('audience admission failures propagate unchanged with one callable attempt and no fallback effects', async () => {
  const { state, service } = await harness()
  for (const reason of ['SELECTED_AUDIENCE_LIMIT', 'POPULATION_LIMIT', 'DIRECTORY_LIMIT', 'DEVICE_LIMIT', 'ADMISSION_TIMEOUT']) {
    const error = Object.assign(new Error('Chưa gửi thông báo nào; hãy thu hẹp nhóm.'), { code: 'functions/resource-exhausted', details: { reason, noDeliveryStarted: true } })
    state.callableFailure = error
    await assert.rejects(service.dispatchAdminPushBroadcast(broadcastInput), actual => actual === error)
  }
  assert.equal(state.dispatchRequests.length, 5)
  assert(state.dispatchRequests.every(input => input === broadcastInput))
  assert.equal(state.reads.length, 0); assert.equal(state.writes.length, 0); assert.equal(state.localCache.size, 0)
})

test('existing goal aliases, opt-in groups and Academy meaning are unchanged before selected dispatch', async () => {
  const { state, service } = await harness()
  const user = (uid: string, extra: object = {}) => ({ uid, role: 'student', status: 'active', ...extra })
  const users = [user('lose', { goals: [' GiẢM CÂN '] }), user('gain', { nutritionProfile: { goal: 'muscle_gain' } }), user('maintain', { goals: ['maintenance'] }), user('health', { goals: ['healthy'] }),
    user('disabled', { status: 'disabled', goals: ['giảm cân'] }), user('staff', { role: 'coach', goals: ['giảm cân'] }),
    user('master-out', { notificationSettings: { enabled: false } }), user('nutrition-out', { notificationSettings: { mealReminders: false } })]
  for (const [group, expected] of [['goal_lose_fat', 'lose'], ['goal_gain_muscle', 'gain'], ['goal_maintain', 'maintain'], ['goal_health', 'health']]) {
    const ids = service.filterAudienceUsers(users, group, '').map((item: any) => item.uid)
    assert.deepEqual(ids, [expected]); state.overview = { sentCount: 1, webPushSentCount: 0, webPushFailureCount: 0, filteredOutCount: 0, logId: 'log' }
    await service.dispatchAdminPushBroadcast({ ...broadcastInput, targetUserIds: ids })
    assert.deepEqual(state.dispatchRequests.at(-1).targetUserIds, [expected])
  }
  assert.deepEqual(service.filterAudienceUsers(users, 'academy', '').map((u: any) => u.uid), ['lose', 'gain', 'maintain', 'health', 'master-out', 'nutrition-out'])
  assert.deepEqual(service.filterAudienceUsers(users, 'pref_nutrition', '').map((u: any) => u.uid), ['lose', 'gain', 'maintain', 'health'])
})

test('broadcast history pages use stable timestamp/id cursor and return every row beyond 2500', async () => {
  const { state, service } = await harness()
  state.rows = Array.from({ length: 2507 }, (_, i) => ({ id: `log-${String(i).padStart(5, '0')}`, createdAt: Math.floor(i / 3), title: `Log ${i}` }))
  const expected = [...state.rows].sort((a,b) => b.createdAt-a.createdAt || b.id.localeCompare(a.id)).map(row => row.id)
  let cursor = null
  const actual: string[] = []
  do {
    const result = await service.getPushBroadcastLogsPage({ cursor })
    assert.ok(result.items.length <= 25)
    actual.push(...result.items.map((item: any) => item.id))
    assert.equal(result.hasMore, Boolean(result.nextCursor))
    cursor = result.nextCursor
  } while (cursor)
  assert.deepEqual(actual, expected)
  assert.ok(state.reads.every(source => source.clauses.some((c: any) => c.kind === 'limit' && c.value === 26)))
  assert.deepEqual(state.reads[0].clauses.filter((c: any) => c.kind === 'order'), [{ kind: 'order', field: 'createdAt', direction: 'desc' }, { kind: 'order', field: '__name__', direction: 'desc' }])
})

test('empty, exact-page, invalid-size and compatibility reads remain bounded', async () => {
  const { state, service } = await harness()
  assert.deepEqual(await service.getPushBroadcastLogsPage(), { items: [], hasMore: false, nextCursor: null })
  state.rows = Array.from({ length: 50 }, (_, i) => ({ id: `r-${i}`, createdAt: i }))
  const page = await service.getPushBroadcastLogsPage({ pageSize: 50 })
  assert.equal(page.items.length, 50); assert.equal(page.hasMore, false)
  const count = state.reads.length
  for (const pageSize of [0, 51, -1, 1.5, NaN]) await assert.rejects(service.getPushBroadcastLogsPage({ pageSize }))
  assert.equal(state.reads.length, count)
  assert.equal((await service.getPushBroadcastLogs()).length, 25)
})

test('private history cannot reuse cursor or late response across authentication sessions', async () => {
  const { state, service } = await harness()
  state.rows = Array.from({ length: 30 }, (_, i) => ({ id: `r-${i}`, createdAt: i }))
  const page = await service.getPushBroadcastLogsPage()
  const count = state.reads.length
  state.auth.currentUser = { uid: 'admin-a' }
  await assert.rejects(service.getPushBroadcastLogsPage({ cursor: page.nextCursor }), /Phiên đăng nhập/)
  assert.equal(state.reads.length, count, 'even same UID re-login cannot use an earlier session cursor')
  state.defer = true
  const pending = service.getPushBroadcastLogsPage()
  state.auth.currentUser = { uid: 'admin-b' }
  state.pending.shift()!()
  await assert.rejects(pending, /Phiên đăng nhập/)
  state.auth.currentUser = null
  await assert.rejects(service.getPushBroadcastLogsPage(), /Phiên đăng nhập/)
})

test('read failures propagate without local history fallback and unknown metrics are rejected', async () => {
  const { state, service } = await harness()
  ;(globalThis as any).localStorage = { getItem: () => { throw Error('Private cache must not be consulted'); } }
  state.failure = new Error('permission-denied')
  await assert.rejects(service.getPushBroadcastLogsPage(), /permission-denied/)
  await assert.rejects(service.getPushAutomationLogs(), /permission-denied/)
  state.failure = null
  state.rows = [{ id: 'private-old-account', createdAt: 1 }]
  state.serverQueryFailure = new Error('unavailable: offline private cache')
  const cachedReads = state.reads.length
  await assert.rejects(service.getPushBroadcastLogsPage(), /offline private cache/)
  await assert.rejects(service.getPushAutomationLogs(), /offline private cache/)
  assert.equal(state.reads.length, cachedReads, 'private histories do not fall back to cached Firestore query results')
  const complete = { activeUsers: 3, pushEnabledUsers: 2, activeDevices: 4, webPushAccepted24h: 5, webPushFailures24h: 1 }
  for (const value of [{}, { ...complete, activeDevices: null }, { ...complete, activeUsers: -1 }, { ...complete, webPushAccepted24h: NaN }]) {
    state.overview = value
    await assert.rejects(service.getPushAdminOverview(), /chưa đầy đủ/)
  }
  state.overview = complete
  assert.equal((await service.getPushAdminOverview()).activeDevices, 4)
  delete (globalThis as any).localStorage
})

test('overview distinguishes cached opens and explicit fresh reads, rejects incomplete totals and preserves source time', async () => {
  const { state, service } = await harness()
  const counts = { activeUsers: 3, pushEnabledUsers: 2, activeDevices: 4, webPushAccepted24h: 5, webPushFailures24h: 1 }
  state.overview = { ...counts, complete: true, asOf: '2026-10-30T02:00:00.000Z', windowStart: '2026-10-29T02:00:00.000Z' }
  const first = await service.getPushAdminOverview()
  await service.getPushAdminOverview({ forceRefresh: true })
  assert.deepEqual(state.overviewRequests, [{}, { forceRefresh: true }])
  assert.equal(first.asOf, state.overview.asOf)
  assert.equal(first.windowStart, state.overview.windowStart)
  state.overview = { ...counts, complete: false, reason: 'scan-limit' }
  await assert.rejects(service.getPushAdminOverview(), /vượt giới hạn/)
  state.overview = { ...counts, complete: false, reason: 'invalid-metric' }
  await assert.rejects(service.getPushAdminOverview(), /chưa đầy đủ/)
  state.overview = { ...counts, asOf: 'invalid', windowStart: 'invalid' }
  const compatible = await service.getPushAdminOverview()
  assert.equal(compatible.asOf, undefined)
  assert.equal(compatible.windowStart, undefined)
  assert.equal(compatible.activeUsers, counts.activeUsers)
})

test('strict admin settings cannot fall back to defaults/cache or look ready without a database', async () => {
  const { state, service } = await harness()
  state.failure = new Error('permission-denied')
  await assert.rejects(service.getSystemPushSettings({ requireServer: true }), /permission-denied/)
  state.failure = null
  state.cachedSettings = { enabled: true, automationEnabled: true, autoMealReminders: true }
  state.serverSettingsFailure = new Error('unavailable: offline server')
  const defaultReads = state.defaultDocumentReads
  await assert.rejects(service.getSystemPushSettings({ requireServer: true }), /offline server/)
  assert.equal(state.defaultDocumentReads, defaultReads, 'available offline cache cannot replace the failed authoritative read')
  state.cachedSettings = null
  state.serverSettingsFailure = null
  const missing = await service.getSystemPushSettings({ requireServer: true })
  assert.equal(state.serverSettingsReads, 3, 'strict reads never accept an offline cached Firestore snapshot')
  assert.equal(typeof missing.enabled, 'boolean', 'authoritative missing config uses known system defaults')
  const unavailable = await harness(false)
  await assert.rejects(unavailable.service.getSystemPushSettings({ requireServer: true }), /máy chủ/)
  await assert.rejects(unavailable.service.getPushBroadcastLogsPage(), /chưa sẵn sàng/)
  await assert.rejects(unavailable.service.getPushAutomationLogs(), /chưa sẵn sàng/)
})

test('production template reads are authoritative and never seed, write cache or resurrect defaults', async () => {
  const { state, service } = await harness()
  assert.deepEqual(await service.getPushTemplates(), [])
  assert.equal(state.writes.length, 0)
  assert.equal(state.localCache.size, 0)
  state.rows = [{ id: 'custom', title: 'Custom', message: 'Saved message', createdAt: 1 }]
  assert.deepEqual((await service.getPushTemplates()).map((item: any) => item.id), ['custom'])
  state.serverQueryFailure = new Error('unavailable')
  await assert.rejects(service.getPushTemplates(), /unavailable/)
  assert.equal(state.writes.length, 0)
  assert.equal(state.localCache.size, 0)
})

test('template mutations write only the target, propagate failures and never create partial toggle records', async () => {
  const { state, service } = await harness()
  const template = { ...service.DEFAULT_PUSH_TEMPLATES[0], id: 'custom' }
  const path = 'system/push_templates/templates/custom'
  await service.savePushTemplate(template)
  assert.equal(state.documents.get(path).title, template.title)
  await service.togglePushTemplateActive('custom', false)
  assert.equal(state.documents.get(path).active, false)
  assert.equal(state.documents.get(path).message, template.message)
  assert.deepEqual(Object.keys(state.writes[1].value).sort(), ['active', 'updatedAt'])
  await service.deletePushTemplate('custom')
  assert.equal(state.documents.has(path), false)
  await assert.rejects(service.togglePushTemplateActive(service.DEFAULT_PUSH_TEMPLATES[0].id, true), /not-found/)
  assert.equal(state.documents.size, 0, 'missing built-in IDs do not get resurrected as partial records')
  state.writeFailure = new Error('permission-denied')
  await assert.rejects(service.savePushTemplate(template), /permission-denied/)
  await assert.rejects(service.deletePushTemplate('custom'), /permission-denied/)
  await assert.rejects(service.togglePushTemplateActive('custom', true), /permission-denied/)
  assert.equal(state.reads.length, 0)
  assert.equal(state.serverQueryReads, 0)
  assert.equal(state.defaultDocumentReads, 0)
  assert.equal(state.localCache.size, 0)
  const writes = state.writes.length
  await assert.rejects(service.savePushTemplate({ ...template, id: 'invalid/path' }), /không hợp lệ/)
  await assert.rejects(service.deletePushTemplate(''), /không hợp lệ/)
  await assert.rejects(service.togglePushTemplateActive('custom', 'yes'), /không hợp lệ/)
  assert.equal(state.writes.length, writes)
})

test('demo template catalog remains local and supports empty lists, edits, deletion and toggles', async () => {
  const { state, service } = await harness(false, true)
  ;(globalThis as any).localStorage = { getItem: (key: string) => state.localCache.get(key) ?? null }
  const initial = await service.getPushTemplates()
  assert.ok(initial.length > 0)
  await service.togglePushTemplateActive(initial[0].id, false)
  assert.equal((await service.getPushTemplates())[0].active, false)
  const changed = { ...initial[0], title: 'Demo updated' }
  await service.savePushTemplate(changed)
  assert.equal((await service.getPushTemplates())[0].title, 'Demo updated')
  for (const item of initial) await service.deletePushTemplate(item.id)
  assert.deepEqual(await service.getPushTemplates(), [])
  assert.equal(state.reads.length, 0)
  assert.equal(state.writes.length, 0)
  delete (globalThis as any).localStorage
})
