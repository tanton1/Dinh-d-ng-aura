import React, { useState, useEffect, useMemo, useRef } from 'react'
import { 
  Camera, 
  ChevronRight, 
  Image as ImageIcon, 
  Lock, 
  ShieldCheck, 
  Sparkles, 
  Upload, 
  Trash2, 
  Eye, 
  EyeOff, 
  HelpCircle, 
  X, 
  Calendar, 
  Info, 
  Plus, 
  TrendingDown, 
  Scale, 
  Sliders, 
  Check, 
  LockKeyhole,
  LockKeyholeOpen,
  ArrowRight
} from 'lucide-react'
import { saveUserProgressPhoto, deleteUserProgressPhoto, subscribeToUserProgressPhotos } from '../../services/firebaseService'

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
}

const defaultPhotos: ProgressPhoto[] = []

const presets: { name: string; url: string }[] = []

// Reusable canvas-based image compression to avoid Firestore document 1MB limit issues
const compressImage = (base64Str: string, maxWidth = 1000, maxHeight = 1000, quality = 0.75): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.src = base64Str
    img.onload = () => {
      const canvas = document.createElement('canvas')
      let width = img.width
      let height = img.height

      // Scale proportionally while keeping under maxWidth/maxHeight
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
      // Export as a high quality JPEG
      const compressed = canvas.toDataURL('image/jpeg', quality)
      resolve(compressed)
    }
    img.onerror = (err) => {
      reject(err)
    }
  })
}

export function ProgressPhotosCard({ ownerId, triggerAddPhoto, onAddPhotoTriggered }: ProgressPhotosCardProps) {
  const [photos, setPhotos] = useState<ProgressPhoto[]>([])
  const [activeAngle, setActiveAngle] = useState<'front' | 'side' | 'back'>('front')
  const [isPrivate, setIsPrivate] = useState(true)
  
  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isGalleryModalOpen, setIsGalleryModalOpen] = useState(false)
  const [isPoseGuideOpen, setIsPoseGuideOpen] = useState(false)

  // Trigger opening add modal from outside
  useEffect(() => {
    if (triggerAddPhoto) {
      setFormAngle(activeAngle)
      setIsAddModalOpen(true)
      onAddPhotoTriggered?.()
    }
  }, [triggerAddPhoto, activeAngle, onAddPhotoTriggered])

  // Add form state
  const [formDate, setFormDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [formAngle, setFormAngle] = useState<'front' | 'side' | 'back'>('front')
  const [formWeight, setFormWeight] = useState<string>('60')
  const [formNotes, setFormNotes] = useState<string>('')
  const [formImage, setFormImage] = useState<string>('')
  const [formIsPrivate, setFormIsPrivate] = useState(true)
  const [uploadError, setUploadError] = useState<string>('')
  const [isCompressing, setIsCompressing] = useState(false)

  // Custom Comparison Override selectors
  const [customBeforeId, setCustomBeforeId] = useState<string | null>(null)
  const [customAfterId, setCustomAfterId] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // 1. Subscribe to Firebase progress photos / Load local storage
  useEffect(() => {
    // Load local storage first
    const cached = localStorage.getItem(`aura:progress-photos:${ownerId}`)
    if (cached) {
      try {
        setPhotos(JSON.parse(cached))
      } catch (e) {
        console.error('Error parsing cached photos:', e)
      }
    } else if (ownerId === 'demo') {
      setPhotos(defaultPhotos)
      localStorage.setItem(`aura:progress-photos:${ownerId}`, JSON.stringify(defaultPhotos))
    }

    if (ownerId === 'demo') return

    // Firebase live synchronization
    const unsubscribe = subscribeToUserProgressPhotos(ownerId, (remotePhotos) => {
      if (remotePhotos && remotePhotos.length > 0) {
        const sorted = [...remotePhotos].sort((a, b) => b.date.localeCompare(a.date))
        setPhotos(sorted)
        localStorage.setItem(`aura:progress-photos:${ownerId}`, JSON.stringify(sorted))
      } else {
        const cachedEmpty = localStorage.getItem(`aura:progress-photos:${ownerId}`)
        if (!cachedEmpty) {
          setPhotos(defaultPhotos)
          localStorage.setItem(`aura:progress-photos:${ownerId}`, JSON.stringify(defaultPhotos))
        }
      }
    }, (err) => {
      console.error('Firestore progress photos load error:', err)
    })

    return () => unsubscribe()
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
    if (anglePhotos.length <= 1) return null
    if (customAfterId) {
      const match = anglePhotos.find(p => p.id === customAfterId)
      if (match) return match
    }
    return anglePhotos[anglePhotos.length - 1] // Default is newest
  }, [anglePhotos, customAfterId])

  // Calculate delta weight between chosen Before & After
  const weightDelta = useMemo(() => {
    if (!beforePhoto || !afterPhoto || !beforePhoto.weightKg || !afterPhoto.weightKg) return null
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

    const newPhoto: ProgressPhoto = {
      id: `photo-${Date.now()}`,
      date: formDate,
      angle: formAngle,
      weightKg: formWeight ? parseFloat(formWeight) : undefined,
      notes: formNotes || undefined,
      imageUrl: formImage,
      isPrivate: formIsPrivate,
      createdAt: new Date().toISOString()
    }

    const updated = [newPhoto, ...photos]
    setPhotos(updated)
    localStorage.setItem(`aura:progress-photos:${ownerId}`, JSON.stringify(updated))

    // Save to Firestore if not in demo mode
    if (ownerId !== 'demo') {
      try {
        await saveUserProgressPhoto(ownerId, newPhoto as any)
      } catch (err) {
        console.error('Error saving progress photo to Firebase:', err)
      }
    }

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

    // Reset custom comparisons if deleted
    if (customBeforeId === id) setCustomBeforeId(null)
    if (customAfterId === id) setCustomAfterId(null)

    if (ownerId !== 'demo') {
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

    // Allow up to 12MB input but warn and compress down
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
          // Compress immediately using the canvas compressor
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
    <div className="pg-card" id="progress-photos-section">
      {/* Header section */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: '#0f172a', margin: 0 }}>Nhật ký vóc dáng</h2>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 9999, background: '#f1f5f9', color: '#64748b', fontSize: 11, fontWeight: 700 }}>
              <Lock size={12} /> Bảo mật riêng tư
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
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            padding: '4px 8px',
            borderRadius: 8,
            transition: 'background 0.2s',
          }}
          className="hover-bg-pink"
        >
          <span>Bộ sưu tập ({photos.length})</span>
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Angle Selector Tabs - Compact Segmented Control */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'inline-flex', background: '#f1f5f9', padding: 3, borderRadius: 10, border: '1px solid #e2e8f0' }}>
          {[
            { id: 'front', label: 'Chính diện' },
            { id: 'side', label: 'Nghiêng' },
            { id: 'back', label: 'Sau lưng' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveAngle(tab.id as any)
                setCustomBeforeId(null)
                setCustomAfterId(null)
              }}
              style={{
                padding: '5px 12px',
                borderRadius: 7,
                border: 'none',
                background: activeAngle === tab.id ? '#ffffff' : 'transparent',
                color: activeAngle === tab.id ? '#db1557' : '#475569',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: activeAngle === tab.id ? '0 1px 3px rgba(0,0,0,0.06)' : 'none'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setIsPoseGuideOpen(true)}
          style={{
            background: 'none',
            border: 'none',
            color: '#64748b',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            cursor: 'pointer',
            fontWeight: 600
          }}
        >
          <HelpCircle size={14} />
          <span>Cách chụp chuẩn</span>
        </button>
      </div>

      {/* Manual Selection Overlay (Only shown if user has more than 2 photos for this angle) */}
      {anglePhotos.length > 2 && (
        <div style={{ background: '#f8fafc', padding: '8px 12px', borderRadius: 12, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, border: '1px solid #f1f5f9' }}>
          <Sliders size={14} style={{ color: '#db1557' }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>Chọn ảnh đối chiếu:</span>
          
          <div style={{ display: 'flex', gap: 6, flex: 1, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>Trước:</span>
              <select
                value={beforePhoto?.id || ''}
                onChange={(e) => setCustomBeforeId(e.target.value)}
                style={{ fontSize: 12, padding: '2px 6px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontWeight: 600 }}
              >
                {anglePhotos.map(p => (
                  <option key={p.id} value={p.id}>{p.date.split('-').reverse().join('/')} ({p.weightKg || '??'} kg)</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>Sau:</span>
              <select
                value={afterPhoto?.id || ''}
                onChange={(e) => setCustomAfterId(e.target.value)}
                style={{ fontSize: 12, padding: '2px 6px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontWeight: 600 }}
              >
                {anglePhotos.map(p => (
                  <option key={p.id} value={p.id} disabled={p.id === beforePhoto?.id}>{p.date.split('-').reverse().join('/')} ({p.weightKg || '??'} kg)</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Before / After Comparison Showcase */}
      {anglePhotos.length === 0 ? (
        <div style={{ background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 20, padding: '40px 20px', textAlign: 'center', marginBottom: 16 }}>
          <ImageIcon size={44} style={{ color: '#94a3b8', marginBottom: 12 }} />
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#334155', margin: '0 0 4px' }}>Chưa có ảnh góc này</h3>
          <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 16px', maxWidth: 300, marginLeft: 'auto', marginRight: 'auto' }}>
            Hãy đăng tải bức ảnh đầu tiên cho góc {activeAngle === 'front' ? 'Chính diện' : activeAngle === 'side' ? 'Nghiêng' : 'Sau lưng'} để bắt đầu hành trình.
          </p>
          <button
            type="button"
            onClick={() => {
              setFormAngle(activeAngle)
              setIsAddModalOpen(true)
            }}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              background: '#db1557',
              color: '#fff',
              border: 'none',
              fontWeight: 700,
              fontSize: 12,
              cursor: 'pointer'
            }}
          >
            Thêm ảnh đầu tiên
          </button>
        </div>
      ) : (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {/* Before Column */}
            <div style={{ background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 20, padding: 10, textAlign: 'center', position: 'relative' }}>
              <span style={{ position: 'absolute', top: 16, left: 16, padding: '4px 10px', borderRadius: 6, background: 'rgba(15,23,42,0.85)', color: '#ffffff', fontSize: 11, fontWeight: 800, zIndex: 10 }}>
                Mốc đầu · {beforePhoto ? beforePhoto.date.split('-').reverse().join('/') : '---'}
              </span>
              
              <div style={{ width: '100%', height: 260, borderRadius: 14, overflow: 'hidden', position: 'relative', background: '#cbd5e1' }}>
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
                    <span style={{ fontSize: 12, marginTop: 4 }}>Chưa có ảnh</span>
                  </div>
                )}
              </div>

              {beforePhoto && (
                <div style={{ marginTop: 10, textAlign: 'left', padding: '0 4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: 14, color: '#0f172a' }}>{beforePhoto.weightKg ? `${beforePhoto.weightKg} kg` : 'Chưa nhập'}</strong>
                    <button 
                      type="button" 
                      onClick={(e) => handleDeletePhoto(beforePhoto.id, e)}
                      style={{ background: 'none', border: 'none', color: '#ef4444', padding: 4, cursor: 'pointer' }}
                      title="Xóa ảnh"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {beforePhoto.notes && (
                    <p style={{ margin: '4px 0 0', fontSize: 11, color: '#64748b', lineBreak: 'anywhere', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} title={beforePhoto.notes}>
                      {beforePhoto.notes}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* After/Current Column */}
            <div style={{ background: '#fff0f5', border: '1px solid #fce7f3', borderRadius: 20, padding: 10, textAlign: 'center', position: 'relative' }}>
              <span style={{ position: 'absolute', top: 16, left: 16, padding: '4px 10px', borderRadius: 6, background: '#db1557', color: '#ffffff', fontSize: 11, fontWeight: 800, zIndex: 10 }}>
                Mốc mới · {afterPhoto ? afterPhoto.date.split('-').reverse().join('/') : (beforePhoto ? beforePhoto.date.split('-').reverse().join('/') : '---')}
              </span>
              
              <div style={{ width: '100%', height: 260, borderRadius: 14, overflow: 'hidden', position: 'relative', background: '#fbcfe8' }}>
                {afterPhoto ? (
                  <img 
                    src={afterPhoto.imageUrl} 
                    alt="Sau" 
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                    referrerPolicy="no-referrer"
                  />
                ) : beforePhoto ? (
                  <img 
                    src={beforePhoto.imageUrl} 
                    alt="Chưa có ảnh so sánh" 
                    style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.6 }} 
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#db1557' }}>
                    <ImageIcon size={32} />
                    <span style={{ fontSize: 12, marginTop: 4 }}>Chưa có ảnh</span>
                  </div>
                )}

                {/* Overlay Delta highlight */}
                {weightDelta && (
                  <div style={{ position: 'absolute', bottom: 10, right: 10, background: 'rgba(219,21,87,0.95)', color: '#fff', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 3 }}>
                    <TrendingDown size={12} />
                    <span>Giảm {Math.abs(weightDelta.diff).toFixed(1)} kg</span>
                  </div>
                )}
              </div>

              {afterPhoto ? (
                <div style={{ marginTop: 10, textAlign: 'left', padding: '0 4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: 14, color: '#db1557' }}>{afterPhoto.weightKg ? `${afterPhoto.weightKg} kg` : 'Chưa nhập'}</strong>
                    <button 
                      type="button" 
                      onClick={(e) => handleDeletePhoto(afterPhoto.id, e)}
                      style={{ background: 'none', border: 'none', color: '#ef4444', padding: 4, cursor: 'pointer' }}
                      title="Xóa ảnh"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {afterPhoto.notes && (
                    <p style={{ margin: '4px 0 0', fontSize: 11, color: '#db1557', lineBreak: 'anywhere', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} title={afterPhoto.notes}>
                      {afterPhoto.notes}
                    </p>
                  )}
                </div>
              ) : beforePhoto ? (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 46 }}>
                  <p style={{ margin: 0, fontSize: 11, color: '#64748b', fontWeight: 600 }}>Cần thêm ít nhất 1 ảnh nữa</p>
                  <button 
                    type="button"
                    onClick={() => {
                      setFormAngle(activeAngle)
                      setIsAddModalOpen(true)
                    }}
                    style={{ background: 'none', border: 'none', color: '#db1557', fontSize: 11, fontWeight: 700, padding: '2px 8px', cursor: 'pointer' }}
                  >
                    Đăng ngay bây giờ!
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Upload Action buttons */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          type="button"
          onClick={() => {
            setFormAngle(activeAngle)
            setIsAddModalOpen(true)
          }}
          style={{
            flex: 1,
            height: 42,
            borderRadius: 14,
            border: 'none',
            background: 'linear-gradient(110deg, #f72567 0%, #ff7a38 100%)',
            color: '#ffffff',
            fontWeight: 800,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(247,37,103,0.2)'
          }}
        >
          <Camera size={16} />
          <span>Thêm ảnh tiến độ mới</span>
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
              {/* Form grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Ngày ghi nhận</label>
                  <div style={{ position: 'relative' }}>
                    <input 
                      type="date" 
                      value={formDate}
                      onChange={(e) => setFormDate(e.target.value)}
                      required
                      style={{ width: '100%', height: 38, padding: '0 10px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 13, fontWeight: 600, color: '#334155' }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Cân nặng (kg)</label>
                  <input 
                    type="number" 
                    step="0.1"
                    placeholder="VD: 62.5"
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
                    <span style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>Để đảm bảo lưu trữ nhanh chóng</span>
                  </div>
                ) : (
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    style={{ width: '100%', height: 120, border: '2px dashed #cbd5e1', borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', cursor: 'pointer', transition: 'border 0.2s' }}
                    className="hover-border-pink"
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

              {/* Preset images section removed */}

              <div style={{ marginBottom: 18 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Ghi chú tiến độ / Cảm nhận</label>
                <textarea 
                  placeholder="Hôm nay vòng eo cảm giác thon gọn hơn, cơ đùi săn chắc..."
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  style={{ width: '100%', height: 60, padding: '8px 10px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 12, fontFamily: 'inherit', color: '#334155' }}
                />
              </div>

              {/* Security privacy checkbox */}
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

              {/* Submit / Cancel buttons */}
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
                  disabled={isCompressing}
                  style={{ flex: 1, height: 40, border: 'none', background: isCompressing ? '#cbd5e1' : '#db1557', color: isCompressing ? '#94a3b8' : '#fff', borderRadius: 12, fontWeight: 800, fontSize: 13, cursor: isCompressing ? 'not-allowed' : 'pointer' }}
                >
                  {isCompressing ? 'Đang tối ưu ảnh...' : 'Lưu hình ảnh'}
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
                    <span>Chụp tại cùng một vị trí, cùng thời điểm trong ngày (tốt nhất là buổi sáng sau khi ngủ dậy) để có ánh sáng nhất quán.</span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 9999, background: '#fff0f5', color: '#db1557', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>2</div>
                  <div>
                    <strong style={{ display: 'block', color: '#0f172a' }}>Đặt máy ngang tầm ngực</strong>
                    <span>Đặt điện thoại thẳng đứng ở độ cao ngang ngực hoặc eo, cách khoảng 2-3 mét để tránh bị biến dạng phối cảnh.</span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 9999, background: '#fff0f5', color: '#db1557', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>3</div>
                  <div>
                    <strong style={{ display: 'block', color: '#0f172a' }}>Giữ tư thế tự nhiên</strong>
                    <span>Đứng thả lỏng chân rộng bằng vai, không hóp bụng quá mức hay gồng cơ sai tư thế để đảm bảo tính đối chiếu chính xác nhất.</span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 9999, background: '#fff0f5', color: '#db1557', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>4</div>
                  <div>
                    <strong style={{ display: 'block', color: '#0f172a' }}>Trang phục đồng bộ</strong>
                    <span>Sử dụng trang phục tập luyện ôm sát cơ thể hoặc giống nhau qua các lần chụp để dễ dàng nhìn thấy tỉ lệ thay đổi của các nhóm cơ.</span>
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
            {/* Gallery Header */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ImageIcon size={20} style={{ color: '#db1557' }} />
                <h3 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', margin: 0 }}>Tất cả ảnh tiến độ ({photos.length})</h3>
              </div>
              <button onClick={() => setIsGalleryModalOpen(false)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4 }}>
                <X size={20} />
              </button>
            </div>

            {/* Gallery Content */}
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
                      {/* Badge angle */}
                      <span style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(15,23,42,0.75)', color: '#fff', fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 4, zIndex: 10 }}>
                        {photo.angle === 'front' ? 'Chính diện' : photo.angle === 'side' ? 'Nghiêng' : 'Sau lưng'}
                      </span>

                      {/* Delete absolute button */}
                      <button 
                        type="button"
                        onClick={(e) => handleDeletePhoto(photo.id, e)}
                        style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(239,68,68,0.9)', border: 'none', color: '#fff', padding: 4, borderRadius: 6, cursor: 'pointer', zIndex: 10 }}
                        title="Xóa ảnh"
                      >
                        <Trash2 size={12} />
                      </button>

                      {/* Image wrapper */}
                      <div style={{ height: 160, background: '#cbd5e1', position: 'relative' }}>
                        <img 
                          src={photo.imageUrl} 
                          alt="" 
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                          referrerPolicy="no-referrer"
                        />
                      </div>

                      {/* Details info */}
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

            {/* Gallery Footer */}
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
