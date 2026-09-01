import { useEffect, useMemo, useState } from 'react'
import { Dumbbell, Image as ImageIcon, LoaderCircle, Play, RefreshCw, Video } from 'lucide-react'
import type {
  ExerciseCatalogExternalMedia,
  ExerciseCatalogMedia,
  ExerciseCatalogMediaImage,
  ExerciseCatalogMediaVideo,
} from '../../types'
import {
  getExerciseCatalogMedia,
  type ExerciseCatalogResolvedMedia,
} from '../../services/exerciseCatalogService'
import './ExerciseMediaPlayer.css'

type MediaEntry =
  | { kind: 'video'; key: string; video: ExerciseCatalogMediaVideo }
  | { kind: 'image'; key: string; image: ExerciseCatalogMediaImage }

function localImages(media: ExerciseCatalogMedia): ExerciseCatalogMediaImage[] {
  if (media.images?.length) return media.images.filter((entry) => Boolean(entry.url)).slice(0, 12)
  return [
    media.posterUrl ? { id: 'legacy-poster', url: media.posterUrl, role: 'detail' as const, order: 0 } : null,
    media.startImageUrl && media.startImageUrl !== media.posterUrl ? { id: 'legacy-start', url: media.startImageUrl, role: 'start' as const, order: 1 } : null,
    media.endImageUrl && media.endImageUrl !== media.startImageUrl ? { id: 'legacy-end', url: media.endImageUrl, role: 'end' as const, order: 2 } : null,
  ].filter((entry): entry is ExerciseCatalogMediaImage => Boolean(entry))
}

function localVideos(media: ExerciseCatalogMedia): ExerciseCatalogMediaVideo[] {
  const videos = (media.videos || []).filter((entry) => Boolean(entry.url || entry.hlsUrl))
  if (videos.length || !media.animationUrl) return videos
  return [{ id: 'legacy-animation', provider: 'aura', url: media.animationUrl, posterUrl: media.posterUrl || media.startImageUrl, tag: 'aura', format: 'mp4', isPrimary: true }]
}

function videoLabel(video: ExerciseCatalogMediaVideo, index: number) {
  if (video.format === 'gif' || video.tag === 'animation') return `Ảnh động ${index + 1}`
  if (video.tag === 'white-background') return `Kỹ thuật ${index + 1}`
  if (video.tag === 'gym-shot') return `Tại phòng tập ${index + 1}`
  return `Video ${index + 1}`
}

export default function ExerciseMediaPlayer({
  exerciseId,
  name,
  media,
  externalMedia,
  resolvedMedia,
  compact = false,
}: {
  exerciseId?: string
  name: string
  media: ExerciseCatalogMedia
  externalMedia?: ExerciseCatalogExternalMedia
  resolvedMedia?: ExerciseCatalogResolvedMedia | null
  compact?: boolean
}) {
  const [remote, setRemote] = useState<ExerciseCatalogResolvedMedia | null>(resolvedMedia || null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeKey, setActiveKey] = useState('')

  useEffect(() => setRemote(resolvedMedia || null), [resolvedMedia])

  const refresh = async () => {
    if (!exerciseId || !externalMedia) return
    setLoading(true); setError('')
    try { setRemote(await getExerciseCatalogMedia(exerciseId)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tải video kỹ thuật.') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    if (!externalMedia || !exerciseId || resolvedMedia) return
    void refresh()
    // Fresh provider URLs are kept in component state only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exerciseId, externalMedia?.exerciseId, externalMedia?.provider])

  const entries = useMemo<MediaEntry[]>(() => {
    const videos = remote?.videos?.length ? remote.videos : localVideos(media)
    const images = remote?.images?.length ? remote.images : localImages(media)
    return [
      ...videos.map((video, index) => ({ kind: 'video' as const, key: `video-${video.id}-${index}`, video })),
      ...images.map((image, index) => ({ kind: 'image' as const, key: `image-${image.id}-${index}`, image })),
    ]
  }, [media, remote])

  useEffect(() => {
    if (!entries.some((entry) => entry.key === activeKey)) setActiveKey(entries[0]?.key || '')
  }, [activeKey, entries])

  const active = entries.find((entry) => entry.key === activeKey) || entries[0]
  const currentVideoIndex = active?.kind === 'video' ? entries.filter((entry) => entry.kind === 'video').findIndex((entry) => entry.key === active.key) : -1

  return <section className={`exercise-media-player ${compact ? 'is-compact' : ''}`} aria-label={`Hình ảnh và video ${name}`}>
    <div className={`exercise-media-player__stage ${active?.kind === 'video' && active.video.orientation === 'portrait' ? 'is-portrait' : ''}`}>
      {loading ? <div className="exercise-media-player__state"><LoaderCircle className="is-spinning" /><span>Đang lấy video mới…</span></div>
        : active?.kind === 'video' && active.video.format === 'gif' ? <img src={active.video.url} alt={`Minh họa động ${name}`} loading="lazy" />
          : active?.kind === 'video' ? <video
          key={active.key}
          controls
          playsInline
          preload="none"
          poster={active.video.posterUrl || media.posterUrl || media.startImageUrl}
          src={active.video.url || active.video.hlsUrl}
        >Trình duyệt chưa hỗ trợ video này.</video>
          : active?.kind === 'image' ? <img src={active.image.url} alt={active.image.alt || name} loading="lazy" />
            : <div className="exercise-media-player__state"><Dumbbell /><span>Chưa có media minh họa</span></div>}
      {active?.kind === 'video' && <span className="exercise-media-player__kind"><Play />{videoLabel(active.video, Math.max(0, currentVideoIndex))}</span>}
    </div>

    {entries.length > 1 && <div className="exercise-media-player__rail" aria-label="Chọn ảnh hoặc video">
      {entries.map((entry, index) => <button type="button" className={entry.key === active?.key ? 'is-active' : ''} onClick={() => setActiveKey(entry.key)} key={entry.key}>
        {entry.kind === 'video'
          ? <>{entry.video.posterUrl ? <img src={entry.video.posterUrl} alt="" loading="lazy" /> : <Video />}<i><Play /></i></>
          : <><img src={entry.image.url} alt="" loading="lazy" /><i><ImageIcon /></i></>}
        <span>{entry.kind === 'video' ? videoLabel(entry.video, entries.slice(0, index + 1).filter((item) => item.kind === 'video').length - 1) : `Ảnh ${entries.slice(0, index + 1).filter((item) => item.kind === 'image').length}`}</span>
      </button>)}
    </div>}

    {(externalMedia || error) && <div className={`exercise-media-player__provider ${error ? 'is-error' : ''}`}>
      <span>{error || (remote?.providerConfigured === false ? 'Nguồn video trả phí chưa được cấu hình.' : externalMedia?.provider === 'exercisedb' ? 'Ảnh động từ ExerciseDB Free.' : externalMedia?.provider === 'ymove_free' ? 'Video thuộc bộ 25 bài YMove miễn phí.' : 'Video được tải mới khi mở, không lưu URL tạm.')}</span>
      {externalMedia && exerciseId && <button type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw />Tải lại</button>}
    </div>}
  </section>
}
