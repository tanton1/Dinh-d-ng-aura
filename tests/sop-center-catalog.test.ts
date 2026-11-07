import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

type Resource = {
  kind: string
  sourceId: string
  title: string
  relatedSopIds: string[]
  relatedSkillIds: string[]
  contentMetrics: { phraseCount: number; situationCount: number; variantCount: number }
  payload: Record<string, unknown>
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

test('only the voice guide and escalations apply to every SOP; nothing else is blanket-linked', async () => {
  const value = await catalog()
  const content = value.resources.filter((item) => item.kind !== 'sop' && item.kind !== 'skill')
  const shared = content.filter((item) => !item.relatedSopIds.length)
  assert.deepEqual([...new Set(shared.map((item) => item.kind))].sort(), ['escalation', 'voice'])
  assert.equal(content.some((item) => item.relatedSopIds.length >= 9), false)
})

test('each KPI belongs to exactly the SOPs that list it', async () => {
  const value = await catalog()
  const sops = value.resources.filter((item) => item.kind === 'sop')
  for (const kpi of value.resources.filter((item) => item.kind === 'kpi')) {
    const owners = sops.filter((sop) => (sop.payload.kpis as string[]).includes(kpi.title)).map((sop) => sop.sourceId).sort()
    assert.ok(owners.length > 0, kpi.title)
    assert.deepEqual([...kpi.relatedSopIds].sort(), owners, kpi.title)
  }
})

test('a policy variable only reaches SOPs that write it as [key]', async () => {
  const value = await catalog()
  const writers = value.resources.filter((item) => ['sop', 'script', 'dialogue', 'objection', 'policy'].includes(item.kind))
  for (const variable of value.resources.filter((item) => item.kind === 'variable')) {
    for (const sopId of variable.relatedSopIds) {
      const used = writers.some((item) => item.relatedSopIds.includes(sopId) && JSON.stringify(item.payload).includes(`[${variable.sourceId}]`))
      assert.ok(used, `[${variable.sourceId}] in ${sopId}`)
    }
  }
})

test('scripts follow their stage, not every SOP that shares their skill', async () => {
  const value = await catalog()
  const script = (title: string) => value.resources.find((item) => item.kind === 'script' && item.title === title)
  assert.deepEqual(script('Hội viên rút đồng ý hình ảnh')?.relatedSopIds, ['sop08'])
  assert.deepEqual(script('Hệ thống check-in lỗi')?.relatedSopIds, ['sop09'])
  assert.deepEqual(script('Khách hỏi bảo lưu gói')?.relatedSopIds, ['sop07'])
  const safety = value.resources.filter((item) => item.kind === 'script' && item.payload.category === 'safety')
  assert.ok(safety.length > 0)
  assert.ok(safety.every((item) => !item.relatedSopIds.includes('sop01')))
})

test('every step names a real primary skill, real supporting skills and hand-offs to other SOPs', async () => {
  const value = await catalog()
  const skillIds = new Set(value.resources.filter((item) => item.kind === 'skill').map((item) => item.sourceId))
  const sops = value.resources.filter((item) => item.kind === 'sop')
  const sopIds = new Set(sops.map((item) => item.sourceId))
  for (const sop of sops) {
    const steps = sop.payload.playbook as Array<{ title: string; skillId?: number; supportSkillIds?: number[]; handoffs?: Array<{ sopId: string; when: string }> }>
    assert.ok(steps.length > 0, sop.sourceId)
    for (const step of steps) {
      assert.ok(skillIds.has(String(step.skillId)), `${sop.sourceId} ${step.title}: primary skill`)
      for (const id of step.supportSkillIds ?? []) {
        assert.ok(skillIds.has(String(id)), `${sop.sourceId} ${step.title}: support skill ${id}`)
        assert.notEqual(String(id), String(step.skillId), `${sop.sourceId} ${step.title}: support repeats the primary skill`)
      }
      for (const handoff of step.handoffs ?? []) {
        assert.ok(sopIds.has(handoff.sopId) && handoff.sopId !== sop.sourceId, `${sop.sourceId} ${step.title}: hand-off to ${handoff.sopId}`)
        assert.ok(handoff.when.length > 0)
      }
    }
    // The SOP's skills are exactly the ones its steps apply or work with.
    const wired = new Set(steps.flatMap((step) => [String(step.skillId), ...(step.supportSkillIds ?? []).map(String)]))
    assert.deepEqual([...sop.relatedSkillIds].sort(), [...wired].sort(), `${sop.sourceId}: skills vs steps`)
  }
})
