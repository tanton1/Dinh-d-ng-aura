import React, { useState, useEffect, useMemo, useRef } from 'react'
import { safeLocalStorageSet } from '../../lib/safeStorage'
import { 
  Camera, 
  ChevronRight, 
  Image as ImageIcon, 
  Lock, 
  Trash2, 
  HelpCircle, 
  X, 
  Calendar, 
  Info, 
  Plus, 
  TrendingUp, 
  Sliders, 
  ArrowRight,
  Upload
} from 'lucide-react'
import { saveUserProgressPhoto, deleteUserProgressPhoto, subscribeToUserProgressPhotos, uploadUserProgressPhoto } from '../../services/firebaseService'

interface ProgressPhoto {
  id: string
  date: string
  angle: 'front' | 'side' | 'back'
  weightKg?: number
  bodyFat?: number
  waistCm?: number
  chestCm?: number
  hipsCm?: number
  notes?: string
  imageUrl: string
  isPrivate: boolean
  createdAt: string
}

interface ProgressPhotosCardProps {
  ownerId: string
  triggerAddPhoto?: boolean
  onAddPhotoTriggered?: () => void
  onNavigateToStudio?: () => void
}

const FrontPoseIcon = ({ active }: { active: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="4" r="2.5" fill={active ? '#ff1a8c' : '#94a3b8'} />
    <path d="M7 9.5C7 8.67 7.67 8 8.5 8H15.5C16.33 8 17 8.67 17 9.5V14C17 14.55 16.55 15 16 15H15V21C15 21.55 14.55 22 14 22H13C12.45 22 12 21.55 12 21V16H12V21C12 21.55 11.55 22 11 22H10C9.45 22 9 21.55 9 21V15H8C7.45 15 7 14.55 7 14V9.5Z" fill={active ? '#ff1a8c' : '#94a3b8'} />
  </svg>
)

const SidePoseIcon = ({ active }: { active: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="4" r="2.5" fill={active ? '#ff1a8c' : '#94a3b8'} />
    <path d="M10 8.5C10 8 10.5 7.5 11 7.5H13C14 7.5 15 8.2 15 9.2V13.5C15 14 14.5 14.5 14 14.5H13V21C13 21.55 12.55 22 12 22H11C10.45 22 10 21.55 10 21V14.5C9.45 14.5 9 14 9 13.5V10C9 9 9.5 8.5 10 8.5Z" fill={active ? '#ff1a8c' : '#94a3b8'} />
  </svg>
)

const BackPoseIcon = ({ active }: { active: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="4" r="2.5" fill={active ? '#ff1a8c' : '#94a3b8'} />
    <path d="M7 9.5C7 8.67 7.67 8 8.5 8H15.5C16.33 8 17 8.67 17 9.5V14C17 14.55 16.55 15 16 15H14.8V21C14.8 21.55 14.35 22 13.8 22H12.8C12.25 22 11.8 21.55 11.8 21V15.5H12.2V21C12.2 21.55 11.75 22 11.2 22H10.2C9.65 22 9.2 21.55 9.2 21V15H8C7.45 15 7 14.55 7 14V9.5Z" fill={active ? '#ff1a8c' : '#94a3b8'} />
    <path d="M12 9V14" stroke="#ffffff" strokeWidth="1" strokeLinecap="round" />
  </svg>
)

const defaultPhotos: ProgressPhoto[] = []

// Reusable canvas-based image compression to avoid Firestore document limit issues
const compressImage = (base64Str: string, maxWidth = 1000, maxHeight = 1000, quality = 0.75): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.src = base64Str
    img.onload = () => {
      const canvas = document.createElement('canvas')
      let width = img.width
      let height = img.height
      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width)
          width = maxWidth
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height)
          height = maxHeight
        }
      }
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(base64Str)
        return
      }
      ctx.drawImage(img, 0, 0, width, height)
      const compressed = canvas.toDataURL('image/jpeg', quality)
      resolve(compressed)
    }
    img.onerror = (err) => {
      reject(err)
    }
  })
}

export function ProgressPhotosCard({ ownerId, triggerAddPhoto, onAddPhotoTriggered, onNavigateToStudio }: ProgressPhotosCardProps) {
  const [photos, setPhotos] = useState<ProgressPhoto[]>([])
  const [activeAngle, setActiveAngle] = useState<'front' | 'side' | 'back'>('front')
  
  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isGalleryModalOpen, setIsGalleryModalOpen] = useState(false)
  const [isPoseGuideOpen, setIsPoseGuideOpen] = useState(false)

  // Add form state
  const [formDate, setFormDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [formAngle, setFormAngle] = useState<'front' | 'side' | 'back'>('front')
  const [formWeight, setFormWeight] = useState<string>('60')
  const [formBodyFat, setFormBodyFat] = useState<string>('')
  const [formWaist, setFormWaist] = useState<string>('')
  const [formNotes, setFormNotes] = useState<string>('')
  const [formImage, setFormImage] = useState<string>('')
  const [formIsPrivate, setFormIsPrivate] = useState(true)

  const [uploadError, setUploadError] = useState<string>('')
  const [isCompressing, setIsCompressing] = useState(false)
  const [isUploading, setIsUploading] = useState(false)

  // Trigger opening add modal from outside
  useEffect(() => {
    if (triggerAddPhoto) {
      onAddPhotoTriggered?.()
      if (onNavigateToStudio) {
        onNavigateToStudio()
      } else {
        setFormAngle(activeAngle)
        setIsAddModalOpen(true)
      }
    }
  }, [triggerAddPhoto, activeAngle, onAddPhotoTriggered, onNavigateToStudio])

  // Custom Comparison Override selectors (persisted per angle)
  const [customBeforeMap, setCustomBeforeMap] = useState<Record<string, string>>({})
  const [customAfterMap, setCustomAfterMap] = useState<Record<string, string>>({})

  // Load persisted selections
  useEffect(() => {
    try {
      const cachedBefore = localStorage.getItem(`aura:progress-photos:before:${ownerId}`)
      const cachedAfter = localStorage.getItem(`aura:progress-photos:after:${ownerId}`)
      if (cachedBefore) setCustomBeforeMap(JSON.parse(cachedBefore))
      if (cachedAfter) setCustomAfterMap(JSON.parse(cachedAfter))
    } catch (err) {
      console.error('Error loading custom photo overrides:', err)
    }
  }, [ownerId])

  const customBeforeId = customBeforeMap[activeAngle] || null
  const customAfterId = customAfterMap[activeAngle] || null

  const handleSetCustomBeforeId = (id: string | null) => {
    const updated = { ...customBeforeMap }
    if (id) {
      updated[activeAngle] = id
    } else {
      delete updated[activeAngle]
    }
    setCustomBeforeMap(updated)
    safeLocalStorageSet(`aura:progress-photos:before:${ownerId}`, JSON.stringify(updated))
  }

  const handleSetCustomAfterId = (id: string | null) => {
    const updated = { ...customAfterMap }
    if (id) {
      updated[activeAngle] = id
    } else {
      delete updated[activeAngle]
    }
    setCustomAfterMap(updated)
    safeLocalStorageSet(`aura:progress-photos:after:${ownerId}`, JSON.stringify(updated))
  }

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load photos from local storage and sync with Firebase
  const loadLocalPhotos = () => {
    const cached1 = localStorage.getItem(`aura:progress-photos:${ownerId}`)
    const cached2 = localStorage.getItem(`aura:cache:user_progress_photos:${ownerId}`)
    const cached = cached1 || cached2
    if (cached) {
      try {
        const parsed = JSON.parse(cached)
        if (Array.isArray(parsed) && parsed.length > 0) {
          setPhotos(parsed)
        }
      } catch (e) {
        console.error('Error parsing cached photos:', e)
      }
    }
  }

  useEffect(() => {
    loadLocalPhotos()
    const handleUpdateEvent = () => {
      loadLocalPhotos()
    }
    window.addEventListener('aura:progress-photos-updated', handleUpdateEvent)

    if (ownerId === 'demo' || ownerId === 'anonymous') {
      // Just keep local
    }

    return () => {
      window.removeEventListener('aura:progress-photos-updated', handleUpdateEvent)
    }
  }, [ownerId])

  useEffect(() => {
    if (ownerId && ownerId !== 'demo' && ownerId !== 'anonymous') {
      try {
        const unsub = subscribeToUserProgressPhotos(ownerId, (data) => {
          if (Array.isArray(data) && data.length > 0) {
            setPhotos(data)
            safeLocalStorageSet(`aura:progress-photos:${ownerId}`, JSON.stringify(data))
            safeLocalStorageSet(`aura:cache:user_progress_photos:${ownerId}`, JSON.stringify(data))
          }
        })
        return () => unsub()
      } catch (err) {
        console.error('Subscribe error', err)
      }
    }
  }, [ownerId])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 12 * 1024 * 1024) {
      setUploadError('Kích thước ảnh gốc quá lớn! Vui lòng chọn ảnh dưới 12MB.')
      return
    }

    setUploadError('')
    setIsCompressing(true)

    const reader = new FileReader()
    reader.onloadend = async () => {
      if (typeof reader.result === 'string') {
        try {
          const compressed = await compressImage(reader.result, 1000, 1000, 0.75)
          setFormImage(compressed)
        } catch (err) {
          console.error('Image compression failed, using original:', err)
          setFormImage(reader.result)
        } finally {
          setIsCompressing(false)
        }
      } else {
        setIsCompressing(false)
      }
    }
    reader.onerror = () => {
      setUploadError('Không thể đọc file ảnh này.')
      setIsCompressing(false)
    }
    reader.readAsDataURL(file)
  }

  const handleSavePhoto = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formImage) return
    setIsUploading(true)

    try {
      let finalImageUrl = formImage

      const newPhoto: ProgressPhoto = {
        id: Date.now().toString(),
        date: formDate,
        angle: formAngle,
        weightKg: formWeight ? parseFloat(formWeight) : undefined,
        bodyFat: formBodyFat ? parseFloat(formBodyFat) : undefined,
        waistCm: formWaist ? parseFloat(formWaist) : undefined,
        notes: formNotes,
        imageUrl: finalImageUrl,
        isPrivate: formIsPrivate,
        createdAt: new Date().toISOString()
      }

      const updated = [...photos, newPhoto]
      setPhotos(updated)
      safeLocalStorageSet(`aura:progress-photos:${ownerId}`, JSON.stringify(updated))
      window.dispatchEvent(new Event('aura:progress-photos-updated'))

      if (ownerId && ownerId !== 'demo' && ownerId !== 'anonymous') {
         await saveUserProgressPhoto(ownerId, newPhoto as any)
      }
      setIsAddModalOpen(false)
      setFormImage('')
      setFormNotes('')
      setFormBodyFat('')
      setFormWaist('')
    } catch (err) {
      console.error(err)
      setUploadError('Có lỗi xảy ra khi lưu ảnh.')
    } finally {
      setIsUploading(false)
    }
  }

  const handleDeletePhoto = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    const updated = photos.filter(p => p.id !== id)
    setPhotos(updated)
    safeLocalStorageSet(`aura:progress-photos:${ownerId}`, JSON.stringify(updated))
    window.dispatchEvent(new Event('aura:progress-photos-updated'))

    if (ownerId && ownerId !== 'demo' && ownerId !== 'anonymous') {
      try {
        await deleteUserProgressPhoto(ownerId, id)
      } catch (err) {
        console.error(err)
      }
    }
  }

  const anglePhotos = useMemo(() => {
    return photos.filter(p => p.angle === activeAngle).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  }, [photos, activeAngle])

  const beforePhoto = useMemo(() => {
    if (anglePhotos.length === 0) return null
    if (customBeforeId) {
      const found = anglePhotos.find(p => p.id === customBeforeId)
      if (found) return found
    }
    return anglePhotos[0]
  }, [anglePhotos, customBeforeId])

  const afterPhoto = useMemo(() => {
    if (anglePhotos.length === 0) return null
    if (customAfterId) {
      const found = anglePhotos.find(p => p.id === customAfterId)
      if (found) return found
    }
    return anglePhotos[anglePhotos.length - 1]
  }, [anglePhotos, customAfterId])

  const renderPhotoMetrics = (photo: ProgressPhoto | null, isAfter = false) => {
    if (!photo) return null
    const metrics: { label: string; value: string }[] = []
    if (photo.bodyFat !== undefined) metrics.push({ label: '% Mỡ', value: `${photo.bodyFat}%` })
    if (photo.waistCm !== undefined) metrics.push({ label: 'Vòng eo', value: `${photo.waistCm}cm` })
    if (photo.chestCm !== undefined) metrics.push({ label: 'Vòng ngực', value: `${photo.chestCm}cm` })
    if (photo.hipsCm !== undefined) metrics.push({ label: 'Vòng mông', value: `${photo.hipsCm}cm` })

    return (
      <div style={{ marginTop: '6px' }}>
        {metrics.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {metrics.map((m, idx) => (
              <span
                key={idx}
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '6px',
                  background: isAfter ? '#fff0f5' : '#f1f5f9',
                  color: isAfter ? '#ff1a8c' : '#475569',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                {m.label}: {m.value}
              </span>
            ))}
          </div>
        ) : photo.notes ? (
          <div style={{ fontSize: '11px', color: '#475569', fontStyle: 'italic', background: '#f8fafc', padding: '4px 8px', borderRadius: '6px', border: '1px solid #f1f5f9', lineHeight: '1.3' }}>
            "{photo.notes}"
          </div>
        ) : (
          <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Sliders size={12} /> Số đo khác: Chưa cập nhật
          </div>
        )}
      </div>
    )
  }

  return (
    <div id="progress-photos-section" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      
      {/* Section Header: Nhật ký vóc dáng */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '-2px' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Camera size={20} style={{ color: '#ff1a8c' }} />
            Nhật ký vóc dáng
          </h2>
          <p style={{ fontSize: '13px', color: '#64748b', margin: '3px 0 0 0', fontWeight: 500 }}>
            Theo dõi sự thay đổi hình thể qua từng góc chụp và mốc thời gian
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#fff0f5', padding: '6px 12px', borderRadius: '20px', border: '1px solid rgba(255, 26, 140, 0.15)', fontSize: '12px', color: '#ff1a8c', fontWeight: 700 }}>
          <Lock size={13} />
          <span>Bảo mật</span>
        </div>
      </div>

      {/* 1. Angle Selector Tabs Bar & Guide Button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ display: 'flex', flex: 1, background: '#ffffff', padding: '5px', borderRadius: '16px', border: '1px solid #f1f5f9', boxShadow: '0 2px 8px rgba(0,0,0,0.02)', gap: '4px' }}>
          {[
            { id: 'front', label: 'Chính diện', renderIcon: (act: boolean) => <FrontPoseIcon active={act} /> },
            { id: 'side', label: 'Nghiêng', renderIcon: (act: boolean) => <SidePoseIcon active={act} /> },
            { id: 'back', label: 'Sau lưng', renderIcon: (act: boolean) => <BackPoseIcon active={act} /> },
          ].map((tab) => {
            const active = activeAngle === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveAngle(tab.id as any)}
                style={{
                  flex: 1,
                  padding: '8px 4px',
                  borderRadius: '12px',
                  border: 'none',
                  background: active ? '#fff0f5' : 'transparent',
                  color: active ? '#ff1a8c' : '#64748b',
                  fontSize: '11px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                {tab.renderIcon(active)}
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>

        <button
          type="button"
          onClick={() => setIsPoseGuideOpen(true)}
          style={{
            background: '#ffffff',
            border: '1px solid #f1f5f9',
            borderRadius: '16px',
            padding: '8px 12px',
            color: '#475569',
            fontSize: '11px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            cursor: 'pointer',
            fontWeight: 700,
            boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
            height: '100%',
            flexShrink: 0,
            width: '85px'
          }}
        >
          <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <HelpCircle size={15} style={{ color: '#64748b' }} />
          </div>
          <span style={{ textAlign: 'center', lineHeight: '1.2' }}>Cách chụp<br/>chuẩn</span>
        </button>
      </div>

      {/* 2. Side-by-Side Comparison Showcase */}
      {anglePhotos.length === 0 ? (
        <div style={{ background: '#ffffff', border: '1px solid #f1f5f9', borderRadius: '24px', padding: '36px 20px', textAlign: 'center', boxShadow: '0 4px 15px rgba(0,0,0,0.02)' }}>
          <ImageIcon size={44} style={{ color: '#cbd5e1', marginBottom: 12 }} />
          <h3 style={{ fontSize: 15, fontWeight: 800, color: '#0f172a', margin: '0 0 6px' }}>Chưa có ảnh cho góc {activeAngle === 'front' ? 'Chính diện' : activeAngle === 'side' ? 'Nghiêng' : 'Sau lưng'}</h3>
          <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px', maxWidth: 320, marginLeft: 'auto', marginRight: 'auto' }}>
            Hãy đăng tải bức ảnh đầu tiên để theo dõi tiến trình thay đổi vóc dáng của bạn.
          </p>
          <button
            type="button"
            onClick={() => {
              if (onNavigateToStudio) {
                onNavigateToStudio()
              } else {
                setFormAngle(activeAngle)
                setIsAddModalOpen(true)
              }
            }}
            style={{
              padding: '10px 20px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #ff1a8c 0%, #ff7b54 100%)',
              color: '#fff',
              border: 'none',
              fontWeight: 800,
              fontSize: 13,
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(255, 26, 140, 0.3)'
            }}
          >
            + Thêm ảnh ngay
          </button>
        </div>
      ) : (
        <div style={{ background: '#ffffff', border: '1px solid #f1f5f9', borderRadius: '24px', padding: '18px', boxShadow: '0 4px 15px rgba(0,0,0,0.03)' }}>
          {/* Comparison Selector Box */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
             {/* Trước Selection */}
             <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#ff1a8c', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase' }}>
                  <Calendar size={12} /> Trước
                </div>
                <select
                  value={beforePhoto?.id || ''}
                  onChange={(e) => handleSetCustomBeforeId(e.target.value)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#0f172a',
                    fontSize: '16px',
                    fontWeight: 800,
                    appearance: 'none',
                    outline: 'none',
                    padding: 0,
                    cursor: 'pointer',
                  }}
                >
                  {anglePhotos.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.date.split('-').reverse().join('/')}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: '13px', color: '#ff1a8c', fontWeight: 800 }}>{beforePhoto?.weightKg ? `${beforePhoto.weightKg} kg` : '-- kg'}</div>
             </div>

             <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: '#fff0f5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff1a8c', flexShrink: 0 }}>
               <ChevronRight size={16} />
             </div>

             {/* Sau Selection */}
             <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-end', textAlign: 'right' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#ff1a8c', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase' }}>
                  <Calendar size={12} /> Sau
                </div>
                <select
                  value={afterPhoto?.id || ''}
                  onChange={(e) => handleSetCustomAfterId(e.target.value)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#0f172a',
                    fontSize: '16px',
                    fontWeight: 800,
                    appearance: 'none',
                    outline: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    textAlign: 'right',
                    direction: 'rtl'
                  }}
                >
                  {anglePhotos.map(p => (
                    <option key={p.id} value={p.id} disabled={p.id === beforePhoto?.id}>
                      {p.date.split('-').reverse().join('/')}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: '13px', color: '#ff1a8c', fontWeight: 800 }}>{afterPhoto?.weightKg ? `${afterPhoto.weightKg} kg` : '-- kg'}</div>
             </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            {/* Left Card: Before */}
            <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
              <div style={{ width: '100%', aspectRatio: '3/4', borderRadius: '16px', overflow: 'hidden', position: 'relative', background: '#f8fafc', marginBottom: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                <span style={{ position: 'absolute', top: 10, left: 10, padding: '4px 10px', borderRadius: '8px', background: 'rgba(30, 41, 59, 0.75)', color: '#ffffff', fontSize: '11px', fontWeight: 700, zIndex: 10, backdropFilter: 'blur(4px)' }}>
                  Trước
                </span>
                
                {beforePhoto ? (
                  <img 
                    src={beforePhoto.imageUrl} 
                    alt="Trước" 
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
                    <ImageIcon size={32} />
                    <span style={{ fontSize: '12px', marginTop: 4 }}>Chưa có ảnh</span>
                  </div>
                )}

                {beforePhoto && (
                  <button 
                    onClick={() => handleDeletePhoto(beforePhoto.id)}
                    style={{ position: 'absolute', bottom: 10, right: 10, width: 32, height: 32, borderRadius: '50%', background: '#ffffff', border: '1px solid #f1f5f9', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              {/* Render non-redundant other body metrics for Before Photo */}
              {renderPhotoMetrics(beforePhoto, false)}
            </div>

            {/* Right Card: After */}
            <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
              <div style={{ width: '100%', aspectRatio: '3/4', borderRadius: '16px', overflow: 'hidden', position: 'relative', background: '#f8fafc', marginBottom: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                <span style={{ position: 'absolute', top: 10, left: 10, padding: '4px 10px', borderRadius: '8px', background: '#ff1a8c', color: '#ffffff', fontSize: '11px', fontWeight: 700, zIndex: 10, boxShadow: '0 2px 6px rgba(255,26,140,0.3)' }}>
                  Sau
                </span>
                
                {afterPhoto ? (
                  <img 
                    src={afterPhoto.imageUrl} 
                    alt="Sau" 
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
                    <ImageIcon size={32} />
                    <span style={{ fontSize: '12px', marginTop: 4 }}>Chưa có ảnh</span>
                  </div>
                )}
                
                {beforePhoto && afterPhoto && beforePhoto.weightKg && afterPhoto.weightKg && (
                  <span style={{ position: 'absolute', bottom: 10, left: 10, padding: '4px 8px', borderRadius: '8px', background: '#ff1a8c', color: '#ffffff', fontSize: '11px', fontWeight: 800, zIndex: 10, display: 'flex', alignItems: 'center', gap: '3px', boxShadow: '0 2px 6px rgba(255,26,140,0.3)' }}>
                    <TrendingUp size={12} /> 
                    {afterPhoto.weightKg > beforePhoto.weightKg 
                      ? `+${(afterPhoto.weightKg - beforePhoto.weightKg).toFixed(1)}kg`
                      : afterPhoto.weightKg < beforePhoto.weightKg
                      ? `-${(beforePhoto.weightKg - afterPhoto.weightKg).toFixed(1)}kg`
                      : '0kg'}
                  </span>
                )}

                {afterPhoto && (
                  <button 
                    onClick={() => handleDeletePhoto(afterPhoto.id)}
                    style={{ position: 'absolute', bottom: 10, right: 10, width: 32, height: 32, borderRadius: '50%', background: '#ffffff', border: '1px solid #f1f5f9', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              {/* Render non-redundant other body metrics for After Photo */}
              {renderPhotoMetrics(afterPhoto, true)}
            </div>
          </div>
        </div>
      )}

      {/* 3. Bottom Status Card (Slim & Compact) */}
      <div 
        style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #fff0f5 0%, #ffffff 100%)', 
          border: '1px solid rgba(255, 26, 140, 0.15)', 
          borderRadius: '18px', 
          padding: '12px 16px', 
          position: 'relative', 
          overflow: 'hidden', 
          boxShadow: '0 2px 10px rgba(255, 26, 140, 0.04)',
          gap: '12px',
          flexWrap: 'wrap'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: '180px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '12px', background: '#ffe4f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff1a8c', flexShrink: 0 }}>
            <TrendingUp size={18} />
          </div>
          <div>
            <h3 style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', margin: 0, lineHeight: '1.2' }}>Bạn đang đi đúng hướng!</h3>
            <p style={{ fontSize: '11px', color: '#64748b', margin: '2px 0 0 0', lineHeight: '1.2' }}>Tiếp tục duy trì thói quen tuyệt vời này nhé.</p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => {
              if (onNavigateToStudio) {
                onNavigateToStudio()
              } else {
                setFormAngle(activeAngle)
                setIsAddModalOpen(true)
              }
            }}
            style={{
              padding: '8px 14px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #ff1a8c 0%, #ff7b54 100%)',
              color: '#fff',
              border: 'none',
              fontWeight: 800,
              fontSize: '12px',
              cursor: 'pointer',
              boxShadow: '0 3px 10px rgba(255, 26, 140, 0.25)',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              whiteSpace: 'nowrap'
            }}
          >
            <Plus size={15} /> Thêm ảnh ngay
          </button>

          <button
            type="button"
            onClick={() => setIsGalleryModalOpen(true)}
            style={{
              padding: '8px 12px',
              borderRadius: '12px',
              background: '#ffffff',
              color: '#ff1a8c',
              border: '1px solid rgba(255, 26, 140, 0.25)',
              fontWeight: 800,
              fontSize: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              whiteSpace: 'nowrap'
            }}
          >
            <ImageIcon size={15} /> Thư viện
          </button>
        </div>
      </div>

      {/* MODALS */}
      {isAddModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: 440, borderRadius: 24, padding: 20 }}>
             <h3 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 800 }}>Thêm ảnh tiến độ</h3>
             <form onSubmit={handleSavePhoto}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4 }}>Ngày</label>
                    <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4 }}>Góc chụp</label>
                    <select value={formAngle} onChange={e => setFormAngle(e.target.value as any)} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }}>
                      <option value="front">Chính diện</option>
                      <option value="side">Nghiêng</option>
                      <option value="back">Sau lưng</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4 }}>Cân nặng (kg)</label>
                    <input type="number" step="0.1" placeholder="60" value={formWeight} onChange={e => setFormWeight(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4 }}>% Mỡ</label>
                    <input type="number" step="0.1" placeholder="18" value={formBodyFat} onChange={e => setFormBodyFat(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4 }}>Vòng eo (cm)</label>
                    <input type="number" step="0.5" placeholder="70" value={formWaist} onChange={e => setFormWaist(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }} />
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4 }}>Ghi chú / Cảm nhận</label>
                  <input type="text" placeholder="Ví dụ: Cơ bụng săn chắc hơn..." value={formNotes} onChange={e => setFormNotes(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }} />
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4 }}>Chọn hình ảnh</label>
                  <input type="file" onChange={handleFileChange} accept="image/*" style={{ width: '100%', fontSize: 12 }} />
                </div>
                {formImage && (
                  <div style={{ marginBottom: 12 }}>
                    <img src={formImage} alt="preview" style={{ width: '100%', height: 160, objectFit: 'cover', borderRadius: 12 }} />
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
                  <button type="button" onClick={() => setIsAddModalOpen(false)} style={{ flex: 1, padding: 10, borderRadius: 10, border: '1px solid #cbd5e1', background: '#fff', fontWeight: 700, cursor: 'pointer' }}>Hủy</button>
                  <button type="submit" disabled={isUploading || isCompressing} style={{ flex: 1, padding: 10, borderRadius: 10, border: 'none', background: '#ff1a8c', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>Lưu ảnh</button>
                </div>
             </form>
          </div>
        </div>
      )}

      {isPoseGuideOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: 440, borderRadius: 24, padding: 24 }}>
             <h3 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 800, color: '#0f172a' }}>Cách chụp ảnh tiến độ chuẩn</h3>
             <ul style={{ paddingLeft: 20, color: '#475569', fontSize: 14, lineHeight: 1.5 }}>
               <li style={{ marginBottom: 8 }}>Chụp tại cùng một vị trí, cùng thời điểm trong ngày.</li>
               <li style={{ marginBottom: 8 }}>Đặt điện thoại thẳng đứng ở độ cao ngang ngực.</li>
               <li style={{ marginBottom: 8 }}>Đứng thả lỏng chân rộng bằng vai.</li>
               <li style={{ marginBottom: 8 }}>Sử dụng trang phục tập luyện ôm sát cơ thể.</li>
             </ul>
             <button onClick={() => setIsPoseGuideOpen(false)} style={{ width: '100%', padding: 12, borderRadius: 12, border: 'none', background: '#f1f5f9', fontWeight: 700, marginTop: 16, cursor: 'pointer' }}>Đã hiểu</button>
          </div>
        </div>
      )}

      {isGalleryModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: 700, borderRadius: 24, padding: 24, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
             <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
               <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Tất cả ảnh tiến độ</h3>
               <button onClick={() => setIsGalleryModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X /></button>
             </div>
             <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 16, overflowY: 'auto', paddingRight: 8 }}>
               {photos.map(p => (
                 <div key={p.id} style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: '1px solid #ccc' }}>
                   <img src={p.imageUrl} alt="" style={{ width: '100%', height: 200, objectFit: 'cover' }} referrerPolicy="no-referrer" />
                   <button onClick={() => handleDeletePhoto(p.id)} style={{ position: 'absolute', top: 8, right: 8, background: '#ef4444', color: '#fff', border: 'none', borderRadius: '50%', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Trash2 size={14} /></button>
                 </div>
               ))}
             </div>
          </div>
        </div>
      )}

    </div>
  )
}
