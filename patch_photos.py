import re

with open('src/components/progress/ProgressPhotosCard.tsx', 'r') as f:
    content = f.read()

# Replace the return statement.
start_idx = content.find('  return (')
end_idx = content.rfind('  )\n}')

if start_idx == -1 or end_idx == -1:
    print("Could not find return statement")
else:
    new_return = '''  return (
    <div id="progress-photos-section" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* 1. Angle Selector Tabs Bar & Guide Button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ display: 'flex', flex: 1, background: '#ffffff', padding: '6px', borderRadius: '16px', border: '1px solid #f1f5f9', boxShadow: '0 2px 8px rgba(0,0,0,0.02)', gap: '4px' }}>
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
                <span style={{ fontSize: '18px', color: active ? '#ff1a8c' : '#94a3b8' }}>{tab.icon}</span>
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
            gap: '6px',
            cursor: 'pointer',
            fontWeight: 700,
            boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
            height: '100%',
            flexShrink: 0,
            width: '85px'
          }}
        >
          <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <HelpCircle size={16} style={{ color: '#64748b' }} />
          </div>
          <span style={{ textAlign: 'center', lineHeight: '1.2' }}>Cách chụp<br/>chuẩn</span>
        </button>
      </div>

      {/* 2. Side-by-Side Comparison Showcase */}
      {anglePhotos.length === 0 ? (
        <div style={{ background: '#ffffff', border: '1px solid #f1f5f9', borderRadius: '24px', padding: '40px 20px', textAlign: 'center', marginBottom: 16, boxShadow: '0 4px 15px rgba(0,0,0,0.02)' }}>
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
        <div style={{ background: '#ffffff', border: '1px solid #f1f5f9', borderRadius: '24px', padding: '20px', boxShadow: '0 4px 15px rgba(0,0,0,0.03)' }}>
          {/* Comparison Selector Box */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
             {/* Trước Selection */}
             <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ff1a8c', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase' }}>
                  <Calendar size={13} /> Trước
                </div>
                <select
                  value={beforePhoto?.id || ''}
                  onChange={(e) => handleSetCustomBeforeId(e.target.value)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#0f172a',
                    fontSize: '18px',
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
                <div style={{ fontSize: '14px', color: '#64748b', fontWeight: 600 }}>{beforePhoto?.weightKg ? `${beforePhoto.weightKg} kg` : '-- kg'}</div>
             </div>

             <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#fff0f5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff1a8c', flexShrink: 0 }}>
               <ChevronRight size={16} />
             </div>

             {/* Sau Selection */}
             <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end', textAlign: 'right' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ff1a8c', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase' }}>
                  <Calendar size={13} /> Sau
                </div>
                <select
                  value={afterPhoto?.id || ''}
                  onChange={(e) => handleSetCustomAfterId(e.target.value)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#0f172a',
                    fontSize: '18px',
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
                <div style={{ fontSize: '14px', color: '#ff1a8c', fontWeight: 700 }}>{afterPhoto?.weightKg ? `${afterPhoto.weightKg} kg` : '-- kg'}</div>
             </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* Left Card: Before (Mốc đầu) */}
            <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
              <div style={{ width: '100%', aspectRatio: '3/4', borderRadius: '16px', overflow: 'hidden', position: 'relative', background: '#f8fafc', marginBottom: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                <span style={{ position: 'absolute', top: 12, left: 12, padding: '6px 12px', borderRadius: '8px', background: 'rgba(30, 41, 59, 0.7)', color: '#ffffff', fontSize: '12px', fontWeight: 700, zIndex: 10, backdropFilter: 'blur(4px)' }}>
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
                    onClick={() => {
                      if (window.confirm('Xóa bức ảnh "Trước" này?')) {
                        deleteUserProgressPhoto(ownerId, beforePhoto.id)
                      }
                    }}
                    style={{ position: 'absolute', bottom: 12, right: 12, width: 36, height: 36, borderRadius: '50%', background: '#ffffff', border: '1px solid #f1f5f9', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
              <div style={{ fontSize: '24px', fontWeight: 900, color: '#0f172a', marginBottom: '6px' }}>
                {beforePhoto?.weightKg ? beforePhoto.weightKg : '--'} <span style={{ fontSize: '15px', fontWeight: 700 }}>kg</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8', fontSize: '13px', fontWeight: 600 }}>
                <Calendar size={14} /> {beforePhoto ? beforePhoto.date.split('-').reverse().join('/') : '--/--/----'}
              </div>
            </div>

            {/* Right Card: After (Hiện tại) */}
            <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
              <div style={{ width: '100%', aspectRatio: '3/4', borderRadius: '16px', overflow: 'hidden', position: 'relative', background: '#f8fafc', marginBottom: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                <span style={{ position: 'absolute', top: 12, left: 12, padding: '6px 12px', borderRadius: '8px', background: '#ff1a8c', color: '#ffffff', fontSize: '12px', fontWeight: 700, zIndex: 10, boxShadow: '0 2px 6px rgba(255,26,140,0.3)' }}>
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
                  <span style={{ position: 'absolute', bottom: 12, left: 12, padding: '6px 12px', borderRadius: '8px', background: '#ff1a8c', color: '#ffffff', fontSize: '12px', fontWeight: 800, zIndex: 10, display: 'flex', alignItems: 'center', gap: '4px', boxShadow: '0 2px 6px rgba(255,26,140,0.3)' }}>
                    <TrendingUp size={14} /> 
                    {afterPhoto.weightKg > beforePhoto.weightKg 
                      ? `Tăng ${(afterPhoto.weightKg - beforePhoto.weightKg).toFixed(1)} kg`
                      : afterPhoto.weightKg < beforePhoto.weightKg
                      ? `Giảm ${(beforePhoto.weightKg - afterPhoto.weightKg).toFixed(1)} kg`
                      : 'Không đổi'}
                  </span>
                )}

                {afterPhoto && (
                  <button 
                    onClick={() => {
                      if (window.confirm('Xóa bức ảnh "Sau" này?')) {
                        deleteUserProgressPhoto(ownerId, afterPhoto.id)
                      }
                    }}
                    style={{ position: 'absolute', bottom: 12, right: 12, width: 36, height: 36, borderRadius: '50%', background: '#ffffff', border: '1px solid #f1f5f9', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
              <div style={{ fontSize: '24px', fontWeight: 900, color: '#ff1a8c', marginBottom: '6px' }}>
                {afterPhoto?.weightKg ? afterPhoto.weightKg : '--'} <span style={{ fontSize: '15px', fontWeight: 700 }}>kg</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8', fontSize: '13px', fontWeight: 600 }}>
                <Calendar size={14} /> {afterPhoto ? afterPhoto.date.split('-').reverse().join('/') : '--/--/----'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Bottom Status Card */}
      <div style={{ display: 'flex', flexDirection: 'column', background: 'linear-gradient(135deg, #fff0f5 0%, #ffffff 100%)', border: '1px solid rgba(255, 26, 140, 0.1)', borderRadius: '24px', padding: '24px', position: 'relative', overflow: 'hidden', boxShadow: '0 4px 15px rgba(255, 26, 140, 0.05)' }}>
         <div style={{ position: 'absolute', right: 0, bottom: 0, opacity: 0.3, pointerEvents: 'none' }}>
           <svg width="200" height="100" viewBox="0 0 200 100" fill="none" xmlns="http://www.w3.org/2000/svg">
             <path d="M0 100L40 80L80 90L120 50L160 60L200 20V100H0Z" fill="url(#paint0_linear)"/>
             <path d="M0 100L40 80L80 90L120 50L160 60L200 20" stroke="#ff1a8c" strokeWidth="2"/>
             <circle cx="200" cy="20" r="4" fill="#ff1a8c"/>
             <defs>
               <linearGradient id="paint0_linear" x1="100" y1="20" x2="100" y2="100" gradientUnits="userSpaceOnUse">
                 <stop stopColor="#ff1a8c" stopOpacity="0.2"/>
                 <stop offset="1" stopColor="#ff1a8c" stopOpacity="0"/>
               </linearGradient>
             </defs>
           </svg>
         </div>

         <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px', position: 'relative', zIndex: 1 }}>
           <div style={{ width: '48px', height: '48px', borderRadius: '16px', background: '#ffe4f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff1a8c' }}>
             <TrendingUp size={24} />
           </div>
           <div>
             <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: '0 0 4px' }}>Bạn đang đi đúng hướng!</h3>
             <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>Tiếp tục duy trì thói quen tuyệt vời này nhé.</p>
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
              padding: '12px 24px',
              borderRadius: '9999px',
              background: 'linear-gradient(135deg, #ff1a8c 0%, #ff7b54 100%)',
              color: '#fff',
              border: 'none',
              fontWeight: 800,
              fontSize: '14px',
              cursor: 'pointer',
              boxShadow: '0 4px 15px rgba(255, 26, 140, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              position: 'relative',
              zIndex: 1,
              alignSelf: 'flex-start'
            }}
          >
            <Plus size={18} /> Ghi nhanh
          </button>
      </div>

      {/* Legacy Modals */}
'''
    new_content = content[:start_idx] + new_return + content[end_idx-1:]
    with open('src/components/progress/ProgressPhotosCard.tsx', 'w') as f:
        f.write(new_content)
