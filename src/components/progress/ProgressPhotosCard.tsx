import React, { useState, useEffect, useMemo, useRef } from 'react'
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

  // Add form state
  const [formDate, setFormDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [formAngle, setFormAngle] = useState<'front' | 'side' | 'back'>('front')
  const [formWeight, setFormWeight] = useState<string>('60')
  const [formNotes, setFormNotes] = useState<string>('')
  const [formImage, setFormImage] = useState<string>('')
  const [formIsPrivate, setFormIsPrivate] = useState(true)
  const [uploadError, setUploadError] = useState<string>('')
  const [isCompressing, setIsCompressing] = useState(false)

  // Custom Comparison Override selectors (persisted per angle)
  const [customBeforeMap, setCustomBeforeMap] = useState<Record<string, string>>({})
  const [customAfterMap, setCustomAfterMap] = useState<Record<string, string>>({})
  const [isUploading, setIsUploading] = useState(false)

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
    localStorage.setItem(`aura:progress-photos:before:${ownerId}`, JSON.stringify(updated))
  }

  const handleSetCustomAfterId = (id: string | null) => {
    const updated = { ...customAfterMap }
    if (id) {
      updated[activeAngle] = id
    } else {
      delete updated[activeAngle]
    }
    setCustomAfterMap(updated)
    localStorage.setItem(`aura:progress-photos:after:${ownerId}`, JSON.stringify(updated))
  }

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load photos from local storage and sync with Firebase
  const loadLocalPhotos = () => {
    const cached = localStorage.getItem(`aura:progress-photos:${ownerId}`)
    if (cached) {
      try {
        const parsed = JSON.parse(cached)
        if (Array.isArray(parsed)) {
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
      return () => window.removeEventListener('aura:progress-photos-updated', handleUpdateEvent)
    }

    // Firebase live synchronization with deduplicated merge
    const unsubscribe = subscribeToUserProgressPhotos(
      ownerId,
      (remotePhotos) => {
        if (remotePhotos && Array.isArray(remotePhotos)) {
          const cachedRaw = localStorage.getItem(`aura:progress-photos:${ownerId}`)
          const localList: ProgressPhoto[] = cachedRaw ? JSON.parse(cachedRaw) : []

          const map = new Map<string, ProgressPhoto>()
          localList.forEach((p) => map.set(p.id, p))
          remotePhotos.forEach((p) => map.set(p.id, p))

          const merged = Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date))
          setPhotos(merged)
          localStorage.setItem(`aura:progress-photos:${ownerId}`, JSON.stringify(merged))
        }
      },
      (err) => {
        console.warn('Firestore progress photos load notice:', err)
      }
    )

    return () => {
      window.removeEventListener('aura:progress-photos-updated', handleUpdateEvent)
      unsubscribe()
    }
  }, [ownerId])

  // Get active photos filtered by current angle
  const anglePhotos = useMemo(() => {
    return photos
      .filter((p) => p.angle === activeAngle)
      .sort((a, b) => a.date.localeCompare(b.date)) // Oldest to newest
  }, [photos, activeAngle])

  // Determine which is Before & After for the current angle
  const beforePhoto = useMemo(() => {
    if (anglePhotos.length === 0) return null
    if (customBeforeId) {
      const match = anglePhotos.find(p => p.id === customBeforeId)
      if (match) return match
    }
    return anglePhotos[0] // Default is oldest
  }, [anglePhotos, customBeforeId])

  const afterPhoto = useMemo(() => {
    if (anglePhotos.length === 0) return null
    if (customAfterId) {
      const match = anglePhotos.find(p => p.id === customAfterId)
      if (match) return match
    }
    if (anglePhotos.length > 1) {
      return anglePhotos[anglePhotos.length - 1] // Default is newest
    }
    return anglePhotos[0]
  }, [anglePhotos, customAfterId])

  // Calculate delta weight between chosen Before & After
  const weightDelta = useMemo(() => {
    if (!beforePhoto || !afterPhoto || beforePhoto.id === afterPhoto.id) return null
    if (typeof beforePhoto.weightKg !== 'number' || typeof afterPhoto.weightKg !== 'number') return null
    const diff = afterPhoto.weightKg - beforePhoto.weightKg
    return {
      diff,
      text: `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} kg`
    }
  }, [beforePhoto, afterPhoto])

  // Handle saving new photo
  const handleAddPhoto = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formImage) {
      setUploadError('Vui lòng chọn hoặc chụp một ảnh tiến độ trước khi lưu!')
      return
    }

    setIsUploading(true)
    let finalImageUrl = formImage

    // Upload to Firebase Storage if logged in
    if (ownerId !== 'demo' && ownerId !== 'anonymous') {
      try {
        const base64ToFile = (base64Str: string, filename: string): File => {
          const arr = base64Str.split(',')
          const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg'
          const bstr = atob(arr[1])
          let n = bstr.length
          const u8arr = new Uint8Array(n)
          while (n--) {
            u8arr[n] = bstr.charCodeAt(n)
          }
          return new File([u8arr], filename, { type: mime })
        }
        const filename = `progress-${formAngle}-${Date.now()}.jpg`
        const file = base64ToFile(formImage, filename)
        finalImageUrl = await uploadUserProgressPhoto(ownerId, file)
      } catch (err) {
        console.warn('Could not upload to Firebase Storage, saving local base64 instead:', err)
      }
    }

    const newPhoto: ProgressPhoto = {
      id: `photo-${Date.now()}`,
      date: formDate,
      angle: formAngle,
      weightKg: formWeight ? parseFloat(formWeight) : undefined,
      notes: formNotes || undefined,
      imageUrl: finalImageUrl,
      isPrivate: formIsPrivate,
      createdAt: new Date().toISOString()
    }

    const updated = [newPhoto, ...photos]
    setPhotos(updated)
    localStorage.setItem(`aura:progress-photos:${ownerId}`, JSON.stringify(updated))
    window.dispatchEvent(new Event('aura:progress-photos-updated'))

    // Save to Firestore if not in demo mode
    if (ownerId !== 'demo' && ownerId !== 'anonymous') {
      try {
        await saveUserProgressPhoto(ownerId, newPhoto as any)
      } catch (err) {
        console.error('Error saving progress photo to Firebase:', err)
        setUploadError('Có lỗi xảy ra khi đồng bộ với đám mây. Vui lòng thử lại.')
      }
    }

    setIsUploading(false)

    // Reset Form & Close Modal
    setFormNotes('')
    setFormImage('')
    setUploadError('')
    setIsAddModalOpen(false)
  }

  // Handle deleting photo
  const handleDeletePhoto = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm('Bạn có chắc chắn muốn xóa ảnh tiến độ này không?')) return

    const updated = photos.filter(p => p.id !== id)
    setPhotos(updated)
    localStorage.setItem(`aura:progress-photos:${ownerId}`, JSON.stringify(updated))
    window.dispatchEvent(new Event('aura:progress-photos-updated'))

    if (customBeforeId === id) handleSetCustomBeforeId(null)
    if (customAfterId === id) handleSetCustomAfterId(null)

    if (ownerId !== 'demo' && ownerId !== 'anonymous') {
      try {
        await deleteUserProgressPhoto(ownerId, id)
      } catch (err) {
        console.error('Error deleting progress photo from Firebase:', err)
      }
    }
  }

  // File Upload base64 converter & compression logic
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

  return (
    <div className="pg-card relative" id="progress-photos-section">
      {/* 1. Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>Nhật ký vóc dáng</h2>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 9999, background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569', fontSize: 12, fontWeight: 700 }}>
              <Lock size={13} style={{ color: '#64748b' }} /> Bảo mật riêng tư
            </span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>Theo dõi trực quan sự thay đổi cơ thể qua từng giai đoạn và góc chụp.</p>
        </div>

        <button
          type="button"
          onClick={() => setIsGalleryModalOpen(true)}
          style={{
            background: 'none',
            border: 'none',
            color: '#db1557',
            fontWeight: 800,
            fontSize: 14,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            padding: '4px 8px',
            borderRadius: 8,
          }}
        >
          <span>Bộ sưu tập ({photos.length})</span>
          <ChevronRight size={18} />
        </button>
      </div>

      {/* 2. Angle Selector Tabs Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'inline-flex', background: '#f1f5f9', padding: 4, borderRadius: 16, border: '1px solid #e2e8f0' }}>
          {[
            { id: 'front', label: 'Chính diện', icon: '🚶' },
            { id: 'side', label: 'Nghiêng', icon: '🧍' },
            { id: 'back', label: 'Sau lưng', icon: '🚶' },
          ].map((tab) => {
            const active = activeAngle === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveAngle(tab.id as any)
                }}
                style={{
                  padding: '6px 14px',
                  borderRadius: 12,
                  border: 'none',
                  background: active ? '#ff6b6b' : 'transparent',
                  color: active ? '#ffffff' : '#475569',
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  boxShadow: active ? '0 2px 8px rgba(255,107,107,0.3)' : 'none'
                }}
              >
                <span>{tab.icon}</span>
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
            border: '1px solid #e2e8f0',
            borderRadius: 14,
            padding: '6px 12px',
            color: '#475569',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
            fontWeight: 700,
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
          }}
        >
          <HelpCircle size={15} style={{ color: '#64748b' }} />
          <span>Cách chụp chuẩn</span>
        </button>
      </div>

      {/* 3. Comparison Selector Box ("Chọn ảnh đối chiếu:") */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '12px 16px', marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: 110, flexShrink: 0 }}>
            <Sliders size={16} style={{ color: '#ff6b6b', flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontWeight: 800, color: '#0f172a', lineHeight: 1.2, whiteSpace: 'normal' }}>
              Chọn ảnh<br />đối chiếu:
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 240 }}>
            {/* Row Trước */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#64748b', width: 44 }}>Trước:</span>
              <div style={{ position: 'relative', flex: 1 }}>
                <select
                  value={beforePhoto?.id || ''}
                  onChange={(e) => handleSetCustomBeforeId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 28px 6px 32px',
                    borderRadius: 10,
                    border: '1px solid #cbd5e1',
                    background: '#f8fafc',
                    color: '#0f172a',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    appearance: 'none'
                  }}
                >
                  {anglePhotos.length === 0 ? (
                    <option value="">Chưa có ảnh góc này</option>
                  ) : (
                    anglePhotos.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.date.split('-').reverse().join('/')} ({p.weightKg ? `${p.weightKg} kg` : 'Chưa ghi kg'})
                      </option>
                    ))
                  )}
                </select>
                <Calendar size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }} />
                <ChevronRight size={14} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', transformOrigin: 'center', rotate: '90deg', pointerEvents: 'none' }} />
              </div>
            </div>

            {/* Row Sau */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#64748b', width: 44 }}>Sau:</span>
              <div style={{ position: 'relative', flex: 1 }}>
                <select
                  value={afterPhoto?.id || ''}
                  onChange={(e) => handleSetCustomAfterId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 28px 6px 32px',
                    borderRadius: 10,
                    border: '1px solid #cbd5e1',
                    background: '#f8fafc',
                    color: '#0f172a',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    appearance: 'none'
                  }}
                >
                  {anglePhotos.length === 0 ? (
                    <option value="">Chưa có ảnh góc này</option>
                  ) : (
                    anglePhotos.map(p => (
                      <option key={p.id} value={p.id} disabled={p.id === beforePhoto?.id}>
                        {p.date.split('-').reverse().join('/')} ({p.weightKg ? `${p.weightKg} kg` : 'Chưa ghi kg'})
                      </option>
                    ))
                  )}
                </select>
                <Calendar size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }} />
                <ChevronRight size={14} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', transformOrigin: 'center', rotate: '90deg', pointerEvents: 'none' }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Side-by-Side Comparison Showcase */}
      {anglePhotos.length === 0 ? (
        <div style={{ background: '#f8fafc', border: '2px dashed #e2e8f0', borderRadius: 20, padding: '40px 20px', textAlign: 'center', marginBottom: 16 }}>
          <ImageIcon size={44} style={{ color: '#94a3b8', marginBottom: 12 }} />
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
              padding: '8px 18px',
              borderRadius: 12,
              background: 'linear-gradient(135deg, #ff5757 0%, #ff7e47 100%)',
              color: '#fff',
              border: 'none',
              fontWeight: 800,
              fontSize: 13,
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(255,87,87,0.3)'
            }}
          >
            + Thêm ảnh ngay
          </button>
        </div>
      ) : (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {/* Left Card: Before (Mốc đầu) */}
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 20, padding: 12, position: 'relative', display: 'flex', flexDirection: 'column' }}>
              <div style={{ width: '100%', aspectRatio: '3/4', borderRadius: 14, overflow: 'hidden', position: 'relative', background: '#f1f5f9' }}>
                <span style={{ position: 'absolute', top: 10, left: 10, padding: '4px 10px', borderRadius: 8, background: 'rgba(30, 41, 59, 0.9)', color: '#ffffff', fontSize: 11, fontWeight: 800, zIndex: 10 }}>
                  Mốc đầu • {beforePhoto ? beforePhoto.date.split('-').reverse().join('/') : '---'}
                </span>
                
                {beforePhoto ? (
                  <img 
                    src={beforePhoto.imageUrl} 
                    alt="Mốc đầu" 
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
                    <ImageIcon size={32} />
                    <span style={{ fontSize: 12, marginTop: 4 }}>Chưa có ảnh</span>
                  </div>
                )}
              </div>

              <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px' }}>
                <span style={{ fontSize: 18, fontWeight: 900, color: '#0f172a' }}>
                  {beforePhoto?.weightKg ? `${beforePhoto.weightKg} kg` : (beforePhoto ? 'Chưa ghi kg' : '-- kg')}
                </span>
                {beforePhoto && (
                  <button 
                    type="button" 
                    onClick={(e) => handleDeletePhoto(beforePhoto.id, e)}
                    style={{ background: 'none', border: 'none', color: '#ef4444', padding: 4, cursor: 'pointer' }}
                    title="Xóa ảnh"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>

            {/* Right Card: After (Mốc mới) */}
            <div style={{ background: '#fff8f8', border: '1px solid #fecdd3', borderRadius: 20, padding: 12, position: 'relative', display: 'flex', flexDirection: 'column' }}>
              <div style={{ width: '100%', aspectRatio: '3/4', borderRadius: 14, overflow: 'hidden', position: 'relative', background: '#ffe4e6' }}>
                <span style={{ position: 'absolute', top: 10, left: 10, padding: '4px 10px', borderRadius: 8, background: '#f43f5e', color: '#ffffff', fontSize: 11, fontWeight: 800, zIndex: 10 }}>
                  Mốc mới • {afterPhoto ? afterPhoto.date.split('-').reverse().join('/') : (beforePhoto ? beforePhoto.date.split('-').reverse().join('/') : '---')}
                </span>
                
                {afterPhoto ? (
                  <img 
                    src={afterPhoto.imageUrl} 
                    alt="Mốc mới" 
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                    referrerPolicy="no-referrer"
                  />
                ) : beforePhoto ? (
                  <img 
                    src={beforePhoto.imageUrl} 
                    alt="Chưa có ảnh mới" 
                    style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.6 }} 
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#f43f5e' }}>
                    <ImageIcon size={32} />
                    <span style={{ fontSize: 12, marginTop: 4 }}>Chưa có ảnh</span>
                  </div>
                )}

                {/* Bottom Overlay Badge for Weight Delta */}
                {weightDelta && (
                  <div style={{ position: 'absolute', bottom: 10, left: 10, background: '#f43f5e', color: '#ffffff', padding: '6px 12px', borderRadius: 12, fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 4, boxShadow: '0 4px 10px rgba(244,63,94,0.3)', zIndex: 10 }}>
                    <span>{weightDelta.diff < 0 ? '↘' : '↗'}</span>
                    <span>{weightDelta.diff < 0 ? `Giảm ${Math.abs(weightDelta.diff).toFixed(1)} kg` : `Tăng ${weightDelta.diff.toFixed(1)} kg`}</span>
                  </div>
                )}
              </div>

              <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px' }}>
                <span style={{ fontSize: 18, fontWeight: 900, color: '#f43f5e' }}>
                  {afterPhoto?.weightKg ? `${afterPhoto.weightKg} kg` : (afterPhoto ? 'Chưa ghi kg' : (beforePhoto?.weightKg ? `${beforePhoto.weightKg} kg` : '-- kg'))}
                </span>
                {afterPhoto && (
                  <button 
                    type="button" 
                    onClick={(e) => handleDeletePhoto(afterPhoto.id, e)}
                    style={{ background: 'none', border: 'none', color: '#ef4444', padding: 4, cursor: 'pointer' }}
                    title="Xóa ảnh"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. Bottom Encouragement & Quick Log Unified Row */}
      <div style={{ 
        background: '#fff5f5', 
        border: '1px solid #fecdd3', 
        borderRadius: 18, 
        padding: '12px 18px', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        gap: 16,
        marginBottom: 16,
        flexWrap: 'wrap'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 200 }}>
          <div style={{ width: 38, height: 38, borderRadius: 12, background: '#ffe4e6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f43f5e', flexShrink: 0 }}>
            <TrendingUp size={20} />
          </div>
          <div>
            <h4 style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', margin: 0 }}>Bạn đang đi đúng hướng!</h4>
            <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>Tiếp tục duy trì thói quen tuyệt vời này nhé.</p>
          </div>
        </div>

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
            borderRadius: 9999,
            border: 'none',
            background: 'linear-gradient(135deg, #ff5757 0%, #ff7e47 100%)',
            color: '#ffffff',
            fontWeight: 800,
            fontSize: 13,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(255,87,87,0.3)',
            transition: 'transform 0.15s ease',
            whiteSpace: 'nowrap'
          }}
          className="active:scale-95"
        >
          <Plus size={16} strokeWidth={3} />
          <span>Ghi nhanh</span>
        </button>
      </div>

      {/* 1. Modal: ADD PHOTO */}
      {isAddModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15,23,42,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#ffffff', width: '100%', maxWidth: 460, borderRadius: 24, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
            {/* Modal Header */}
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Camera size={20} style={{ color: '#db1557' }} />
                <h3 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', margin: 0 }}>Thêm ảnh tiến độ mới</h3>
              </div>
              <button onClick={() => setIsAddModalOpen(false)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4 }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleAddPhoto} style={{ padding: '20px 24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Ngày ghi nhận</label>
                  <input 
                    type="date" 
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    required
                    style={{ width: '100%', height: 38, padding: '0 10px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 13, fontWeight: 600, color: '#334155' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Cân nặng (kg)</label>
                  <input 
                    type="number" 
                    step="0.1"
                    placeholder="VD: 60"
                    value={formWeight}
                    onChange={(e) => setFormWeight(e.target.value)}
                    style={{ width: '100%', height: 38, padding: '0 10px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 13, fontWeight: 600, color: '#334155' }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Góc chụp cơ thể</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[
                    { id: 'front', label: 'Chính diện' },
                    { id: 'side', label: 'Nghiêng sườn' },
                    { id: 'back', label: 'Sau lưng' },
                  ].map((ang) => (
                    <button
                      key={ang.id}
                      type="button"
                      onClick={() => setFormAngle(ang.id as any)}
                      style={{
                        flex: 1,
                        height: 36,
                        borderRadius: 10,
                        border: '1px solid',
                        borderColor: formAngle === ang.id ? '#fbcfe8' : '#e2e8f0',
                        background: formAngle === ang.id ? '#fff0f5' : '#ffffff',
                        color: formAngle === ang.id ? '#db1557' : '#475569',
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      {ang.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Upload image source */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>Chọn tập tin hoặc chụp ảnh</label>
                
                {formImage ? (
                  <div style={{ position: 'relative', width: '100%', height: 160, borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0', background: '#f1f5f9' }}>
                    <img src={formImage} alt="Xem trước" style={{ width: '100%', height: '100%', objectFit: 'cover' }} referrerPolicy="no-referrer" />
                    <button 
                      type="button" 
                      onClick={() => setFormImage('')}
                      style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(15,23,42,0.8)', border: 'none', color: '#fff', borderRadius: 9999, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : isCompressing ? (
                  <div 
                    style={{ width: '100%', height: 120, border: '2px dashed #db1557', borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#fff0f5' }}
                  >
                    <div className="animate-spin" style={{ width: 24, height: 24, border: '3px solid #fbcfe8', borderTopColor: '#db1557', borderRadius: '50%', marginBottom: 12 }}></div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#db1557' }}>Đang nén & tối ưu dung lượng ảnh...</span>
                  </div>
                ) : (
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    style={{ width: '100%', height: 120, border: '2px dashed #cbd5e1', borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', cursor: 'pointer', transition: 'border 0.2s' }}
                  >
                    <Upload size={24} style={{ color: '#64748b', marginBottom: 6 }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>Chọn từ thiết bị của bạn</span>
                    <span style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Tối đa 12MB (PNG, JPG)</span>
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleFileChange} 
                      accept="image/*" 
                      style={{ display: 'none' }} 
                    />
                  </div>
                )}
                
                {uploadError && (
                  <p style={{ margin: '4px 0 0', fontSize: 11, color: '#ef4444', fontWeight: 600 }}>{uploadError}</p>
                )}
              </div>

              <div style={{ marginBottom: 18 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Ghi chú tiến độ / Cảm nhận</label>
                <textarea 
                  placeholder="Hôm nay vòng eo cảm giác thon gọn hơn..."
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  style={{ width: '100%', height: 60, padding: '8px 10px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 12, fontFamily: 'inherit', color: '#334155' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, background: '#f8fafc', padding: 10, borderRadius: 10 }}>
                <input 
                  type="checkbox" 
                  id="form-is-private" 
                  checked={formIsPrivate} 
                  onChange={(e) => setFormIsPrivate(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                <label htmlFor="form-is-private" style={{ fontSize: 12, fontWeight: 600, color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Lock size={12} style={{ color: '#64748b' }} /> Riêng tư (Chỉ bạn và huấn luyện viên PT nhìn thấy)
                </label>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  style={{ flex: 1, height: 40, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', borderRadius: 12, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={isCompressing || isUploading}
                  style={{ flex: 1, height: 40, border: 'none', background: (isCompressing || isUploading) ? '#cbd5e1' : '#db1557', color: (isCompressing || isUploading) ? '#94a3b8' : '#fff', borderRadius: 12, fontWeight: 800, fontSize: 13, cursor: (isCompressing || isUploading) ? 'not-allowed' : 'pointer' }}
                >
                  {isCompressing ? 'Đang tối ưu ảnh...' : isUploading ? 'Đang tải lên...' : 'Lưu hình ảnh'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Modal: POSE GUIDE */}
      {isPoseGuideOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15,23,42,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#ffffff', width: '100%', maxWidth: 440, borderRadius: 24, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Info size={18} style={{ color: '#db1557' }} />
                <h3 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', margin: 0 }}>Cách chụp ảnh tiến độ chuẩn</h3>
              </div>
              <button onClick={() => setIsPoseGuideOpen(false)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4 }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: 24, fontSize: 13, color: '#334155', lineHeight: 1.6 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 9999, background: '#fff0f5', color: '#db1557', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>1</div>
                  <div>
                    <strong style={{ display: 'block', color: '#0f172a' }}>Cố định góc chụp & ánh sáng</strong>
                    <span>Chụp tại cùng một vị trí, cùng thời điểm trong ngày (tốt nhất là buổi sáng sau khi ngủ dậy).</span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 9999, background: '#fff0f5', color: '#db1557', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>2</div>
                  <div>
                    <strong style={{ display: 'block', color: '#0f172a' }}>Đặt máy ngang tầm ngực</strong>
                    <span>Đặt điện thoại thẳng đứng ở độ cao ngang ngực hoặc eo, cách khoảng 2-3 mét.</span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 9999, background: '#fff0f5', color: '#db1557', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>3</div>
                  <div>
                    <strong style={{ display: 'block', color: '#0f172a' }}>Giữ tư thế tự nhiên</strong>
                    <span>Đứng thả lỏng chân rộng bằng vai, không hóp bụng quá mức hay gồng cơ sai tư thế.</span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 9999, background: '#fff0f5', color: '#db1557', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>4</div>
                  <div>
                    <strong style={{ display: 'block', color: '#0f172a' }}>Trang phục đồng bộ</strong>
                    <span>Sử dụng trang phục tập luyện ôm sát cơ thể để dễ dàng nhìn thấy tỉ lệ thay đổi.</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsPoseGuideOpen(false)}
                style={{ width: '100%', height: 38, marginTop: 20, background: '#f1f5f9', border: 'none', color: '#334155', borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}
              >
                Đã hiểu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Modal: GALLERY */}
      {isGalleryModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15,23,42,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#ffffff', width: '100%', maxWidth: 700, borderRadius: 24, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '85vh' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ImageIcon size={20} style={{ color: '#db1557' }} />
                <h3 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', margin: 0 }}>Tất cả ảnh tiến độ ({photos.length})</h3>
              </div>
              <button onClick={() => setIsGalleryModalOpen(false)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4 }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
              {photos.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0' }}>
                  <ImageIcon size={48} style={{ color: '#cbd5e1', marginBottom: 12 }} />
                  <p style={{ fontSize: 14, color: '#64748b' }}>Thư viện của bạn đang trống.</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }}>
                  {photos.map((photo) => (
                    <div 
                      key={photo.id} 
                      style={{ 
                        border: '1px solid #e2e8f0', 
                        borderRadius: 16, 
                        overflow: 'hidden', 
                        background: '#fff',
                        position: 'relative',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                      }}
                    >
                      <span style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(15,23,42,0.75)', color: '#fff', fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 4, zIndex: 10 }}>
                        {photo.angle === 'front' ? 'Chính diện' : photo.angle === 'side' ? 'Nghiêng' : 'Sau lưng'}
                      </span>

                      <button 
                        type="button"
                        onClick={(e) => handleDeletePhoto(photo.id, e)}
                        style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(239,68,68,0.9)', border: 'none', color: '#fff', padding: 4, borderRadius: 6, cursor: 'pointer', zIndex: 10 }}
                        title="Xóa ảnh"
                      >
                        <Trash2 size={12} />
                      </button>

                      <div style={{ height: 160, background: '#cbd5e1', position: 'relative' }}>
                        <img 
                          src={photo.imageUrl} 
                          alt="" 
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                          referrerPolicy="no-referrer"
                        />
                      </div>

                      <div style={{ padding: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>
                            {photo.date.split('-').reverse().join('/')}
                          </span>
                          {photo.weightKg && (
                            <span style={{ fontSize: 11, fontWeight: 800, color: '#0f172a' }}>
                              {photo.weightKg} kg
                            </span>
                          )}
                        </div>
                        {photo.notes && (
                          <p style={{ margin: 0, fontSize: 10, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={photo.notes}>
                            {photo.notes}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ padding: '16px 24px', borderTop: '1px solid #f1f5f9', background: '#f8fafc', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
              <button 
                onClick={() => setIsGalleryModalOpen(false)} 
                style={{ height: 36, padding: '0 16px', background: '#db1557', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
              >
                Đóng thư viện
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
