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
  | 'price'
  | 'promotion'
  | 'voice'

type ContentMetrics = {
  phraseCount: number
  situationCount: number
  variantCount: number
}

const SOURCE_TIMESTAMP = '2026-11-06T00:00:00.000Z'
const MIGRATION_BATCH_ID = 'sop-aura-v2'

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function sourceArray(value: unknown): SourceRecord[] {
  return Array.isArray(value) ? value.filter((item): item is SourceRecord => Boolean(item) && typeof item === 'object') : []
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

function searchable(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (value instanceof RegExp) return `${value.source} ${value.flags}`
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
  return ['draft', 'review', 'approved', 'live'].includes(String(value)) ? String(value) : 'live'
}

function uniqueStrings(values: unknown[]) {
  return [...new Set(values.map(String).map((item) => item.trim()).filter(Boolean))]
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
    relatedSopIds?: string[]
    relatedSkillIds?: Array<string | number>
    metrics?: Partial<ContentMetrics>
  },
) {
  const title = cleanText(options.title)
  const summary = cleanText(options.summary)
  const tags = [...new Set((options.tags ?? []).map(cleanText).filter(Boolean))]
  const relatedSopIds = uniqueStrings(options.relatedSopIds ?? [])
  const relatedSkillIds = uniqueStrings(options.relatedSkillIds ?? [])
  const contentMetrics: ContentMetrics = {
    phraseCount: Math.max(0, Number(options.metrics?.phraseCount ?? 0)),
    situationCount: Math.max(0, Number(options.metrics?.situationCount ?? 0)),
    variantCount: Math.max(0, Number(options.metrics?.variantCount ?? 0)),
  }
  const searchText = normalizeSearch([
    options.code,
    title,
    summary,
    options.ownerRole,
    ...tags,
    ...relatedSopIds,
    ...relatedSkillIds.map((item) => `skill ${item} ky nang ${item}`),
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
    relatedSopIds,
    relatedSkillIds,
    contentMetrics,
    searchText,
    sortKey: `${kind}:${normalizeSearch(title)}`,
    sourceSystem: 'sop-aura-reference',
    sourceReviewRequired: ['policy', 'variable', 'kpi', 'escalation', 'price', 'promotion'].includes(kind),
    updatedAt: SOURCE_TIMESTAMP,
    updatedBy: `migration:${MIGRATION_BATCH_ID}`,
    payload: source,
  }
}

async function sourceModule(sourceRoot: string, relativePath: string) {
  const url = pathToFileURL(resolve(sourceRoot, relativePath)).href
  return import(url)
}

function sopMetrics(item: SourceRecord): ContentMetrics {
  const steps = sourceArray(item.playbook)
  return {
    phraseCount: steps.reduce((total, step) => total + stringArray(step.say).length
      + sourceArray(step.cases).reduce((caseTotal, currentCase) => caseTotal + stringArray(currentCase.say).length, 0), 0),
    situationCount: steps.reduce((total, step) => total + sourceArray(step.cases).length, 0),
    variantCount: steps.reduce((total, step) => total + sourceArray(step.quiz).length, 0),
  }
}

function resolvedSopSkillIds(item: SourceRecord) {
  const stepSkillIds = sourceArray(item.playbook).map((step) => step.skillId).filter(Boolean)
  return uniqueStrings([...stringArray(item.skillIds), ...stepSkillIds])
}

function policySops(group: unknown) {
  const mapping: Record<string, string[]> = {
    service: ['sop01', 'sop02', 'sop05', 'sop09'],
    payment: ['sop01', 'sop02', 'sop05'],
    schedule: ['sop03', 'sop07', 'sop09'],
    freeze: ['sop07'],
    transfer: ['sop07'],
    refund: ['sop07'],
    complaint: ['sop07', 'sop09'],
    health: ['sop03', 'sop06'],
    privacy: ['sop08'],
    conduct: ['sop08', 'sop09'],
  }
  return mapping[String(group)] ?? []
}

async function buildCatalog(sourceRoot: string) {
  const [sopsModule, skillsModule, scriptsModule, dialoguesModule, objectionsModule, policyModule, voiceModule, channelsModule] = await Promise.all([
    sourceModule(sourceRoot, 'src/data/sops.ts'),
    sourceModule(sourceRoot, 'src/data/skills.ts'),
    sourceModule(sourceRoot, 'src/data/scripts.ts'),
    sourceModule(sourceRoot, 'src/data/dialogues.ts'),
    sourceModule(sourceRoot, 'src/data/objections.ts'),
    sourceModule(sourceRoot, 'src/data/policy.ts'),
    sourceModule(sourceRoot, 'src/data/voice.ts'),
    sourceModule(sourceRoot, 'src/data/channels.ts'),
  ])

  // Import the complete knowledge catalog. Operational lead/member/renewal records are never read here.
  const sops = sopsModule.seedSops(SOURCE_TIMESTAMP) as SourceRecord[]
  const skills = skillsModule.seedSkills(SOURCE_TIMESTAMP) as SourceRecord[]
  const scripts = scriptsModule.SEED_SCRIPTS as SourceRecord[]
  const dialogues = dialoguesModule.DIALOGUES as SourceRecord[]
  const objections = objectionsModule.OBJECTIONS as SourceRecord[]
  const allSopIds = sops.map((item) => String(item.id))
  const sopSkillIds = new Map(sops.map((sop) => [String(sop.id), resolvedSopSkillIds(sop)]))
  const skillToSops = new Map<string, string[]>()
  sops.forEach((sop) => {
    ;(sopSkillIds.get(String(sop.id)) ?? []).forEach((skillId) => {
      skillToSops.set(skillId, [...(skillToSops.get(skillId) ?? []), String(sop.id)])
    })
  })
  const sopsForSkill = (skillId: unknown) => skillToSops.get(String(skillId)) ?? []
  const scriptVariants = channelsModule.SCRIPT_VARIANTS as Record<string, SourceRecord[]>

  const voiceResources = [
    makeResource('voice', {
      type: 'banned-rules',
      groups: voiceModule.BANNED_GROUP,
      rules: (voiceModule.BANNED_RULES as Array<SourceRecord & { pattern?: RegExp }>).map((rule) => ({
        ...rule,
        pattern: rule.pattern instanceof RegExp ? rule.pattern.source : String(rule.pattern ?? ''),
        flags: rule.pattern instanceof RegExp ? rule.pattern.flags : '',
      })),
    }, {
      sourceId: 'banned-rules', code: 'VOICE-01', title: 'Cụm từ không được dùng',
      summary: 'Các cách nói gây áp lực, hứa hẹn quá mức hoặc thiếu an toàn.', ownerRole: 'admin',
      audiences: ['sales', 'pt', 'cs'], tags: ['giọng Aura', 'không nên nói'], relatedSopIds: allSopIds,
      metrics: { phraseCount: voiceModule.BANNED_RULES.length },
    }),
    makeResource('voice', { type: 'substitutions', items: voiceModule.SUBSTITUTIONS }, {
      sourceId: 'substitutions', code: 'VOICE-02', title: 'Cách nói thay thế theo giọng Aura',
      summary: 'Đổi câu cứng hoặc gây áp lực thành cách nói rõ ràng, tôn trọng.', ownerRole: 'admin',
      audiences: ['sales', 'pt', 'cs'], tags: ['giọng Aura', 'câu thay thế'], relatedSopIds: allSopIds,
      metrics: { phraseCount: voiceModule.SUBSTITUTIONS.length * 2, variantCount: voiceModule.SUBSTITUTIONS.length },
    }),
    makeResource('voice', { type: 'addressing', items: voiceModule.ADDRESSING }, {
      sourceId: 'addressing', code: 'VOICE-03', title: 'Xưng hô với khách hàng',
      summary: 'Quy tắc gọi khách và tự xưng theo từng đối tượng.', ownerRole: 'admin',
      audiences: ['sales', 'pt', 'cs'], tags: ['giọng Aura', 'xưng hô'], relatedSopIds: allSopIds,
      metrics: { phraseCount: voiceModule.ADDRESSING.length },
    }),
    makeResource('voice', { type: 'message-rules', items: voiceModule.MESSAGE_RULES }, {
      sourceId: 'message-rules', code: 'VOICE-04', title: 'Quy tắc viết tin nhắn',
      summary: 'Cấu trúc và tiêu chuẩn cho tin nhắn gửi khách.', ownerRole: 'admin',
      audiences: ['sales', 'pt', 'cs'], tags: ['giọng Aura', 'tin nhắn'], relatedSopIds: allSopIds,
      metrics: { phraseCount: voiceModule.MESSAGE_RULES.length },
    }),
    makeResource('voice', { type: 'channels', items: channelsModule.CHANNELS }, {
      sourceId: 'channels', code: 'VOICE-05', title: 'Cách giao tiếp theo kênh',
      summary: 'Nguyên tắc dùng Fanpage, Zalo, điện thoại và tại quầy.', ownerRole: 'admin',
      audiences: ['sales', 'pt', 'cs'], tags: ['kênh giao tiếp'], relatedSopIds: allSopIds,
      metrics: { situationCount: channelsModule.CHANNELS.length },
    }),
    makeResource('voice', { type: 'audiences', items: channelsModule.AUDIENCES }, {
      sourceId: 'audiences', code: 'VOICE-06', title: 'Cách nói theo nhóm khách',
      summary: 'Mối quan tâm, cách tiếp cận và từ ngữ phù hợp theo nhóm khách.', ownerRole: 'admin',
      audiences: ['sales', 'pt', 'cs'], tags: ['nhóm khách', 'giọng Aura'], relatedSopIds: allSopIds,
      metrics: { situationCount: channelsModule.AUDIENCES.length },
    }),
  ]

  const resources = [
    ...sops.map((item) => makeResource('sop', {
      ...item,
      declaredSkillIds: stringArray(item.skillIds),
      skillIds: sopSkillIds.get(String(item.id)) ?? [],
    }, {
      sourceId: String(item.id), code: String(item.code), title: String(item.title), summary: String(item.goal ?? ''),
      ownerRole: String(item.ownerRole ?? 'admin'), audiences: stringArray(item.audience), relatedSopIds: [String(item.id)],
      relatedSkillIds: sopSkillIds.get(String(item.id)) ?? [], tags: [String(item.stage ?? ''), 'quy trình'], status: String(item.status),
      version: String(item.version), metrics: sopMetrics(item),
    })),
    ...skills.map((item) => makeResource('skill', item, {
      sourceId: Number(item.id), code: String(item.code), title: String(item.nameVi), summary: String(item.summary ?? ''),
      ownerRole: String(item.ownerRole ?? 'admin'), audiences: [String(item.ownerRole ?? 'admin')],
      relatedSopIds: sopsForSkill(item.id), relatedSkillIds: [String(item.id)],
      tags: [`nhóm ${String(item.group ?? '')}`, `bộ ${String(item.bundle ?? '')}`], status: String(item.status), version: String(item.version),
    })),
    ...scripts.map((item) => {
      const variants = scriptVariants[String(item.id)] ?? []
      return makeResource('script', { ...item, variants }, {
        sourceId: String(item.id), title: String(item.title), summary: String(item.trigger ?? ''), ownerRole: 'sales',
        audiences: ['sales'], tags: [String(item.category ?? ''), 'mẫu câu'], relatedSopIds: sopsForSkill(item.skillId),
        relatedSkillIds: item.skillId ? [String(item.skillId)] : [], metrics: { phraseCount: 1 + variants.length, variantCount: variants.length },
      })
    }),
    ...dialogues.map((item) => makeResource('dialogue', item, {
      sourceId: String(item.id), title: String(item.title), summary: String(item.situation ?? ''), ownerRole: 'sales',
      audiences: ['sales'], tags: [String(item.level ?? ''), 'hội thoại mẫu'], relatedSopIds: [String(item.sopId)],
      relatedSkillIds: item.skillId ? [String(item.skillId)] : [], metrics: {
        phraseCount: sourceArray(item.turns).filter((turn) => String(turn.who) === 'staff').length + sourceArray(item.branches).length,
        situationCount: 1, variantCount: sourceArray(item.branches).length,
      },
    })),
    ...objections.map((item) => makeResource('objection', item, {
      sourceId: String(item.id), title: `Xử lý: “${String(item.say)}”`, summary: stringArray(item.meaning).join(' · '),
      ownerRole: 'sales', audiences: ['sales'], tags: ['xử lý băn khoăn'], relatedSopIds: sopsForSkill(item.skillId),
      relatedSkillIds: item.skillId ? [String(item.skillId)] : [],
      metrics: { phraseCount: sourceArray(item.responses).length, situationCount: 1, variantCount: stringArray(item.variants).length },
    })),
    ...(policyModule.SEED_POLICIES as SourceRecord[]).map((item) => makeResource('policy', item, {
      sourceId: String(item.id), title: String(item.title), summary: String(item.rule ?? ''), ownerRole: 'admin',
      audiences: [String(item.appliesTo ?? '')], tags: [String(item.group ?? ''), 'tham chiếu cần duyệt'],
      status: 'review', relatedSopIds: policySops(item.group),
    })),
    ...(policyModule.SEED_VARS as SourceRecord[]).map((item) => makeResource('variable', item, {
      sourceId: String(item.key), title: `Biến chính sách: ${String(item.key)}`, summary: String(item.note ?? ''),
      ownerRole: 'admin', tags: ['biến chính sách', 'tham chiếu cần duyệt'], status: 'review', relatedSopIds: allSopIds,
    })),
    ...(policyModule.SEED_KPIS as SourceRecord[]).map((item, index) => makeResource('kpi', item, {
      sourceId: `${index + 1}-${String(item.name)}`, title: String(item.name), summary: String(item.formula ?? ''),
      ownerRole: 'admin', audiences: [String(item.owner ?? '')], tags: ['kpi', 'tham chiếu cần duyệt'],
      status: 'review', relatedSopIds: allSopIds,
    })),
    ...(policyModule.SEED_ESCALATIONS as SourceRecord[]).map((item) => makeResource('escalation', item, {
      sourceId: String(item.id), title: String(item.situation), summary: String(item.trigger ?? ''), ownerRole: 'admin',
      audiences: [String(item.handler ?? '')], tags: ['escalation', 'tham chiếu cần duyệt'], status: 'review',
      relatedSopIds: allSopIds, metrics: { situationCount: 1 },
    })),
    ...(policyModule.SEED_PRICES as SourceRecord[]).map((item) => makeResource('price', item, {
      sourceId: String(item.id), code: `PRICE-${String(item.id)}`, title: String(item.label),
      summary: `${Number(item.months || 0)} tháng · ${Number(item.monthly || 0).toLocaleString('vi-VN')}đ/tháng`,
      ownerRole: 'admin', audiences: ['sales', 'cs'], tags: [String(item.service ?? ''), 'bảng giá', 'tham chiếu cần duyệt'],
      status: 'review', relatedSopIds: ['sop01', 'sop02', 'sop05'],
    })),
    ...(policyModule.SEED_PROMOS as SourceRecord[]).map((item) => makeResource('promotion', item, {
      sourceId: String(item.id), code: `PROMO-${String(item.id)}`, title: String(item.name), summary: String(item.condition ?? ''),
      ownerRole: 'admin', audiences: ['sales', 'cs'], tags: ['ưu đãi', 'tham chiếu cần duyệt'], status: 'review',
      relatedSopIds: ['sop01', 'sop02', 'sop05'],
    })),
    ...voiceResources,
  ].sort((left, right) => left.sortKey.localeCompare(right.sortKey, 'vi'))

  const byKind = resources.reduce<Record<string, number>>((result, item) => {
    result[item.kind] = (result[item.kind] ?? 0) + 1
    return result
  }, {})
  const contentMetrics = resources.reduce<ContentMetrics>((total, item) => ({
    phraseCount: total.phraseCount + item.contentMetrics.phraseCount,
    situationCount: total.situationCount + item.contentMetrics.situationCount,
    variantCount: total.variantCount + item.contentMetrics.variantCount,
  }), { phraseCount: 0, situationCount: 0, variantCount: 0 })

  return {
    schemaVersion: 1,
    generatedAt: SOURCE_TIMESTAMP,
    source: {
      name: 'SOP aura',
      purpose: 'Bản nhập tri thức có kiểm soát; không phải dữ liệu vận hành chuẩn.',
      migrationBatchId: MIGRATION_BATCH_ID,
    },
    excludedScopes: ['lead_pipeline', 'member_360', 'renewal_operations', 'operational_records'],
    stats: { total: resources.length, byKind, contentMetrics },
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
  process.stdout.write(`${JSON.stringify({ ...catalog.stats.byKind, contentMetrics: catalog.stats.contentMetrics })}\n`)
}

void main()
