import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebase'
import type { ExerciseCatalogItem } from '../types'

type CatalogFilters = {
  query?: string
  bodyPart?: string
  equipment?: string
  difficulty?: ExerciseCatalogItem['difficulty'] | ''
  includeReview?: boolean
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function strings(value: unknown, maximum = 30) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()).slice(0, maximum)
    : []
}

function parseCatalogItem(value: unknown): ExerciseCatalogItem | null {
  const data = record(value)
  const media = record(data?.media)
  const prescription = record(data?.defaultPrescription)
  const source = record(data?.source)
  if (!data || typeof data.id !== 'string' || typeof data.nameVi !== 'string') return null
  const status = ['draft', 'review', 'published', 'archived'].includes(String(data.status))
    ? data.status as ExerciseCatalogItem['status']
    : 'draft'
  const difficulty = ['beginner', 'intermediate', 'advanced'].includes(String(data.difficulty))
    ? data.difficulty as ExerciseCatalogItem['difficulty']
    : 'beginner'
  return {
    id: data.id,
    schemaVersion: 1,
    revision: typeof data.revision === 'number' ? Math.max(1, Math.round(data.revision)) : 1,
    status,
    nameVi: data.nameVi.trim(),
    nameEn: typeof data.nameEn === 'string' ? data.nameEn.trim() : undefined,
    aliasesVi: strings(data.aliasesVi),
    bodyParts: strings(data.bodyParts),
    targetMuscles: strings(data.targetMuscles),
    secondaryMuscles: strings(data.secondaryMuscles),
    equipment: strings(data.equipment),
    environment: strings(data.environment).filter((item): item is 'gym' | 'home' => item === 'gym' || item === 'home'),
    difficulty,
    goals: strings(data.goals),
    instructionsVi: strings(data.instructionsVi, 20),
    cuesVi: strings(data.cuesVi, 12),
    commonMistakesVi: strings(data.commonMistakesVi, 12),
    breathingVi: typeof data.breathingVi === 'string' ? data.breathingVi.trim() : undefined,
    media: {
      startImageUrl: typeof media?.startImageUrl === 'string' ? media.startImageUrl : undefined,
      endImageUrl: typeof media?.endImageUrl === 'string' ? media.endImageUrl : undefined,
      posterUrl: typeof media?.posterUrl === 'string' ? media.posterUrl : undefined,
      animationUrl: typeof media?.animationUrl === 'string' ? media.animationUrl : undefined,
      mimeType: typeof media?.mimeType === 'string' ? media.mimeType : undefined,
      checksum: typeof media?.checksum === 'string' ? media.checksum : undefined,
    },
    defaultPrescription: {
      sets: typeof prescription?.sets === 'number' ? prescription.sets : 3,
      reps: typeof prescription?.reps === 'string' ? prescription.reps : '10–12',
      restSeconds: typeof prescription?.restSeconds === 'number' ? prescription.restSeconds : 60,
      rpe: typeof prescription?.rpe === 'number' ? prescription.rpe : 7,
    },
    source: {
      provider: source?.provider === 'aura' ? 'aura' : 'free-exercise-db',
      sourceExerciseId: typeof source?.sourceExerciseId === 'string' ? source.sourceExerciseId : data.id,
      sourceVersion: typeof source?.sourceVersion === 'string' ? source.sourceVersion : 'unknown',
      license: source?.license === 'Aura-owned' ? 'Aura-owned' : 'Unlicense',
    },
    sourceAttribution: typeof data.sourceAttribution === 'string' ? data.sourceAttribution : 'Free Exercise DB · Unlicense',
  }
}

export async function listExerciseCatalog(filters: CatalogFilters = {}): Promise<ExerciseCatalogItem[]> {
  if (!firebaseFunctions) return []
  const callable = httpsCallable<CatalogFilters, unknown>(firebaseFunctions, 'listExerciseCatalog')
  const response = await callable(filters)
  const payload = record(response.data)
  return Array.isArray(payload?.items) ? payload.items.flatMap((item) => {
    const parsed = parseCatalogItem(item)
    return parsed ? [parsed] : []
  }) : []
}

export function exerciseCatalogSnapshot(item: ExerciseCatalogItem) {
  return {
    nameVi: item.nameVi,
    nameEn: item.nameEn,
    targetMuscles: [...item.targetMuscles],
    instructionsVi: [...item.instructionsVi],
    cuesVi: [...item.cuesVi],
    commonMistakesVi: [...item.commonMistakesVi],
    breathingVi: item.breathingVi,
    media: { ...item.media },
    sourceAttribution: item.sourceAttribution,
  }
}
