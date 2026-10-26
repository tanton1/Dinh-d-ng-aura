'use strict'

// All pages and source collections belong to the same snapshot. A date change
// behind a cursor therefore cannot omit a source or count it twice. Even an
// empty first query must anchor the read time for later collections.
async function visitAggregateSourcePages({ db, sources, visit, pageSize, assertBudget = () => {} }) {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new Error('OPERATIONS_AGGREGATE_INVALID_PAGE_SIZE')
  let readTime = null
  const sourceCounts = {}, sourcePages = {}
  for (const [source, input] of Object.entries(sources)) {
    const query = input.limit(pageSize)
    let cursor = null
    sourceCounts[source] = 0
    sourcePages[source] = 0
    while (true) {
      assertBudget()
      const current = cursor ? query.startAfter(cursor) : query
      const snapshot = readTime
        ? await db.runTransaction(transaction => transaction.get(current), { readOnly: true, readTime })
        : await current.get()
      if (!readTime) readTime = snapshot.readTime
      if (!readTime || !Number.isInteger(readTime.seconds) || !Number.isInteger(readTime.nanoseconds)) throw new Error('OPERATIONS_AGGREGATE_SNAPSHOT_UNAVAILABLE')
      if (snapshot.size !== snapshot.docs.length || snapshot.size > pageSize
        || (cursor && snapshot.docs.some(doc => doc.ref.path === cursor.ref.path))) throw new Error('OPERATIONS_AGGREGATE_INVALID_SOURCE_PAGE')
      assertBudget()
      sourceCounts[source] += snapshot.size
      sourcePages[source]++
      await visit(source, snapshot.docs)
      if (snapshot.size < pageSize) break
      cursor = snapshot.docs.at(-1)
    }
  }
  return { sourceCounts, sourcePages, readTime }
}

module.exports = { visitAggregateSourcePages }
