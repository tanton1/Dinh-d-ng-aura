import React, { useState, useRef } from "react"
import { useForm, FormProvider, Controller, useFieldArray, useFormContext } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Camera, X, Check, Lightbulb, ImageIcon, Upload, AlertTriangle, CheckCircle2, Plus, Trash2, ArrowLeft, ArrowRight, LoaderCircle, Lock, Users, Bot } from "lucide-react"
import { saveUserProgressPhoto, uploadUserProgressPhoto } from "../../services/firebaseService"
import { useMutation, QueryClient, QueryClientProvider } from "@tanstack/react-query"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 1,
    }
  }
})

export type StudioStep = 1 | 2 | 3
export type BodyAngle = "front" | "side" | "back"
export type PhotoPrivacy = "private" | "coach" | "ai_analysis"

const BODY_ANGLES: Array<{ value: BodyAngle; label: string; description: string; image: string }> = [
  { value: "front", label: "Chính diện", description: "Hai vai cân bằng, nhìn thẳng", image: "/images/body-angle-front.svg" },
  { value: "side", label: "Nghiêng", description: "Xoay người 90 độ", image: "/images/body-angle-side.svg" },
  { value: "back", label: "Sau lưng", description: "Giữ vai và hông cân bằng", image: "/images/body-angle-back.svg" },
]

const FEELING_OPTIONS = ["Eo gọn hơn", "Cơ thể săn chắc", "Ít đầy bụng", "Giữ nước", "Mệt", "Tự tin hơn"]

const PRIVACY_OPTIONS: Array<{ value: PhotoPrivacy; label: string; description: string }> = [
  { value: "private", label: "Chỉ mình tôi", description: "Chỉ bạn có thể xem ảnh này" },
  { value: "coach", label: "Tôi và Coach", description: "Coach của bạn có thể xem ảnh" },
  { value: "ai_analysis", label: "Cho phép AI phân tích", description: "Dùng để so sánh và phân tích tiến độ" },
]

const bodyMeasurementSchema = z.object({
  key: z.string(),
  label: z.string(),
  valueCm: z.any().optional(),
})

const qualityCheckSchema = z.object({
  key: z.string().optional(),
  label: z.string().optional(),
  status: z.string().optional(),
  message: z.string().optional(),
})

const progressPhotoSchema = z.object({
  angle: z.enum(["front", "side", "back"]).default("front"),
  imageFile: z.instanceof(File).optional(),
  imagePreviewUrl: z.string().optional(),
  recordedAt: z.string().default(() => new Date().toISOString().split("T")[0]),
  weightKg: z.any().optional(),
  measurements: z.array(bodyMeasurementSchema).default([]),
  feelings: z.array(z.string()).default([]),
  note: z.string().optional(),
  privacy: z.enum(["private", "coach", "ai_analysis"]).default("private"),
  qualityChecks: z.array(qualityCheckSchema).default([]),
})

type ProgressPhotoInput = z.infer<typeof progressPhotoSchema>

export function ProgressPhotoStudio({ onNavigate, ownerId }: { onNavigate: (path: any) => void, ownerId: string }) {
  const [step, setStep] = useState<StudioStep>(1)
  
  const form = useForm<ProgressPhotoInput>({
    resolver: zodResolver(progressPhotoSchema) as any,
    mode: "onChange",
    defaultValues: {
      angle: "front",
      recordedAt: new Date().toISOString().split("T")[0],
      weightKg: undefined,
      measurements: [],
      feelings: [],
      note: "",
      privacy: "private",
      qualityChecks: [],
    },
  })

  async function goNext() {
    if (step === 1) {
      const valid = await form.trigger("angle")
      if (valid) setStep(2)
      return
    }
    if (step === 2) {
      const imageFile = form.getValues("imageFile")
      if (!imageFile) {
        form.setError("imageFile", { message: "Vui lòng chụp hoặc chọn một ảnh" })
        return
      }
      setStep(3)
    }
  }

  function goBack() {
    setStep((current) => Math.max(1, current - 1) as StudioStep)
  }

  return (
    <QueryClientProvider client={queryClient}>
      <FormProvider {...form}>
        <main style={{ minHeight: '100dvh', background: '#fff9fa', fontFamily: 'inherit' }}>
          <div style={{ margin: '0 auto', minHeight: '100dvh', width: '100%', maxWidth: 440, background: '#ffffff', paddingBottom: 112, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <StudioHeader onBack={() => onNavigate('progress')} />
            <StudioStepper step={step} />
            <div style={{ padding: '24px 20px 32px' }}>
              {step === 1 && <AngleStep />}
              {step === 2 && <ImageStep />}
              {step === 3 && <InformationStep />}
            </div>
            <StudioActionBar step={step} onBack={goBack} onNext={goNext} ownerId={ownerId} onNavigate={onNavigate} />
          </div>
        </main>
      </FormProvider>
    </QueryClientProvider>
  )
}

function StudioHeader({ onBack }: { onBack: () => void }) {
  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 30, borderBottom: '1px solid #ffe4e6', background: 'rgba(255,255,255,0.9)', padding: 'max(20px, env(safe-area-inset-top)) 20px 20px', backdropFilter: 'blur(16px)' }}>
      <div style={{ margin: '0 auto 16px', height: 6, width: 48, borderRadius: 999, background: '#e2e8f0' }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ display: 'flex', width: 48, height: 48, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 16, background: 'linear-gradient(135deg, #fce7f3 0%, #ffedd5 100%)', color: '#db2777' }}>
          <Camera size={24} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.025em', color: '#020617', margin: 0 }}>Ảnh tiến độ mới</h1>
          <p style={{ marginTop: 4, fontSize: 14, lineHeight: 1.4, color: '#64748b', margin: '4px 0 0' }}>Ghi lại thay đổi theo cùng tiêu chuẩn mỗi lần chụp.</p>
        </div>
        <button type="button" onClick={onBack} style={{ display: 'flex', width: 40, height: 40, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 999, background: '#f1f5f9', color: '#475569', border: 'none', cursor: 'pointer' }}>
          <X size={20} />
        </button>
      </div>
    </header>
  )
}

function StudioStepper({ step }: { step: StudioStep }) {
  const steps = [{ number: 1, label: "Góc chụp" }, { number: 2, label: "Hình ảnh" }, { number: 3, label: "Thông tin" }]
  return (
    <div style={{ borderBottom: '1px solid #fff1f2', padding: '20px 24px' }}>
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ position: 'absolute', left: '12%', right: '12%', top: 16, height: 2, background: '#e2e8f0' }}>
          <div style={{ height: '100%', background: 'linear-gradient(to right, #ec4899 0%, #fb923c 100%)', transition: 'all 0.5s', width: step === 1 ? '0%' : step === 2 ? '50%' : '100%' }} />
        </div>
        {steps.map((item) => {
          const completed = item.number < step
          const active = item.number === step
          return (
            <div key={item.number} style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ display: 'flex', width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 999, fontSize: 14, fontWeight: 700, transition: 'all 0.2s', ...(completed || active ? { background: 'linear-gradient(to right, #ec4899 0%, #fb923c 100%)', color: '#fff' } : { background: '#e2e8f0', color: '#64748b' }) }}>
                {completed ? <Check size={16} /> : item.number}
              </div>
              <span style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: active ? '#db2777' : '#64748b' }}>{item.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AngleStep() {
  const { watch, setValue } = useFormContext<ProgressPhotoInput>()
  const selectedAngle = watch("angle")
  return (
    <section>
      <h2 style={{ fontSize: 20, fontWeight: 900, color: '#020617', margin: 0 }}>Bạn muốn chụp góc nào?</h2>
      <p style={{ marginTop: 8, fontSize: 14, color: '#64748b', margin: '8px 0 0' }}>Chọn đúng góc để ảnh có thể so sánh với những lần trước.</p>
      <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {BODY_ANGLES.map((angle) => (
          <AngleCard key={angle.value} option={angle} selected={selectedAngle === angle.value} onSelect={() => setValue("angle", angle.value, { shouldDirty: true, shouldValidate: true })} />
        ))}
      </div>
      <div style={{ marginTop: 24, borderRadius: 24, border: '1px solid #ffedd5', background: 'linear-gradient(135deg, #fff7ed 0%, #fdf2f8 100%)', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ display: 'flex', width: 36, height: 36, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 12, background: '#fff', color: '#f97316' }}>
            <Lightbulb size={20} />
          </div>
          <div>
            <p style={{ fontWeight: 700, color: '#0f172a', margin: 0 }}>Mẹo để so sánh chính xác</p>
            <p style={{ marginTop: 4, fontSize: 14, lineHeight: 1.5, color: '#475569', margin: '4px 0 0' }}>Giữ cơ thể thẳng, camera ngang eo, ánh sáng từ phía trước và khoảng cách 2–2,5 mét.</p>
          </div>
        </div>
      </div>
    </section>
  )
}

function AngleCard({ option, selected, onSelect }: { option: any; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} style={{ position: 'relative', overflow: 'hidden', borderRadius: 24, padding: 12, transition: 'all 0.1s', cursor: 'pointer', outline: 'none', ...(selected ? { border: '1px solid #f472b6', background: 'linear-gradient(to bottom, #fdf2f8 0%, #fff7ed 100%)', boxShadow: '0 10px 15px -3px rgba(252,231,243,0.5)' } : { border: '1px solid #e2e8f0', background: '#fff', boxShadow: 'none' }) }}>
      {selected && <span style={{ position: 'absolute', right: 8, top: 8, display: 'flex', width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 999, background: '#ec4899', color: '#fff' }}><Check size={16} /></span>}
      <div style={{ position: 'relative', margin: '0 auto', aspectRatio: '2/3', width: '100%', maxWidth: 75, background: '#f1f5f9', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12 }}>
        Hình {option.label}
      </div>
      <p style={{ marginTop: 12, fontSize: 14, fontWeight: 700, margin: '12px 0 0', color: selected ? '#db2777' : '#1e293b' }}>{option.label}</p>
    </button>
  )
}

function ImageStep() {
  const { watch } = useFormContext<ProgressPhotoInput>()
  const previewUrl = watch("imagePreviewUrl")
  return (
    <section>
      <h2 style={{ fontSize: 20, fontWeight: 900, color: '#020617', margin: 0 }}>Chọn hình ảnh</h2>
      <p style={{ marginTop: 8, fontSize: 14, color: '#64748b', margin: '8px 0 0' }}>Chụp mới hoặc chọn một ảnh rõ toàn thân từ thư viện.</p>
      <div style={{ marginTop: 24 }}>
        {previewUrl ? <ImagePreview imageUrl={previewUrl} /> : <ImageUploadZone />}
      </div>
    </section>
  )
}

function ImageUploadZone() {
  const libraryInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const { setValue, setError, clearErrors, formState: { errors } } = useFormContext<ProgressPhotoInput>()

  function handleFile(file?: File) {
    if (!file) return
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("imageFile", { message: "Chỉ hỗ trợ JPG, PNG hoặc WEBP" })
      return
    }
    if (file.size > 12 * 1024 * 1024) {
      setError("imageFile", { message: "Ảnh không được vượt quá 12MB" })
      return
    }
    clearErrors("imageFile")
    const previewUrl = URL.createObjectURL(file)
    setValue("imageFile", file, { shouldDirty: true, shouldValidate: true })
    setValue("imagePreviewUrl", previewUrl, { shouldDirty: true })
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        <button type="button" onClick={() => cameraInputRef.current?.click()} style={{ display: 'flex', minHeight: 112, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: 24, border: '1px solid #f9a8d4', background: '#fdf2f8', color: '#db2777', cursor: 'pointer' }}>
          <Camera size={32} />
          <span style={{ marginTop: 12, fontSize: 14, fontWeight: 700 }}>Chụp ảnh mới</span>
        </button>
        <button type="button" onClick={() => libraryInputRef.current?.click()} style={{ display: 'flex', minHeight: 112, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: 24, border: '1px solid #e2e8f0', background: '#fff', color: '#334155', cursor: 'pointer' }}>
          <ImageIcon size={32} />
          <span style={{ marginTop: 12, fontSize: 14, fontWeight: 700 }}>Chọn từ thư viện</span>
        </button>
      </div>
      <div
        onDragEnter={(e) => { e.preventDefault(); setDragging(true) }}
        onDragOver={(e) => { e.preventDefault() }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]) }}
        style={{ marginTop: 16, display: 'flex', minHeight: 160, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: 24, border: dragging ? '2px dashed #ec4899' : '2px dashed #fbcfe8', background: dragging ? '#fdf2f8' : 'linear-gradient(135deg, #fff 0%, #fff1f2 100%)', textAlign: 'center', transition: 'all 0.2s' }}
      >
        <Upload size={36} color="#ec4899" />
        <p style={{ marginTop: 12, fontWeight: 700, color: '#0f172a', margin: '12px 0 0' }}>Hoặc kéo ảnh vào đây</p>
        <p style={{ marginTop: 4, fontSize: 14, color: '#64748b', margin: '4px 0 0' }}>JPG, PNG, WEBP · tối đa 12MB</p>
      </div>
      {errors.imageFile?.message && <p style={{ marginTop: 12, fontSize: 14, fontWeight: 600, color: '#ef4444', margin: '12px 0 0' }}>{errors.imageFile.message}</p>}
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => handleFile(e.target.files?.[0])} />
      <input ref={libraryInputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => handleFile(e.target.files?.[0])} />
    </div>
  )
}

function ImagePreview({ imageUrl }: { imageUrl: string }) {
  const { watch, setValue } = useFormContext<ProgressPhotoInput>()
  const angle = watch("angle")
  const recordedAt = watch("recordedAt")

  function resetImage() {
    setValue("imageFile", undefined, { shouldDirty: true })
    setValue("imagePreviewUrl", undefined, { shouldDirty: true })
    setValue("qualityChecks", [])
  }

  return (
    <div>
      <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 28, background: '#f1f5f9' }}>
        <img src={imageUrl} alt="Ảnh tiến độ" style={{ aspectRatio: '3/4', width: '100%', objectFit: 'cover', display: 'block' }} />
        <div style={{ position: 'absolute', left: 16, right: 16, bottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 16, background: 'rgba(255,255,255,0.9)', padding: '12px 16px', fontSize: 14, fontWeight: 600, boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', backdropFilter: 'blur(16px)' }}>
          <span style={{ color: '#db2777' }}>{angle === "front" ? "Chính diện" : angle === "side" ? "Nghiêng" : "Sau lưng"}</span>
          <span style={{ margin: '0 8px', color: '#cbd5e1' }}>•</span>
          <span style={{ color: '#475569' }}>{recordedAt}</span>
        </div>
      </div>
      <ImageQualityResult />
      <button type="button" onClick={resetImage} style={{ marginTop: 16, display: 'flex', height: 48, width: '100%', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, border: '1px solid #fbcfe8', fontWeight: 700, color: '#db2777', background: 'transparent', cursor: 'pointer' }}>
        <Camera size={20} /> Chụp hoặc chọn lại
      </button>
    </div>
  )
}

function ImageQualityResult() {
  const demoChecks = [
    { label: "Ánh sáng tốt", status: "passed" },
    { label: "Cơ thể nằm trong khung", status: "passed" },
    { label: "Camera hơi thấp một chút", status: "warning" },
  ] as const
  return (
    <div style={{ marginTop: 16, borderRadius: 24, border: '1px solid #d1fae5', background: 'rgba(236,253,245,0.5)', padding: 16 }}>
      <p style={{ fontWeight: 700, color: '#0f172a', margin: 0 }}>Kiểm tra chất lượng ảnh (Tự động)</p>
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {demoChecks.map((item) => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {item.status === "passed" ? <CheckCircle2 size={20} color="#10b981" /> : <AlertTriangle size={20} color="#f97316" />}
            <span style={{ fontSize: 14, color: '#334155' }}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function InformationStep() {
  const { register, watch, formState: { errors } } = useFormContext<ProgressPhotoInput>()
  const note = watch("note") ?? ""
  return (
    <section>
      <h2 style={{ fontSize: 20, fontWeight: 900, color: '#020617', margin: 0 }}>Thông tin ảnh</h2>
      <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        <label style={{ display: 'block' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#334155' }}>Ngày ghi nhận</span>
          <input type="date" {...register("recordedAt")} style={{ marginTop: 8, height: 52, width: '100%', borderRadius: 16, border: '1px solid #e2e8f0', padding: '0 16px', outline: 'none', boxSizing: 'border-box' }} />
        </label>
        <label style={{ display: 'block' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#334155' }}>Cân nặng <span style={{ fontSize: 11, fontWeight: 500, color: '#94a3b8' }}>(Tuỳ chọn)</span></span>
          <div style={{ position: 'relative', marginTop: 8 }}>
            <input type="number" step="0.1" {...register("weightKg", { valueAsNumber: true })} style={{ height: 52, width: '100%', borderRadius: 16, border: '1px solid #e2e8f0', padding: '0 40px 0 16px', outline: 'none', boxSizing: 'border-box' }} placeholder="60.0" />
            <span style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: '#94a3b8' }}>kg</span>
          </div>
        </label>
      </div>
      {errors.weightKg?.message && <p style={{ marginTop: 8, fontSize: 14, color: '#ef4444', margin: '8px 0 0' }}>{String(errors.weightKg.message)}</p>}
      <MeasurementFields />
      <FeelingChips />
      <label style={{ marginTop: 28, display: 'block' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, color: '#1e293b' }}>Ghi chú thêm</span>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>{note.length}/200</span>
        </div>
        <textarea {...register("note")} rows={5} placeholder="Chia sẻ thêm cảm nhận của bạn..." style={{ marginTop: 12, width: '100%', resize: 'none', borderRadius: 24, border: '1px solid #e2e8f0', padding: 16, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
      </label>
      <PrivacySelector />
    </section>
  )
}

function MeasurementFields() {
  const { control, register, watch } = useFormContext<ProgressPhotoInput>()
  const { fields, append, remove } = useFieldArray({ control, name: "measurements" })
  const currentMeasurements = watch("measurements")
  
  const AVAILABLE_MEASUREMENTS = [{ key: "waist", label: "Vòng eo" }, { key: "hip", label: "Vòng mông" }, { key: "thigh", label: "Vòng đùi" }] as const
  const available = AVAILABLE_MEASUREMENTS.filter((opt) => !currentMeasurements.some((m: any) => m.key === opt.key))

  function addMeasurement() {
    const first = available[0]
    if (!first) return
    append({ key: first.key, label: first.label, valueCm: 0 })
  }

  return (
    <section style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ fontWeight: 700, color: '#0f172a', margin: 0 }}>Số đo</h3>
          <p style={{ marginTop: 4, fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>Không bắt buộc</p>
        </div>
        <button type="button" onClick={addMeasurement} disabled={available.length === 0} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 14, fontWeight: 700, color: '#db2777', background: 'none', border: 'none', cursor: available.length === 0 ? 'not-allowed' : 'pointer', opacity: available.length === 0 ? 0.4 : 1 }}>
          <Plus size={16} /> Thêm số đo
        </button>
      </div>
      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {fields.map((field, index) => (
          <div key={field.id} style={{ display: 'flex', alignItems: 'center', gap: 12, borderRadius: 16, background: '#f8fafc', padding: 12 }}>
            <span style={{ minWidth: 96, flex: 1, fontSize: 14, fontWeight: 600, color: '#334155' }}>{(field as any).label}</span>
            <input type="number" step="0.1" {...register(`measurements.${index}.valueCm` as any, { valueAsNumber: true })} style={{ height: 40, width: 96, borderRadius: 12, border: '1px solid #e2e8f0', background: '#fff', padding: '0 12px', textAlign: 'right', fontWeight: 700, outline: 'none' }} />
            <span style={{ fontSize: 14, color: '#94a3b8' }}>cm</span>
            <button type="button" onClick={() => remove(index)} aria-label={`Xóa ${(field as any).label}`} style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer' }}><Trash2 size={16} /></button>
          </div>
        ))}
      </div>
    </section>
  )
}

function FeelingChips() {
  const { watch, setValue } = useFormContext<ProgressPhotoInput>()
  const selected = watch("feelings")

  function toggleFeeling(feeling: string) {
    const exists = selected.includes(feeling)
    const next = exists ? selected.filter((i: string) => i !== feeling) : [...selected, feeling]
    setValue("feelings", next, { shouldDirty: true })
  }

  return (
    <section style={{ marginTop: 28 }}>
      <h3 style={{ fontWeight: 700, color: '#0f172a', margin: 0 }}>Cảm nhận hôm nay</h3>
      <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {FEELING_OPTIONS.map((feeling) => {
          const active = selected.includes(feeling)
          return (
            <button key={feeling} type="button" onClick={() => toggleFeeling(feeling)} style={{ borderRadius: 12, border: active ? '1px solid #f472b6' : '1px solid #e2e8f0', padding: '8px 12px', fontSize: 14, fontWeight: 600, transition: 'all 0.2s', cursor: 'pointer', background: active ? '#fdf2f8' : '#fff', color: active ? '#db2777' : '#475569' }}>
              {feeling}
            </button>
          )
        })}
      </div>
    </section>
  )
}

function PrivacySelector() {
  const { control } = useFormContext<ProgressPhotoInput>()
  const icons = { private: Lock, coach: Users, ai_analysis: Bot }
  
  return (
    <section style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ fontWeight: 700, color: '#0f172a', margin: 0 }}>Quyền riêng tư</h3>
        <button type="button" style={{ fontSize: 12, fontWeight: 700, color: '#db2777', background: 'none', border: 'none', cursor: 'pointer' }}>Tìm hiểu thêm</button>
      </div>
      <Controller
        control={control}
        name="privacy"
        render={({ field }) => (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {PRIVACY_OPTIONS.map((option) => {
              const Icon = icons[option.value]
              const active = field.value === option.value
              return (
                <button key={option.value} type="button" onClick={() => field.onChange(option.value)} style={{ display: 'flex', width: '100%', alignItems: 'flex-start', gap: 12, borderRadius: 16, border: active ? '1px solid #f9a8d4' : '1px solid #e2e8f0', padding: 16, textAlign: 'left', transition: 'all 0.2s', background: active ? '#fdf2f8' : '#fff', cursor: 'pointer' }}>
                  <span style={{ marginTop: 2, display: 'flex', width: 32, height: 32, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 12, background: active ? '#ec4899' : '#f1f5f9', color: active ? '#fff' : '#64748b' }}>
                    <Icon size={16} />
                  </span>
                  <span style={{ flex: 1 }}>
                    <strong style={{ display: 'block', fontSize: 14, color: '#0f172a', margin: 0 }}>{option.label}</strong>
                    <span style={{ marginTop: 4, display: 'block', fontSize: 12, lineHeight: 1.5, color: '#64748b', margin: '4px 0 0' }}>{option.description}</span>
                  </span>
                  <span style={{ marginTop: 4, width: 20, height: 20, borderRadius: 999, border: active ? '2px solid #ec4899' : '2px solid #cbd5e1', background: active ? '#ec4899' : 'transparent', boxShadow: active ? 'inset 0 0 0 4px #fff' : 'none', boxSizing: 'border-box' }} />
                </button>
              )
            })}
          </div>
        )}
      />
    </section>
  )
}

function StudioActionBar({ step, onBack, onNext, ownerId, onNavigate }: { step: StudioStep; onBack: () => void; onNext: () => void; ownerId: string; onNavigate: (path: string) => void }) {
  const { handleSubmit } = useFormContext<ProgressPhotoInput>()
  const [isPending, setIsPending] = useState(false)

  const submit = handleSubmit(async (values: any) => {
    try {
      setIsPending(true)
      let imageUrl = values.imagePreviewUrl || ''
      const imageFile = values.imageFile

      if (imageFile) {
        try {
          imageUrl = await uploadUserProgressPhoto(ownerId, imageFile)
        } catch (err) {
          console.warn("Upload to Firebase Storage failed, falling back to base64 data URL:", err)
          imageUrl = await new Promise((resolve) => {
            const reader = new FileReader()
            reader.onloadend = () => resolve(reader.result as string)
            reader.readAsDataURL(imageFile)
          })
        }
      }

      if (!imageUrl) {
        throw new Error("Vui lòng chụp hoặc chọn một ảnh tiến độ")
      }

      const photoId = `photo-${Date.now()}`
      const recordedDate = values.recordedAt || new Date().toISOString().split("T")[0]
      const photoPayload = {
        id: photoId,
        date: recordedDate,
        recordedAt: recordedDate,
        angle: values.angle || 'front',
        imageUrl,
        weightKg: (values.weightKg && !isNaN(Number(values.weightKg))) ? Number(values.weightKg) : undefined,
        measurements: Array.isArray(values.measurements) ? values.measurements.filter((m: any) => m && m.valueCm > 0) : [],
        feelings: values.feelings || [],
        notes: values.note || '',
        note: values.note || '',
        privacy: values.privacy || 'private',
        isPrivate: values.privacy === 'private',
        qualityChecks: values.qualityChecks || [],
        createdAt: new Date().toISOString(),
      }

      // 1. Instant local sync
      try {
        const cachedKey1 = `aura:progress-photos:${ownerId}`
        const cachedKey2 = `aura:cache:user_progress_photos:${ownerId}`
        const existing1 = JSON.parse(localStorage.getItem(cachedKey1) || localStorage.getItem(cachedKey2) || '[]')
        const updated = [photoPayload, ...existing1]
        localStorage.setItem(cachedKey1, JSON.stringify(updated))
        localStorage.setItem(cachedKey2, JSON.stringify(updated))
        window.dispatchEvent(new Event('aura:progress-photos-updated'))
      } catch (e) {
        console.error("Local storage sync warning:", e)
      }

      // 2. Firebase Firestore sync
      await saveUserProgressPhoto(ownerId, photoPayload as any)

      onNavigate('progress')
    } catch (err: any) {
      console.error('Error saving progress photo:', err)
      alert("Đã có lỗi xảy ra khi lưu: " + (err.message || 'Lỗi không xác định'))
    } finally {
      setIsPending(false)
    }
  })

  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 40, borderTop: '1px solid #ffe4e6', background: 'rgba(255,255,255,0.95)', padding: '12px 16px max(14px, env(safe-area-inset-bottom))', backdropFilter: 'blur(16px)' }}>
      <div style={{ margin: '0 auto', display: 'flex', maxWidth: 440, gap: 12 }}>
        {step > 1 && (
          <button type="button" onClick={onBack} style={{ display: 'flex', height: 56, minWidth: 112, alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, border: '1px solid #f9a8d4', fontWeight: 700, color: '#db2777', background: 'transparent', cursor: 'pointer' }}>
            <ArrowLeft size={16} /> Quay lại
          </button>
        )}
        {step < 3 ? (
          <button type="button" onClick={onNext} style={{ display: 'flex', height: 56, flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, background: 'linear-gradient(to right, #db2777 0%, #f97316 100%)', fontWeight: 700, color: '#fff', border: 'none', boxShadow: '0 10px 15px -3px rgba(252,231,243,1)', cursor: 'pointer' }}>
            Tiếp tục <ArrowRight size={20} />
          </button>
        ) : (
          <button type="button" onClick={submit} disabled={isPending} style={{ display: 'flex', height: 56, flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, background: 'linear-gradient(to right, #db2777 0%, #f97316 100%)', fontWeight: 700, color: '#fff', border: 'none', boxShadow: '0 10px 15px -3px rgba(252,231,243,1)', cursor: isPending ? 'not-allowed' : 'pointer', opacity: isPending ? 0.6 : 1 }}>
            {isPending ? <><LoaderCircle size={20} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} /> Đang lưu...</> : <>Lưu ảnh tiến độ <Check size={20} /></>}
          </button>
        )}
      </div>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
export default ProgressPhotoStudio;
