'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { curate: curateFreeExerciseDb } = require('./import-free-exercise-catalog.cjs')
const { curate: curateExerciseDbWomen } = require('./import-exercisedb-women-catalog.cjs')

const FREE_EXERCISE_DB_CACHE = path.resolve('.migration-private', 'free-exercise-db-source.json')
const EXERCISE_DB_CACHE = path.resolve('.migration-private', 'exercisedb-women-source-v1.json')
const REPORT = path.resolve('.migration-private', 'exercise-source-comparison-report.json')

// Keep this comparison deliberately conservative. A parenthetical variation
// such as "on knees" or "with rope" can change the movement, so it is not
// discarded. Only gender qualifiers and harmless singular/plural differences
// are normalized before a GIF is considered safe to attach automatically.
const aliases = Object.freeze({ one: 'single' })

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex') }

function readRows(filename) {
  if (!fs.existsSync(filename)) throw new Error(`Thiếu source cache: ${filename}.`)
  const payload = JSON.parse(fs.readFileSync(filename, 'utf8'))
  const rows = Array.isArray(payload) ? payload : payload.rows
  if (!Array.isArray(rows) || !rows.length) throw new Error(`Source cache không hợp lệ: ${filename}.`)
  return rows
}

function nameTokens(value) {
  return [...new Set(String(value || '').toLowerCase()
    .replace(/\((?:female|male)\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((token) => aliases[token] || token)
    .filter(Boolean))]
}

function canonicalName(value) {
  return nameTokens(value).map((token) => token.endsWith('s') && token.length > 3 ? token.slice(0, -1) : token).sort().join(' ')
}

function sourceName(item) { return item.nameEn || item.name || item.source?.sourceExerciseId || '' }

function indexByName(rows) {
  const index = new Map()
  rows.forEach((row) => {
    const key = canonicalName(sourceName(row))
    if (!key) return
    const existing = index.get(key) || []
    existing.push(row)
    index.set(key, existing)
  })
  return index
}

function exactMatchIndex(items, sourceRows) {
  const index = indexByName(sourceRows)
  return items.map((item) => {
    const key = canonicalName(sourceName(item))
    const candidates = index.get(key) || []
    return { item, key, match: candidates[0] || null, candidateCount: candidates.length }
  })
}

function compareSources({ freeRows, exerciseRows }) {
  const freeCurated = curateFreeExerciseDb(freeRows)
  const exerciseCurated = curateExerciseDbWomen(exerciseRows)
  const freeToExercise = exactMatchIndex(freeCurated, exerciseRows)
  const exerciseToFree = exactMatchIndex(exerciseCurated, freeRows)
  const freeMatched = freeToExercise.filter((entry) => entry.match)
  const exerciseMatched = exerciseToFree.filter((entry) => entry.match)
  const report = {
    schemaVersion: 1,
    policy: 'Free Exercise DB là nguồn bài tập chính; ExerciseDB Free V1 chỉ là nguồn GIF/bổ sung khi không có bài tương đương.',
    sources: {
      freeExerciseDb: { total: freeRows.length, curated: freeCurated.length },
      exerciseDbFreeV1: { total: exerciseRows.length, curatedWomen: exerciseCurated.length },
    },
    exactNameComparison: {
      freeCanonicalWithExerciseDbGif: freeMatched.length,
      freeCanonicalWithoutExerciseDbGif: freeCurated.length - freeMatched.length,
      freeCanonicalCoveragePercent: Number((freeMatched.length / Math.max(1, freeCurated.length) * 100).toFixed(1)),
      exerciseDbWomenWithFreeExerciseDbEquivalent: exerciseMatched.length,
      exerciseDbWomenFallbackCandidates: exerciseCurated.length - exerciseMatched.length,
      note: 'Khớp tên đã chuẩn hóa; không tự động coi biến thể gần giống là cùng một bài nếu chưa duyệt.',
    },
    matchedFreeCanonical: freeMatched.map(({ item, match, key }) => ({
      freeExerciseId: item.source?.sourceExerciseId || item.id,
      name: sourceName(item), exerciseDbExerciseId: match.exerciseId, exerciseDbName: sourceName(match), key,
    })),
    fallbackExerciseDbWomen: exerciseToFree.filter((entry) => !entry.match).map(({ item, key }) => ({
      exerciseDbExerciseId: item.externalMedia?.exerciseId || item.source?.sourceExerciseId || item.id,
      name: sourceName(item), key, reason: 'Không có tên tương đương trong Free Exercise DB; cần duyệt trước khi dùng bổ sung.',
    })),
    sourceDigests: { freeExerciseDb: sha256(JSON.stringify(freeRows)), exerciseDbFreeV1: sha256(JSON.stringify(exerciseRows)) },
  }
  report.planDigest = sha256(JSON.stringify(report))
  return report
}

function main() {
  const report = compareSources({ freeRows: readRows(FREE_EXERCISE_DB_CACHE), exerciseRows: readRows(EXERCISE_DB_CACHE) })
  fs.mkdirSync(path.dirname(REPORT), { recursive: true })
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return report
}

if (require.main === module) main()

module.exports = { canonicalName, compareSources, exactMatchIndex, nameTokens }
