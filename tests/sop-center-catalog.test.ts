import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

type Resource = {
  kind: string
  sourceId: string
  relatedSopIds: string[]
  relatedSkillIds: string[]
  contentMetrics: { phraseCount: number; situationCount: number; variantCount: number }
}

async function catalog() {
  return JSON.parse(await readFile(new URL('../src/features/sop-center/data/catalog.json', import.meta.url), 'utf8')) as {
    excludedScopes: string[]
    stats: { total: number; byKind: Record<string, number>; contentMetrics: Resource['contentMetrics'] }
    resources: Resource[]
  }
}

test('SOP Center catalog carries the complete controlled knowledge inventory', async () => {
  const value = await catalog()
  assert.equal(value.stats.total, 274)
  assert.deepEqual(value.stats.byKind, {
    dialogue: 37,
    escalation: 11,
    kpi: 25,
    objection: 19,
    policy: 29,
    price: 10,
    promotion: 1,
    script: 90,
    skill: 24,
    sop: 9,
    variable: 13,
    voice: 6,
  })
  assert.ok(value.stats.contentMetrics.phraseCount >= 800)
  assert.ok(value.stats.contentMetrics.situationCount >= 350)
})

test('skills and customer-facing knowledge are traceable to SOPs', async () => {
  const value = await catalog()
  const sops = value.resources.filter((item) => item.kind === 'sop')
  const skills = value.resources.filter((item) => item.kind === 'skill')
  const customerKnowledge = value.resources.filter((item) => ['script', 'dialogue', 'objection'].includes(item.kind))
  assert.deepEqual([...new Set(sops.flatMap((item) => item.relatedSkillIds))].sort((a, b) => Number(a) - Number(b)), Array.from({ length: 24 }, (_, index) => String(index + 1)))
  assert.ok(skills.every((item) => item.relatedSopIds.length > 0))
  assert.ok(customerKnowledge.every((item) => item.relatedSopIds.length > 0))
  const resolvedBySop = Object.fromEntries(sops.map((item) => [item.sourceId, item.relatedSkillIds]))
  assert.ok(resolvedBySop.sop02.includes('10'))
  assert.ok(resolvedBySop.sop03.includes('21') && resolvedBySop.sop03.includes('23'))
  assert.ok(resolvedBySop.sop06.includes('20'))
  assert.ok(resolvedBySop.sop07.includes('22'))
  assert.ok(resolvedBySop.sop08.includes('20'))
  assert.ok(resolvedBySop.sop09.includes('11'))
})

test('catalog excludes operational modules but keeps prices and renewal knowledge', async () => {
  const value = await catalog()
  assert.deepEqual(value.excludedScopes, ['lead_pipeline', 'member_360', 'renewal_operations', 'operational_records'])
  assert.equal(value.resources.some((item) => item.kind === 'price'), true)
  assert.equal(value.resources.some((item) => item.kind === 'sop' && item.sourceId === 'sop05'), true)
})
