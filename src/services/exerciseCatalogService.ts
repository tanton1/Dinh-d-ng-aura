import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebaseFunctions'
import type {
  ExerciseCatalogExternalMedia,
  ExerciseCatalogItem,
  ExerciseCatalogMediaImage,
  ExerciseCatalogMediaVideo,
} from '../types'

type CatalogFilters = {
  query?: string
  bodyPart?: string
  equipment?: string
  difficulty?: ExerciseCatalogItem['difficulty'] | ''
  includeReview?: boolean
}

export type ExerciseCatalogDraft = Omit<ExerciseCatalogItem, 'id' | 'schemaVersion' | 'revision' | 'status' | 'hasWorkingDraft' | 'editRevision' | 'editStatus'> & {
  status: 'draft' | 'review'
}

export interface ExerciseCatalogDetail {
  item: ExerciseCatalogItem
  editItem: ExerciseCatalogItem
}

export interface ExternalExerciseCandidate {
  id: string
  provider: ExternalExerciseProvider
  title: string
  slug?: string
  description?: string
  instructions: string[]
  importantPoints: string[]
  muscleGroup?: string
  secondaryMuscles: string[]
  equipment: string[]
  category?: string
  difficulty?: string
  thumbnailUrl?: string
  videoCount: number
  mediaLabel?: string
  licenseNotice?: string
  videos: ExerciseCatalogMediaVideo[]
}

export type ExternalExerciseProvider = 'exercisedb' | 'ymove_free' | 'ymove'

export interface ExternalExerciseSearchResult {
  provider: ExternalExerciseProvider
  providerConfigured: boolean
  items: ExternalExerciseCandidate[]
  total: number
  page: number
  pageSize: number
}

export interface ExerciseCatalogResolvedMedia {
  provider?: ExternalExerciseProvider
  providerConfigured: boolean
  externalLinked: boolean
  transientMedia?: boolean
  expiresAt?: string
  images: ExerciseCatalogMediaImage[]
  videos: ExerciseCatalogMediaVideo[]
  animationUrl?: string
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function strings(value: unknown, maximum = 30) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()).slice(0, maximum)
    : []
}

function mediaImages(value: unknown): ExerciseCatalogMediaImage[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry, index) => {
    const image = record(entry)
    if (!image || typeof image.id !== 'string' || typeof image.url !== 'string' || !image.url.trim()) return []
    const role: ExerciseCatalogMediaImage['role'] = image.role === 'start' || image.role === 'end' || image.role === 'detail' ? image.role : 'detail'
    return [{
      id: image.id.slice(0, 160),
      url: image.url.slice(0, 2_000),
      storagePath: typeof image.storagePath === 'string' ? image.storagePath.slice(0, 500) : undefined,
      role,
      order: typeof image.order === 'number' ? image.order : index,
      alt: typeof image.alt === 'string' ? image.alt.slice(0, 240) : undefined,
      mimeType: typeof image.mimeType === 'string' ? image.mimeType.slice(0, 100) : undefined,
    }]
  }).slice(0, 12).sort((left, right) => left.order - right.order)
}

function mediaVideos(value: unknown): ExerciseCatalogMediaVideo[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry, index) => {
    const video = record(entry)
    if (!video) return []
    const provider: ExerciseCatalogMediaVideo['provider'] = video.provider === 'ymove' || video.provider === 'ymove_free' || video.provider === 'exercisedb' || video.provider === 'programme' ? video.provider : 'aura'
    const id = typeof video.id === 'string' && video.id ? video.id.slice(0, 160) : `video-${index + 1}`
    const tag: ExerciseCatalogMediaVideo['tag'] = video.tag === 'white-background' || video.tag === 'gym-shot' || video.tag === 'aura' || video.tag === 'animation' || video.tag === 'licensed-embed' ? video.tag : undefined
    const angle: ExerciseCatalogMediaVideo['angle'] = video.angle === 'front' || video.angle === 'side' || video.angle === 'other' ? video.angle : undefined
    const presenter: ExerciseCatalogMediaVideo['presenter'] = video.presenter === 'female' || video.presenter === 'male' || video.presenter === 'neutral' ? video.presenter : undefined
    const orientation: ExerciseCatalogMediaVideo['orientation'] = video.orientation === 'portrait' || video.orientation === 'landscape' ? video.orientation : undefined
    const format: ExerciseCatalogMediaVideo['format'] = video.format === 'hls' || video.format === 'mp4' || video.format === 'webp' || video.format === 'gif' ? video.format : undefined
    return [{
      id,
      provider,
      externalId: typeof video.externalId === 'string' ? video.externalId.slice(0, 160) : undefined,
      url: typeof video.url === 'string' ? video.url.slice(0, 2_000) : undefined,
      hlsUrl: typeof video.hlsUrl === 'string' ? video.hlsUrl.slice(0, 2_000) : undefined,
      posterUrl: typeof video.posterUrl === 'string' ? video.posterUrl.slice(0, 2_000) : undefined,
      tag,
      angle,
      presenter,
      orientation,
      format,
      durationSeconds: typeof video.durationSeconds === 'number' ? Math.max(0, Math.round(video.durationSeconds)) : undefined,
      isPrimary: video.isPrimary === true,
    }]
  }).slice(0, 12)
}

function externalMedia(value: unknown): ExerciseCatalogExternalMedia | undefined {
  const data = record(value)
  if (!data || !['ymove', 'ymove_free', 'exercisedb'].includes(String(data.provider)) || typeof data.exerciseId !== 'string' || !data.exerciseId) return undefined
  return {
    provider: data.provider as ExerciseCatalogExternalMedia['provider'],
    exerciseId: data.exerciseId.slice(0, 160),
    slug: typeof data.slug === 'string' ? data.slug.slice(0, 200) : undefined,
    preferredVideoTag: data.preferredVideoTag === 'white-background' || data.preferredVideoTag === 'gym-shot' ? data.preferredVideoTag : undefined,
    preferredOrientation: data.preferredOrientation === 'portrait' || data.preferredOrientation === 'landscape' ? data.preferredOrientation : undefined,
    syncedAt: typeof data.syncedAt === 'string' ? data.syncedAt.slice(0, 80) : undefined,
  }
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
    ...(data.popularForWomen === true ? { popularForWomen: true } : {}),
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
      posterImageId: typeof media?.posterImageId === 'string' ? media.posterImageId : undefined,
      images: mediaImages(media?.images),
      videos: mediaVideos(media?.videos),
      animationUrl: typeof media?.animationUrl === 'string' ? media.animationUrl : undefined,
      mimeType: typeof media?.mimeType === 'string' ? media.mimeType : undefined,
      checksum: typeof media?.checksum === 'string' ? media.checksum : undefined,
    },
    externalMedia: externalMedia(data.externalMedia),
    defaultPrescription: {
      sets: typeof prescription?.sets === 'number' ? prescription.sets : 3,
      reps: typeof prescription?.reps === 'string' ? prescription.reps : '10–12',
      restSeconds: typeof prescription?.restSeconds === 'number' ? prescription.restSeconds : 60,
      rpe: typeof prescription?.rpe === 'number' ? prescription.rpe : 7,
    },
    source: {
      provider: source?.provider === 'aura' || source?.provider === 'ymove' || source?.provider === 'ymove_free' || source?.provider === 'exercisedb' || source?.provider === 'programme' ? source.provider : 'free-exercise-db',
      sourceExerciseId: typeof source?.sourceExerciseId === 'string' ? source.sourceExerciseId : data.id,
      sourceVersion: typeof source?.sourceVersion === 'string' ? source.sourceVersion : 'unknown',
      license: source?.license === 'Aura-owned' || source?.license === 'External-provider' || source?.license === 'CC-BY-SA-3.0' || source?.license === 'Free-commercial-embed' ? source.license : 'Unlicense',
    },
    sourceAttribution: typeof data.sourceAttribution === 'string' ? data.sourceAttribution : 'Free Exercise DB · Unlicense',
    hasWorkingDraft: data.hasWorkingDraft === true,
    editRevision: typeof data.editRevision === 'number' ? Math.max(0, Math.round(data.editRevision)) : undefined,
    editStatus: data.editStatus === 'review' ? 'review' : data.editStatus === 'draft' ? 'draft' : undefined,
  }
}

function parseExternalExercise(value: unknown): ExternalExerciseCandidate | null {
  const data = record(value)
  if (!data || typeof data.id !== 'string' || typeof data.title !== 'string') return null
  const provider: ExternalExerciseProvider = data.provider === 'ymove' || data.provider === 'ymove_free' ? data.provider : 'exercisedb'
  return {
    id: data.id.slice(0, 160),
    provider,
    title: data.title.slice(0, 200),
    slug: typeof data.slug === 'string' ? data.slug.slice(0, 200) : undefined,
    description: typeof data.description === 'string' ? data.description.slice(0, 2_000) : undefined,
    instructions: strings(data.instructions, 20),
    importantPoints: strings(data.importantPoints, 20),
    muscleGroup: typeof data.muscleGroup === 'string' ? data.muscleGroup.slice(0, 120) : undefined,
    secondaryMuscles: strings(data.secondaryMuscles, 12),
    equipment: strings(data.equipment, 12),
    category: typeof data.category === 'string' ? data.category.slice(0, 120) : undefined,
    difficulty: typeof data.difficulty === 'string' ? data.difficulty.slice(0, 40) : undefined,
    thumbnailUrl: typeof data.thumbnailUrl === 'string' ? data.thumbnailUrl.slice(0, 2_000) : undefined,
    videoCount: typeof data.videoCount === 'number' ? Math.max(0, Math.round(data.videoCount)) : 0,
    mediaLabel: typeof data.mediaLabel === 'string' ? data.mediaLabel.slice(0, 80) : undefined,
    licenseNotice: typeof data.licenseNotice === 'string' ? data.licenseNotice.slice(0, 300) : undefined,
    videos: mediaVideos(data.videos),
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

export async function getExerciseCatalogItem(exerciseId: string): Promise<ExerciseCatalogDetail> {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa được cấu hình.')
  const callable = httpsCallable<{ exerciseId: string }, unknown>(firebaseFunctions, 'getExerciseCatalogItem')
  const response = await callable({ exerciseId })
  const payload = record(response.data)
  const item = parseCatalogItem(payload?.item)
  if (!item) throw new Error('Dữ liệu bài tập không hợp lệ.')
  // During a staged Functions rollout, older endpoints can temporarily return
  // only the published item. Keep detail viewing available while the richer
  // editable projection catches up.
  const editItem = parseCatalogItem(payload?.editItem) || item
  return { item, editItem }
}

export async function searchExternalExerciseCatalog(input: {
  provider?: ExternalExerciseProvider
  search?: string
  muscleGroup?: string
  equipment?: string
  difficulty?: string
  videoTag?: 'white-background' | 'gym-shot' | ''
  page?: number
  pageSize?: number
} = {}): Promise<ExternalExerciseSearchResult> {
  if (!firebaseFunctions) return { provider: input.provider || 'exercisedb', providerConfigured: false, items: [], total: 0, page: 1, pageSize: 12 }
  const callable = httpsCallable<typeof input, unknown>(firebaseFunctions, 'searchExternalExerciseCatalog')
  const response = await callable(input)
  const payload = record(response.data)
  const items = Array.isArray(payload?.items) ? payload.items.flatMap((entry) => {
    const parsed = parseExternalExercise(entry)
    return parsed ? [parsed] : []
  }) : []
  return {
    provider: payload?.provider === 'ymove' || payload?.provider === 'ymove_free' ? payload.provider : 'exercisedb',
    providerConfigured: payload?.providerConfigured === true,
    items,
    total: typeof payload?.total === 'number' ? payload.total : items.length,
    page: typeof payload?.page === 'number' ? payload.page : 1,
    pageSize: typeof payload?.pageSize === 'number' ? payload.pageSize : 12,
  }
}

export async function getExternalExercisePreview(externalExerciseId: string, provider: ExternalExerciseProvider = 'exercisedb'): Promise<{ provider: ExternalExerciseProvider; providerConfigured: boolean; item: ExternalExerciseCandidate | null }> {
  if (!firebaseFunctions) return { provider, providerConfigured: false, item: null }
  const callable = httpsCallable<{ externalExerciseId: string; provider: ExternalExerciseProvider }, unknown>(firebaseFunctions, 'getExternalExercisePreview')
  const response = await callable({ externalExerciseId, provider })
  const payload = record(response.data)
  const resolvedProvider: ExternalExerciseProvider = payload?.provider === 'ymove' || payload?.provider === 'ymove_free' ? payload.provider : 'exercisedb'
  return { provider: resolvedProvider, providerConfigured: payload?.providerConfigured === true, item: parseExternalExercise(payload?.item) }
}

export async function getExerciseCatalogMedia(exerciseId: string): Promise<ExerciseCatalogResolvedMedia> {
  if (!firebaseFunctions) return { providerConfigured: false, externalLinked: false, images: [], videos: [] }
  const callable = httpsCallable<{ exerciseId: string }, unknown>(firebaseFunctions, 'getExerciseCatalogMedia')
  const response = await callable({ exerciseId })
  const payload = record(response.data)
  return {
    provider: payload?.provider === 'ymove' || payload?.provider === 'ymove_free' ? payload.provider : payload?.provider === 'exercisedb' ? 'exercisedb' : undefined,
    providerConfigured: payload?.providerConfigured === true,
    externalLinked: payload?.externalLinked === true,
    transientMedia: payload?.transientMedia === true,
    expiresAt: typeof payload?.expiresAt === 'string' ? payload.expiresAt : undefined,
    images: mediaImages(payload?.images),
    videos: mediaVideos(payload?.videos),
    animationUrl: typeof payload?.animationUrl === 'string' ? payload.animationUrl : undefined,
  }
}

export async function saveExerciseCatalogDraft(input: {
  exerciseId: string
  expectedRevision: number
  draft: ExerciseCatalogDraft
}) {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa được cấu hình.')
  const callable = httpsCallable<typeof input, { exerciseId: string; revision: number; status: 'draft' | 'review'; hasWorkingDraft?: boolean }>(firebaseFunctions, 'saveExerciseCatalogDraft')
  const response = await callable(input)
  return response.data
}

export async function publishExerciseCatalogItem(exerciseId: string, expectedRevision: number) {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa được cấu hình.')
  const callable = httpsCallable<{ exerciseId: string; expectedRevision: number }, { exerciseId: string; revision: number; status: 'published' }>(firebaseFunctions, 'publishExerciseCatalogItem')
  const response = await callable({ exerciseId, expectedRevision })
  return response.data
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
    media: {
      ...item.media,
      images: item.media.images?.map((image) => ({ ...image })),
      videos: item.media.videos?.map((video) => ({ ...video })),
    },
    externalMedia: item.externalMedia ? { ...item.externalMedia } : undefined,
    sourceAttribution: item.sourceAttribution,
  }
}
