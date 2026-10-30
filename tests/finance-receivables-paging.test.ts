import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readReceivablesWindow } from '../src/services/financeReceivablesPaging'
import type { ReceivablesPage, ReceivablesQuery } from '../src/services/scopedReportingService'

const query: ReceivablesQuery = { branchId: 'a', today: '2026-10-31', category: 'frozen', filter: 'all', search: '', includeSummary: true, refresh: true }
const row = (id: string) => ({ id, studentId: id } as ReceivablesPage['contracts'][number])
const page = (ids: string[], cursor: string | null): ReceivablesPage => ({ contracts: ids.map(row), students: ids.map(id => ({ id, name: id })), summary: null, nextCursor: cursor, hasMore: Boolean(cursor), asOf: '2026-10-31T00:00:00Z', scanned: 200 })

test('fills a visible page across sparse source pages without repeating summaries or refresh', async () => {
  const calls: ReceivablesQuery[] = []
  const pages = [page([], 'a'), page(['one'], 'b'), page(['two'], null)]
  const result = await readReceivablesWindow(query, async input => { calls.push(input); return pages.shift()! }, () => true)
  assert.deepEqual(result?.contracts.map(row => row.id), ['one', 'two'])
  assert.equal(result?.hasMore, false)
  assert.equal(result?.scanLimited, false)
  assert.deepEqual(calls.map(call => [call.cursor, call.pageSize, call.includeSummary, call.refresh]), [[null, 20, true, true], ['a', 20, false, false], ['b', 19, false, false]])
})

test('caps each foreground scan at three calls and preserves a cursor for explicit continuation', async () => {
  let calls = 0
  const result = await readReceivablesWindow(query, async () => page([], String(++calls)), () => true)
  assert.equal(calls, 3)
  assert.equal(result?.scanLimited, true)
  assert.equal(result?.nextCursor, '3')
  const next = await readReceivablesWindow({ ...query, cursor: result?.nextCursor, includeSummary: false }, async input => {
    assert.equal(input.cursor, '3'); return page(['late-match'], null)
  }, () => true)
  assert.deepEqual(next?.contracts.map(row => row.id), ['late-match'])
})

test('stale authority or scope completion cannot start another scan', async () => {
  let current = true, calls = 0
  const result = await readReceivablesWindow(query, async () => { calls++; current = false; return page([], 'next') }, () => current)
  assert.equal(result, null)
  assert.equal(calls, 1)
})

test('duplicate rows merge while repeated or missing continuation cursors stop the chain', async () => {
  const responses = [page(['one'], 'a'), page(['one', 'two'], null)]
  const result = await readReceivablesWindow(query, async () => responses.shift()!, () => true)
  assert.deepEqual(result?.contracts.map(row => row.id), ['one', 'two'])
  for (const nextCursor of ['a', null]) {
    let calls = 0
    await assert.rejects(readReceivablesWindow({ ...query, cursor: 'a' }, async () => { calls++; return { ...page([], nextCursor), hasMore: true } }, () => true), /Hãy làm mới/)
    assert.equal(calls, 1)
  }
})
