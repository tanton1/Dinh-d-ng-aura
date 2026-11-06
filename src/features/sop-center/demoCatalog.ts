import catalogUrl from './data/catalog.json?url'
import type { SopCatalogEnvelope, SopKnowledgeResource, SopKnowledgeVersion } from './types'

const DEMO_OVERRIDES_KEY = 'aura:sop-center:demo-overrides:v1'

type DemoOverrides = {
  migrationBatchId: string
  resources: Record<string, SopKnowledgeResource>
  versions: Record<string, SopKnowledgeVersion[]>
}

function emptyOverrides(batchId: string): DemoOverrides {
  return { migrationBatchId: batchId, resources: {}, versions: {} }
}

function readOverrides(batchId: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(DEMO_OVERRIDES_KEY) || 'null') as DemoOverrides | null
    if (parsed?.migrationBatchId === batchId && parsed.resources && parsed.versions) return parsed
  } catch {
    // A corrupt local demo snapshot must never block the canonical catalog.
  }
  return emptyOverrides(batchId)
}

export async function loadDemoSopCatalog() {
  const response = await fetch(catalogUrl)
  if (!response.ok) throw new Error('Không thể tải bộ dữ liệu SOP mẫu.')
  const catalog = await response.json() as SopCatalogEnvelope
  const overrides = readOverrides(catalog.source.migrationBatchId)
  return {
    catalog,
    resources: catalog.resources.map((item) => overrides.resources[item.id] ?? item),
    versions: overrides.versions,
  }
}

export function saveDemoSopResource(
  migrationBatchId: string,
  resource: SopKnowledgeResource,
  version: SopKnowledgeVersion,
) {
  const current = readOverrides(migrationBatchId)
  current.resources[resource.id] = resource
  current.versions[resource.id] = [version, ...(current.versions[resource.id] ?? [])].slice(0, 30)
  localStorage.setItem(DEMO_OVERRIDES_KEY, JSON.stringify(current))
  return current.versions[resource.id]
}

