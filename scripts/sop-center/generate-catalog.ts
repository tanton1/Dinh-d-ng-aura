import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

type SourceRecord = Record<string, unknown>

type KnowledgeKind =
  | 'sop'
  | 'skill'
  | 'script'
  | 'dialogue'
  | 'objection'
  | 'policy'
  | 'variable'
  | 'kpi'
  | 'escalation'

const SOURCE_TIMESTAMP = '2026-11-06T00:00:00.000Z'
const EXCLUDED_SOP_IDS = new Set(['sop03', 'sop05'])
const EXCLUDED_SKILL_IDS = new Set([20, 22, 23, 24])
const EXCLUDED_SCRIPT_CATEGORIES = new Set(['renewal', 'longterm'])

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function searchable(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(searchable).join(' ')
  if (value && typeof value === 'object') return Object.values(value).map(searchable).join(' ')
  return ''
}

function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function resourceId(kind: KnowledgeKind, id: unknown) {
  return `${kind}__${String(id).trim().replace(/[^a-zA-Z0-9_-]+/g, '-')}`
}

function asStatus(value: unknown) {
  return ['draft', 'review', 'approved', 'live'].includes(String(value))
    ? String(value)
    : 'live'
}

function makeResource(
  kind: KnowledgeKind,
  source: SourceRecord,
  options: {
    sourceId: string | number
    code?: string
    title: string
    summary?: string
    ownerRole?: string
    audiences?: string[]
    tags?: string[]
    status?: string
    version?: string
  },
) {
  const title = cleanText(options.title)
  const summary = cleanText(options.summary)
  const tags = [...new Set((options.tags ?? []).map(cleanText).filter(Boolean))]
  const searchText = normalizeSearch([
    options.code,
    title,
    summary,
    options.ownerRole,
    ...tags,
    searchable(source),
  ].filter(Boolean).join(' ')).slice(0, 45_000)
  const id = resourceId(kind, options.sourceId)
  const version = cleanText(options.version) || '1.0'
  return {
    id,
    schemaVersion: 1,
    kind,
    sourceId: String(options.sourceId),
    code: cleanText(options.code) || id,
    title,
    summary,
    status: asStatus(options.status),
    version,
    revision: 1,
    publishedVersionId: `migration-${version.replace(/[^a-zA-Z0-9_-]+/g, '-')}`,
    ownerRole: cleanText(options.ownerRole) || 'admin',
    audiences: [...new Set((options.audiences ?? []).map(cleanText).filter(Boolean))],
    branchScope: ['all'],
    tags,
    searchText,
    sortKey: `${kind}:${normalizeSearch(title)}`,
    sourceSystem: 'sop-aura-reference',
    sourceReviewRequired: ['policy', 'variable', 'kpi', 'escalation'].includes(kind),
    updatedAt: SOURCE_TIMESTAMP,
    updatedBy: 'migration:sop-aura-v1',
    payload: source,
  }
}

async function sourceModule(sourceRoot: string, relativePath: string) {
  const url = pathToFileURL(resolve(sourceRoot, relativePath)).href
  return import(url)
}

async function buildCatalog(sourceRoot: string) {
  const [sopsModule, skillsModule, scriptsModule, dialoguesModule, objectionsModule, policyModule] = await Promise.all([
    sourceModule(sourceRoot, 'src/data/sops.ts'),
    sourceModule(sourceRoot, 'src/data/skills.ts'),
    sourceModule(sourceRoot, 'src/data/scripts.ts'),
    sourceModule(sourceRoot, 'src/data/dialogues.ts'),
    sourceModule(sourceRoot, 'src/data/objections.ts'),
    sourceModule(sourceRoot, 'src/data/policy.ts'),
  ])

  const sops = (sopsModule.seedSops(SOURCE_TIMESTAMP) as SourceRecord[])
    .filter((item) => !EXCLUDED_SOP_IDS.has(String(item.id)))
  const skills = (skillsModule.seedSkills(SOURCE_TIMESTAMP) as SourceRecord[])
    .filter((item) => !EXCLUDED_SKILL_IDS.has(Number(item.id)))
  const scripts = (scriptsModule.SEED_SCRIPTS as SourceRecord[])
    .filter((item) => !EXCLUDED_SCRIPT_CATEGORIES.has(String(item.category)))
    .filter((item) => !EXCLUDED_SKILL_IDS.has(Number(item.skillId)))
  const dialogues = (dialoguesModule.DIALOGUES as SourceRecord[])
    .filter((item) => !EXCLUDED_SOP_IDS.has(String(item.sopId)))
    .filter((item) => !EXCLUDED_SKILL_IDS.has(Number(item.skillId)))
  const objections = objectionsModule.OBJECTIONS as SourceRecord[]

  const resources = [
    ...sops.map((item) => makeResource('sop', item, {
      sourceId: String(item.id), code: String(item.code), title: String(item.title),
      summary: String(item.goal ?? ''), ownerRole: String(item.ownerRole ?? 'admin'),
      audiences: Array.isArray(item.audience) ? item.audience.map(String) : [],
      tags: [String(item.stage ?? ''), 'quy trình'], status: String(item.status), version: String(item.version),
    })),
    ...skills.map((item) => makeResource('skill', item, {
      sourceId: Number(item.id), code: String(item.code), title: String(item.nameVi),
      summary: String(item.summary ?? ''), ownerRole: String(item.ownerRole ?? 'admin'),
      audiences: [String(item.ownerRole ?? 'admin')], tags: [`nhóm ${String(item.group ?? '')}`, `bộ ${String(item.bundle ?? '')}`],
      status: String(item.status), version: String(item.version),
    })),
    ...scripts.map((item) => makeResource('script', item, {
      sourceId: String(item.id), title: String(item.title), summary: String(item.trigger ?? ''),
      ownerRole: 'sales', audiences: ['sales'], tags: [String(item.category ?? ''), 'mẫu câu'],
    })),
    ...dialogues.map((item) => makeResource('dialogue', item, {
      sourceId: String(item.id), title: String(item.title), summary: String(item.situation ?? ''),
      ownerRole: 'sales', audiences: ['sales'], tags: [String(item.level ?? ''), 'hội thoại mẫu'],
    })),
    ...objections.map((item) => makeResource('objection', item, {
      sourceId: String(item.id), title: `Xử lý: “${String(item.say)}”`,
      summary: Array.isArray(item.meaning) ? item.meaning.map(String).join(' · ') : '',
      ownerRole: 'sales', audiences: ['sales'], tags: ['xử lý băn khoăn'],
    })),
    ...(policyModule.SEED_POLICIES as SourceRecord[]).map((item) => makeResource('policy', item, {
      sourceId: String(item.id), title: String(item.title), summary: String(item.rule ?? ''),
      ownerRole: 'admin', audiences: [String(item.appliesTo ?? '')], tags: [String(item.group ?? ''), 'tham chiếu cần duyệt'],
      status: 'review',
    })),
    ...(policyModule.SEED_VARS as SourceRecord[]).map((item) => makeResource('variable', item, {
      sourceId: String(item.key), title: `Biến chính sách: ${String(item.key)}`,
      summary: String(item.note ?? ''), ownerRole: 'admin', tags: ['biến chính sách', 'tham chiếu cần duyệt'], status: 'review',
    })),
    ...(policyModule.SEED_KPIS as SourceRecord[]).map((item, index) => makeResource('kpi', item, {
      sourceId: `${index + 1}-${String(item.name)}`, title: String(item.name), summary: String(item.formula ?? ''),
      ownerRole: 'admin', audiences: [String(item.owner ?? '')], tags: ['kpi', 'tham chiếu cần duyệt'], status: 'review',
    })),
    ...(policyModule.SEED_ESCALATIONS as SourceRecord[]).map((item) => makeResource('escalation', item, {
      sourceId: String(item.id), title: String(item.situation), summary: String(item.trigger ?? ''),
      ownerRole: 'admin', audiences: [String(item.handler ?? '')], tags: ['escalation', 'tham chiếu cần duyệt'], status: 'review',
    })),
  ].sort((left, right) => left.sortKey.localeCompare(right.sortKey, 'vi'))

  const byKind = resources.reduce<Record<string, number>>((result, item) => {
    result[item.kind] = (result[item.kind] ?? 0) + 1
    return result
  }, {})

  return {
    schemaVersion: 1,
    generatedAt: SOURCE_TIMESTAMP,
    source: {
      name: 'SOP aura',
      purpose: 'Bản nhập tri thức có kiểm soát; không phải dữ liệu vận hành chuẩn.',
      migrationBatchId: 'sop-aura-v1',
    },
    excludedScopes: ['lead_pipeline', 'member_360', 'renewal', 'prices', 'promotions', 'operational_records'],
    stats: { total: resources.length, byKind },
    resources,
  }
}

async function main() {
  const sourceRoot = process.argv[2] || 'D:/APP Dự Án/SOP aura'
  const outputPath = resolve(process.argv[3] || 'src/features/sop-center/data/catalog.json')
  const catalog = await buildCatalog(sourceRoot)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
  process.stdout.write(`Generated ${catalog.stats.total} SOP Center resources at ${outputPath}\n`)
  process.stdout.write(`${JSON.stringify(catalog.stats.byKind)}\n`)
}

void main()
