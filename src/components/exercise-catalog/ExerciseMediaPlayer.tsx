import { useEffect, useMemo, useRef, useState } from 'react'
import { Dumbbell, Image as ImageIcon, LoaderCircle, Play, RefreshCw, RotateCcw, Video } from 'lucide-react'
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
  if (media.images?.length) return media.images.filter((entry) => Boolean(entry.url))
  return [
    media.posterUrl ? { id: 'legacy-poster', url: media.posterUrl, role: 'detail' as const, order: 0 } : null,
    media.startImageUrl && media.startImageUrl !== media.posterUrl ? { id: 'legacy-start', url: media.startImageUrl, role: 'start' as const, order: 1 } : null,
    media.endImageUrl && media.endImageUrl !== media.startImageUrl ? { id: 'legacy-end', url: media.endImageUrl, role: 'end' as const, order: 2 } : null,
  ].filter((entry): entry is ExerciseCatalogMediaImage => Boolean(entry))
}

function localVideos(media: ExerciseCatalogMedia): ExerciseCatalogMediaVideo[] {
  const videos = (media.videos || []).filter((entry) => Boolean(entry.url || entry.hlsUrl))
  if (videos.length || !media.animationUrl) return videos
  const animationPath = media.animationUrl.split(/[?#]/)[0].toLowerCase()
  const format: ExerciseCatalogMediaVideo['format'] = animationPath.endsWith('.gif') || media.mimeType === 'image/gif'
    ? 'gif'
    : animationPath.endsWith('.webp') || media.mimeType === 'image/webp'
      ? 'webp'
      : 'mp4'
  return [{ id: 'legacy-animation', provider: 'aura', url: media.animationUrl, posterUrl: media.posterUrl || media.startImageUrl, tag: format === 'gif' || format === 'webp' ? 'animation' : 'aura', format, isPrimary: true }]
}

function videoSource(video: ExerciseCatalogMediaVideo) {
  return video.url || video.hlsUrl || ''
}

function isAnimatedImageVideo(video: ExerciseCatalogMediaVideo) {
  if (video.format === 'gif' || video.format === 'webp') return true
  return /\.(gif|webp)(?:$|[?#])/i.test(videoSource(video))
}

function mergeRemoteAndLocalVideos(remoteVideos: ExerciseCatalogMediaVideo[], localMediaVideos: ExerciseCatalogMediaVideo[]) {
  // Durable catalog media must remain available if a provider refresh returns a
  // stale or temporarily unavailable URL. Different URLs are kept as fallbacks.
  const durableLocal = localMediaVideos.filter((video) => video.provider !== 'ymove')
  return [...durableLocal, ...remoteVideos, ...localMediaVideos].filter((video, index, all) => {
    const source = videoSource(video)
    if (!source) return false
    return index === all.findIndex((candidate) => candidate.provider === video.provider && videoSource(candidate) === source)
  })
}

function mergeRemoteAndLocalImages(remoteImages: ExerciseCatalogMediaImage[], localMediaImages: ExerciseCatalogMediaImage[]) {
  return [...localMediaImages, ...remoteImages].filter((image, index, all) => (
    Boolean(image.url) && index === all.findIndex((candidate) => candidate.url === image.url)
  ))
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
  const [failedKeys, setFailedKeys] = useState<Set<string>>(() => new Set())
  const [replayVersion, setReplayVersion] = useState(0)
  const [autoPlayKey, setAutoPlayKey] = useState('')
  const [playing, setPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => setRemote(resolvedMedia || null), [resolvedMedia])

  const refresh = async () => {
    if (!exerciseId || !externalMedia) return
    setLoading(true); setError(''); setFailedKeys(new Set())
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

  const allEntries = useMemo<MediaEntry[]>(() => {
    const videos = mergeRemoteAndLocalVideos(remote?.videos || [], localVideos(media))
    const images = mergeRemoteAndLocalImages(remote?.images || [], localImages(media))
    return [
      ...videos.map((video, index) => ({ kind: 'video' as const, key: `video-${video.id}-${index}`, video })),
      ...images.map((image, index) => ({ kind: 'image' as const, key: `image-${image.id}-${index}`, image })),
    ]
  }, [media, remote])

  const entries = useMemo(() => allEntries.filter((entry) => !failedKeys.has(entry.key)), [allEntries, failedKeys])

  useEffect(() => {
    if (!entries.some((entry) => entry.key === activeKey)) setActiveKey(entries[0]?.key || '')
  }, [activeKey, entries])

  const active = entries.find((entry) => entry.key === activeKey) || entries[0]
  const currentVideoIndex = active?.kind === 'video' ? entries.filter((entry) => entry.kind === 'video').findIndex((entry) => entry.key === active.key) : -1
  const activeIsAnimatedImage = active?.kind === 'video' && isAnimatedImageVideo(active.video)

  const selectEntry = (entry: MediaEntry) => {
    setError('')
    setPlaying(false)
    setActiveKey(entry.key)
    setReplayVersion((version) => version + 1)
    setAutoPlayKey(entry.kind === 'video' && !isAnimatedImageVideo(entry.video) ? entry.key : '')
  }

  const retryActiveMedia = () => {
    setError('')
    setFailedKeys(new Set())
    setReplayVersion((version) => version + 1)
    if (externalMedia && exerciseId) void refresh()
  }

  const failMedia = (key: string) => {
    setPlaying(false)
    setAutoPlayKey('')
    setFailedKeys((current) => new Set(current).add(key))
    setError('Video này không tải được. Aura đã chuyển sang media dự phòng; bạn có thể thử tải lại.')
  }

  const playActiveVideo = async () => {
    if (active?.kind !== 'video') return
    if (activeIsAnimatedImage) {
      setReplayVersion((version) => version + 1)
      return
    }
    const element = videoRef.current
    if (!element) return
    try {
      element.muted = false
      await element.play()
    } catch {
      setError('Trình duyệt đang chặn phát tự động. Hãy bấm nút phát trong khung video.')
    }
  }

  return <section className={`exercise-media-player ${compact ? 'is-compact' : ''}`} aria-label={`Hình ảnh và video ${name}`}>
    <div className={`exercise-media-player__stage ${active?.kind === 'video' && active.video.orientation === 'portrait' ? 'is-portrait' : ''}`}>
      {loading && !active ? <div className="exercise-media-player__state"><LoaderCircle className="is-spinning" /><span>Đang lấy video mới…</span></div>
        : active?.kind === 'video' && activeIsAnimatedImage ? <img key={`${active.key}-${replayVersion}`} src={videoSource(active.video)} alt={`Minh họa động ${name}`} loading="eager" onError={() => failMedia(active.key)} />
          : active?.kind === 'video' ? <video
          ref={videoRef}
          key={`${active.key}-${replayVersion}`}
          controls
          playsInline
          preload="metadata"
          autoPlay={active.key === autoPlayKey}
          muted={active.key === autoPlayKey}
          poster={active.video.posterUrl || media.posterUrl || media.startImageUrl}
          src={videoSource(active.video)}
          onPlaying={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => failMedia(active.key)}
        >Trình duyệt chưa hỗ trợ video này.</video>
          : active?.kind === 'image' ? <img src={active.image.url} alt={active.image.alt || name} loading="lazy" onError={() => failMedia(active.key)} />
            : <div className="exercise-media-player__state"><Dumbbell /><span>Chưa có media minh họa</span></div>}
      {active?.kind === 'video' && (!playing || activeIsAnimatedImage) && <button type="button" className={`exercise-media-player__play ${activeIsAnimatedImage ? 'is-replay' : ''}`} onClick={() => void playActiveVideo()}>
        {activeIsAnimatedImage ? <RotateCcw /> : <Play />}
        <span>{activeIsAnimatedImage ? 'Phát lại' : 'Phát video'}</span>
      </button>}
      {active?.kind === 'video' && <span className="exercise-media-player__kind"><Play />{videoLabel(active.video, Math.max(0, currentVideoIndex))}</span>}
      {loading && active && <span className="exercise-media-player__refreshing"><LoaderCircle className="is-spinning" />Đang đồng bộ media…</span>}
    </div>

    {entries.length > 1 && <div className="exercise-media-player__rail" aria-label="Chọn ảnh hoặc video">
      {entries.map((entry, index) => <button type="button" className={entry.key === active?.key ? 'is-active' : ''} onClick={() => selectEntry(entry)} key={entry.key}>
        {entry.kind === 'video'
          ? <>{entry.video.posterUrl ? <img src={entry.video.posterUrl} alt="" loading="lazy" /> : <Video />}<i><Play /></i></>
          : <><img src={entry.image.url} alt="" loading="lazy" /><i><ImageIcon /></i></>}
        <span>{entry.kind === 'video' ? videoLabel(entry.video, entries.slice(0, index + 1).filter((item) => item.kind === 'video').length - 1) : `Ảnh ${entries.slice(0, index + 1).filter((item) => item.kind === 'image').length}`}</span>
      </button>)}
    </div>}

    {(externalMedia || error) && <div className={`exercise-media-player__provider ${error ? 'is-error' : ''}`}>
      <span>{error || (remote?.providerConfigured === false ? 'Nguồn video trả phí chưa được cấu hình.' : externalMedia?.provider === 'exercisedb' ? 'Ảnh động từ ExerciseDB Free.' : externalMedia?.provider === 'ymove_free' ? 'Video thuộc bộ 25 bài YMove miễn phí.' : 'Video được tải mới khi mở, không lưu URL tạm.')}</span>
      {(error || (externalMedia && exerciseId)) && <button type="button" onClick={retryActiveMedia} disabled={loading}><RefreshCw />Thử lại</button>}
    </div>}
  </section>
}
