import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { nutritionReadPolicy, nutritionDateAfter } from '../src/features/nutrition/readLifecycle'

async function harness() {
  const state = {
    auth: { currentUser: { uid: 'a' } as { uid: string } | null }, rows: {} as Record<string, any[]>,
    reads: [] as any[], subscriptions: [] as any[], calls: [] as any[], writes: [] as any[], cache: new Map(),
    metadata: { fromCache: false, hasPendingWrites: false }, metadataOnly: false, failure: null as Error | null,
    hold: false, pending: [] as Array<{ name: string; input: any; resolve: (value: any) => void; reject: (error: Error) => void }>,
  }
  ;(globalThis as any).__nutritionReadTest = state
  const result = await build({ stdin: { contents: `export * from './src/services/firebaseNutritionLogService'; export * from './src/services/nutritionPlanService'; export * from './src/services/nutritionJournalSummaryService'; export * from './src/features/nutrition/catalog';`, resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'nutrition-read-fakes', setup(builder) {
      builder.onResolve({ filter: /(?:firebase\/(?:firestore|functions|storage)|lib\/firebase(?:Functions|Firestore|Storage)?|dataSync\/versionedCache|internalNutritionCatalogService)$/ }, (args) => ({ path: args.path, namespace: 'nutrition-read-fakes' }))
      builder.onLoad({ filter: /.*/, namespace: 'nutrition-read-fakes' }, ({ path }) => ({ contents: `const state = globalThis.__nutritionReadTest;\n` + (
        path === 'firebase/firestore' ? `
          export const collection = (_, ...parts) => ({ path: parts.join('/'), clauses: [] });
          export const query = (source, ...clauses) => ({ ...source, clauses: [...source.clauses, ...clauses] });
          export const where = (field, op, value) => ({ kind: 'where', field, op, value });
          export const orderBy = (field, direction) => ({ kind: 'order', field, direction });
          export const limit = (value) => ({ kind: 'limit', value });
          export const startAfter = (value) => ({ kind: 'cursor', value });
          export const doc = (_, ...parts) => parts.join('/');
          export const setDoc = async () => {}; export const deleteDoc = async () => {}; export const serverTimestamp = () => 123;
          function snapshot(source) {
            let rows = [...(state.rows[source.path] || [])];
            for (const clause of source.clauses.filter(c => c.kind === 'where')) rows = rows.filter(row => clause.op === '==' ? row[clause.field] === clause.value : clause.op === '>=' ? row[clause.field] >= clause.value : row[clause.field] <= clause.value);
            rows.sort((a,b) => String(b.date).localeCompare(String(a.date)) || a.id.localeCompare(b.id));
            const cursor = source.clauses.find(c => c.kind === 'cursor'); if (cursor) rows = rows.slice(rows.findIndex(row => row.id === cursor.value.id) + 1);
            const maximum = source.clauses.find(c => c.kind === 'limit'); if (maximum) rows = rows.slice(0, maximum.value);
            return { docs: rows.map(row => ({ id: row.id, data: () => row })), metadata: { ...state.metadata }, docChanges: () => state.metadataOnly ? [] : rows };
          }
          export const getDocs = async (source) => { state.reads.push(source); if (state.failure) throw state.failure; return snapshot(source); };
          export const onSnapshot = (source, options, next, error) => { if (typeof options === 'function') { error = next; next = options; } const record = { source, stopped: false, emit: () => next(snapshot(source)) }; state.subscriptions.push(record); queueMicrotask(() => { if (!record.stopped) record.emit(); }); return () => { record.stopped = true; }; };
        ` : path === 'firebase/functions' ? `
          export const httpsCallable = (_, name) => (input) => {
            state.calls.push({ name, input });
            if (state.hold) return new Promise((resolve, reject) => state.pending.push({ name, input, resolve: value => resolve({ data: value }), reject }));
            return Promise.resolve({ data: name === 'saveNutritionMealLog' ? { mealId: input.meal.id, mealRevision: (input.expectedMealRevision || 0) + 1 } : name === 'deleteNutritionMealLog' ? { mealId: input.mealId, deleted: true, mealRevision: input.expectedMealRevision } : { plan: null, activePlan: null, assignedPlanAvailable: false } });
          };
        ` : path === 'firebase/storage' ? 'export const getDownloadURL = async () => "photo"; export const ref = (_, path) => path; export const uploadBytes = async () => {}'
          : path.endsWith('/versionedCache') ? `export const readVersionedCache = (key, owner) => { const item = state.cache.get(key); return item?.owner === owner ? item : null }; export const writeVersionedCache = (key, owner, scope, value) => { const item = { owner, scope, value, revision: 1, cachedAt: 'confirmed' }; state.writes.push({ key, ...item }); state.cache.set(key, item); return item };`
            : path.endsWith('/internalNutritionCatalogService') ? `export const listInternalNutritionCatalog = async input => { state.calls.push({ name: 'catalog', input }); if (state.hold) return new Promise((resolve,reject) => state.pending.push({ name: 'catalog', input, resolve, reject })); return { items: [], filteredCount: 0, catalogTotal: 0, catalogVersion: 'v1' }; }; export const getInternalNutritionCatalogItem = async id => { state.calls.push({ name: 'detail', id }); return { id, kind: 'dish', nameVi: id }; };`
              : path.endsWith('/firebaseFunctions') ? 'export const firebaseFunctions = {}'
                : path.endsWith('/firebaseFirestore') ? 'export const firestoreDb = {}'
                  : path.endsWith('/firebaseStorage') ? 'export const firebaseStorage = {}'
                    : 'export const firebaseAuth = state.auth'
      ) }))
    } }],
  })
  const service = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${Math.random()}`)
  return { state, service }
}

test('tab read policy never loads day data for catalog, scan, profile, menu or insights', () => {
  for (const tab of ['catalog', 'scan', 'profile', 'menu', 'insights']) assert.equal(nutritionReadPolicy(tab).day, false, tab)
  for (const tab of ['today', 'diary', 'classic-diary', 'assistant']) assert.equal(nutritionReadPolicy(tab).day, true, tab)
  assert.equal(nutritionReadPolicy('menu').calendar, false)
  assert.equal(nutritionReadPolicy('catalog', true).day, true, 'opening a day editor opts in explicitly')
  assert.equal(nutritionDateAfter('2026-12-31', 1), '2027-01-01')
})

test('one SDK listener per owner/day/source; selected day is complete beyond 100 entries', async () => {
  const { state, service } = await harness()
  state.rows['users/a/mealLogs'] = Array.from({ length: 101 }, (_, index) => ({ id: `m${index}`, date: '2026-10-01', status: 'logged' }))
  const received: any[][] = []
  const stop1 = service.subscribeToUserMealLogsForDate('a', '2026-10-01', (items: any[]) => received.push(items))
  const stop2 = service.subscribeToUserMealLogsForDate('a', '2026-10-01', (items: any[]) => received.push(items))
  await Promise.resolve()
  assert.equal(state.subscriptions.length, 1)
  assert.equal(received.length, 2)
  assert.equal(received[0].length, 101)
  assert.equal(received[0][0].mealRevision, 1, 'persisted legacy meals have canonical revision one')
  const writes = state.writes.length
  state.metadataOnly = true
  state.subscriptions[0].emit()
  assert.equal(received.length, 2, 'metadata-only events update sync status without rendering rows again')
  assert.equal(state.writes.length, writes, 'metadata-only confirmations do not rewrite the same cache')
  state.metadataOnly = false
  const otherDate = service.subscribeToUserMealLogsForDate('a', '2026-10-02', () => {})
  const otherOwner = service.subscribeToUserMealLogsForDate('b', '2026-10-01', () => {})
  assert.equal(state.subscriptions.length, 3)
  stop1(); assert.equal(state.subscriptions[0].stopped, false)
  stop2(); assert.equal(state.subscriptions[0].stopped, true)
  otherDate(); otherOwner()
  assert.ok(state.subscriptions.every(item => item.stopped))
})

test('range fallback pages beyond 1000 and never labels cache or pending writes server-confirmed', async () => {
  const { state, service } = await harness()
  state.rows['users/a/waterLogs'] = Array.from({ length: 1001 }, (_, index) => ({ id: `w${String(index).padStart(4, '0')}`, date: '2026-10-01', amountMl: 100 }))
  state.rows['users/a/waterLogs'].push({ id: 'future', date: '2026-10-03', amountMl: 999 })
  const sync: any[] = []
  const rows = await service.loadRecentUserWaterLogs('a', '2026-10-01', (value: any) => sync.push(value), '2026-10-02')
  assert.equal(rows.length, 1001)
  assert.equal(rows.reduce((sum: number, row: any) => sum + row.amountMl, 0), 100100)
  assert.equal(state.reads.length, 3)
  assert.equal(sync.at(-1).status, 'synced')
  const writes = state.writes.length
  state.metadata.fromCache = true
  await service.loadRecentUserWaterLogs('a', '2026-10-01', (value: any) => sync.push(value), '2026-10-02')
  assert.equal(sync.at(-1).status, 'stale-cache')
  assert.equal(state.writes.length, writes)
  state.metadata.hasPendingWrites = true
  await service.loadRecentUserWaterLogs('a', '2026-10-01', (value: any) => sync.push(value), '2026-10-02')
  assert.equal(sync.at(-1).status, 'pending-local-change')
  assert.equal(state.writes.length, writes)
  state.failure = new Error('permission denied')
  await assert.rejects(service.loadRecentUserWaterLogs('b', '2026-10-01', undefined, '2026-10-02'), /permission denied/)
})

test('meal writes send owner and CAS revisions, preserve idempotency and reject an account change', async () => {
  const { state, service } = await harness()
  await service.saveUserMealLog('a', { id: 'new' }, { idempotencyKey: 'stable-scan-attempt' })
  assert.equal(state.calls[0].input.expectedMealRevision, 0)
  assert.equal(state.calls[0].input.idempotencyKey, 'stable-scan-attempt')
  assert.equal(state.calls[0].input.expectedOwnerUid, 'a')
  const saved = await service.saveUserMealLog('a', { id: 'existing', mealRevision: 7 })
  assert.equal(state.calls[1].input.expectedMealRevision, 7)
  assert.equal(saved.mealRevision, 8)
  await service.deleteUserMealLog('a', 'existing', 8)
  assert.deepEqual(state.calls[2].input, { mealId: 'existing', expectedMealRevision: 8, expectedOwnerUid: 'a' })
  const pending = service.saveUserMealLog('a', { id: 'switch-in-flight' })
  state.auth.currentUser = { uid: 'b' }
  await assert.rejects(pending, /đăng nhập đúng tài khoản/)
  assert.equal(state.calls.length, 3)
})

test('workspace pending requests isolate account, authority and week and invalidate on mutation', async () => {
  const { state, service } = await harness()
  state.hold = true
  const first = service.getMyNutritionPlanWorkspace('2026-10-19', { authorityKey: 'v1' })
  const duplicate = service.getMyNutritionPlanWorkspace('2026-10-19', { authorityKey: 'v1' })
  const changed = service.getMyNutritionPlanWorkspace('2026-10-19', { authorityKey: 'v2' })
  const week = service.getMyNutritionPlanWorkspace('2026-10-26', { authorityKey: 'v1' })
  await Promise.resolve()
  assert.equal(state.calls.length, 3)
  state.auth.currentUser = { uid: 'b' }
  const owner = service.getMyNutritionPlanWorkspace('2026-10-19', { authorityKey: 'v1' })
  await Promise.resolve()
  assert.equal(state.calls.length, 4)
  await assert.rejects(service.getMyNutritionPlanWorkspace('2026-10-19', { ownerId: 'a' }), /đăng nhập/)
  state.pending.forEach(pending => pending.resolve({ plan: null }))
  await Promise.all([first, duplicate, changed, week, owner])
  const fresh = service.getMyNutritionPlanWorkspace('2026-10-19', { authorityKey: 'v1' })
  await Promise.resolve()
  assert.equal(state.calls.length, 5, 'settled results are not hidden behind a TTL')
  const mutation = service.confirmMyNutritionPlan('2026-10-19', 3)
  const afterMutation = service.getMyNutritionPlanWorkspace('2026-10-19', { authorityKey: 'v1' })
  await Promise.resolve()
  assert.equal(state.calls.length, 7, 'mutation invalidates the old pending flight')
  state.pending.slice(4).forEach(pending => pending.resolve({ plan: null, activePlan: null }))
  await Promise.all([fresh, mutation, afterMutation])
})

test('catalog cache is owner-scoped and bounded; late failures cannot evict a newer retry', async () => {
  const { state, service } = await harness()
  await service.loadNutritionCatalogPage({ query: 'first' })
  await service.loadNutritionCatalogPage({ query: 'first' })
  assert.equal(state.calls.length, 1)
  state.auth.currentUser = { uid: 'b' }
  await service.loadNutritionCatalogPage({ query: 'first' })
  assert.equal(state.calls.length, 2)
  for (let index = 0; index < 40; index++) await service.loadNutritionCatalogPage({ query: `search${index}` })
  await service.loadNutritionCatalogPage({ query: 'first' })
  assert.equal(state.calls.length, 43, 'oldest entry is evicted after forty catalog pages')
  state.hold = true
  const stale = service.loadNutritionCatalogPage({ query: 'race' })
  service.resetNutritionCatalog()
  const current = service.loadNutritionCatalogPage({ query: 'race' })
  state.pending[0].reject(new Error('not retryable'))
  await assert.rejects(stale, /not retryable/)
  const duplicate = service.loadNutritionCatalogPage({ query: 'race' })
  assert.equal(state.pending.length, 2)
  state.pending[1].resolve({ items: [], catalogVersion: 'v2' })
  await Promise.all([current, duplicate])
})

test('calendar summary refresh starts a new flight and rejects a mismatched coverage range', async () => {
  const { state, service } = await harness()
  state.hold = true
  const old = service.getMyNutritionJournalSummary('a', '2026-10-01', '2026-10-24', 'role1')
  const joined = service.getMyNutritionJournalSummary('a', '2026-10-01', '2026-10-24', 'role1')
  await Promise.resolve()
  assert.equal(state.calls.length, 1)
  const refresh = service.getMyNutritionJournalSummary('a', '2026-10-01', '2026-10-24', 'role1', true)
  await Promise.resolve()
  assert.equal(state.calls.length, 2)
  assert.equal(state.calls[0].input.forceRefresh, undefined)
  assert.equal(state.calls[1].input.forceRefresh, true)
  assert.equal(state.calls[1].input.authorityKey, undefined, 'authority scope is client-only')
  const refreshAfter = '2026-10-24T04:30:00.000Z'
  state.pending[1].resolve({ items: [], fromDate: '2026-10-01', toDate: '2026-10-24', coverage: 'pending', refreshAfter })
  assert.equal((await refresh).refreshAfter, refreshAfter)
  const poll = service.getMyNutritionJournalSummary('a', '2026-10-01', '2026-10-24', 'role1', false, refreshAfter)
  const joinedPoll = service.getMyNutritionJournalSummary('a', '2026-10-01', '2026-10-24', 'role1', false, refreshAfter)
  await Promise.resolve()
  assert.equal(state.calls.length, 3)
  assert.equal(state.calls[2].input.refreshAfter, refreshAfter)
  assert.equal(state.calls[2].input.forceRefresh, undefined)
  state.pending[2].resolve({ items: [], fromDate: '2026-10-01', toDate: '2026-10-24', coverage: 'ready', refreshAfter })
  await Promise.all([poll, joinedPoll])
  state.pending[0].resolve({ items: [], fromDate: '2026-10-01', toDate: '2026-10-24', coverage: 'ready' })
  await Promise.all([old, joined])
  const invalid = service.getMyNutritionJournalSummary('a', '2026-10-01', '2026-10-24')
  await Promise.resolve()
  state.pending[3].resolve({ items: [], fromDate: '2026-09-01', toDate: '2026-09-30', coverage: 'ready' })
  await assert.rejects(invalid, /không hợp lệ/)
})


test('catalog detail reuse is owner-scoped, expires and clears on explicit refresh', async () => {
  const { state, service } = await harness()
  await Promise.all([service.loadNutritionCatalogDetail('dish-1'), service.loadNutritionCatalogDetail('dish-1')])
  await service.loadNutritionCatalogDetail('dish-1')
  assert.equal(state.calls.filter(call => call.name === 'detail').length, 1)
  state.auth.currentUser = { uid: 'b' }
  await service.loadNutritionCatalogDetail('dish-1')
  assert.equal(state.calls.filter(call => call.name === 'detail').length, 2)
  const realNow = Date.now
  try {
    const later = realNow() + 121_000
    Date.now = () => later
    await service.loadNutritionCatalogDetail('dish-1')
    assert.equal(state.calls.filter(call => call.name === 'detail').length, 3)
  } finally { Date.now = realNow }
  service.resetNutritionCatalog()
  await service.loadNutritionCatalogDetail('dish-1')
  assert.equal(state.calls.filter(call => call.name === 'detail').length, 4)
})
