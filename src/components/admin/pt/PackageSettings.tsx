import { useEffect, useMemo, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { Archive, Building2, Clock, DollarSign, Edit2, Hash, LoaderCircle, Package, Plus } from 'lucide-react'
import type { TrainingPackage, UserProfile } from '../../../types'
import { useAuth } from '../../../contexts/AuthContext'
import { useDatabase } from '../../../contexts/DatabaseContext'
import { Button, Dialog, EmptyState, ErrorState } from '../../ui'
import {
  archiveTrainingPackage,
  createPackageCommandKey,
  upsertTrainingPackage,
} from '../../../services/packageManagementService'

interface Props {
  user: User | null
  profile?: UserProfile | null
}

const EMPTY_DRAFT: Partial<TrainingPackage> = {
  name: '',
  totalSessions: 12,
  price: 0,
  durationMonths: 1,
  branchId: '',
}

function commandError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.replace(/^FirebaseError:\s*/i, '')
  return 'Chưa thể cập nhật gói tập. Hãy kiểm tra kết nối rồi thử lại.'
}

function packageDraftValid(value: Partial<TrainingPackage>) {
  return Boolean(
    value.name?.trim().length &&
    Number.isInteger(value.totalSessions) && Number(value.totalSessions) > 0 &&
    Number.isInteger(value.durationMonths) && Number(value.durationMonths) > 0 &&
    Number.isInteger(value.price) && Number(value.price) >= 0,
  )
}

export default function PackageSettings({ profile }: Props) {
  const { accessContext, backendMode, hasCapability } = useAuth()
  const { packages, branches, operationsSync } = useDatabase()
  const elevatedActor = accessContext?.accessRole === 'admin'
    || accessContext?.accessRole === 'super_admin'
    || profile?.role === 'admin'
    || profile?.role === 'super_admin'
  const canManagePackages = backendMode === 'demo' || hasCapability('pt.operations.manage')
  const availableBranches = useMemo(() => elevatedActor
    ? branches.filter((branch) => branch.status !== 'archived')
    : branches.filter((branch) => branch.status !== 'archived' && accessContext?.branchIds.includes(branch.id)),
  [accessContext?.branchIds, branches, elevatedActor])
  const defaultBranchId = elevatedActor ? '' : availableBranches[0]?.id || ''
  const [demoPackages, setDemoPackages] = useState<TrainingPackage[]>(() => packages.filter((item) => item.status !== 'archived'))
  const visiblePackages = (backendMode === 'demo' ? demoPackages : packages).filter((item) => item.status !== 'archived')
  const [isEditing, setIsEditing] = useState(false)
  const [editingPackage, setEditingPackage] = useState<TrainingPackage | null>(null)
  const [archiveCandidate, setArchiveCandidate] = useState<TrainingPackage | null>(null)
  const [formData, setFormData] = useState<Partial<TrainingPackage>>({ ...EMPTY_DRAFT, branchId: defaultBranchId })
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const pendingRef = useRef(false)

  useEffect(() => {
    if (backendMode === 'demo') setDemoPackages(packages.filter((item) => item.status !== 'archived'))
  }, [backendMode, packages])

  const closeEditor = () => {
    if (pendingRef.current) return
    setIsEditing(false)
    setEditingPackage(null)
  }

  const openCreate = () => {
    setError(null)
    setNotice(null)
    setEditingPackage(null)
    setFormData({ ...EMPTY_DRAFT, branchId: defaultBranchId })
    setIsEditing(true)
  }

  const openEdit = (item: TrainingPackage) => {
    setError(null)
    setNotice(null)
    setEditingPackage(item)
    setFormData({ ...item, branchId: item.branchId || '' })
    setIsEditing(true)
  }

  const handleSave = async () => {
    if (pendingRef.current || !packageDraftValid(formData)) return
    pendingRef.current = true
    setBusyAction('save')
    setError(null)
    const idempotencyKey = createPackageCommandKey()
    try {
      const input = {
        ...(editingPackage ? { packageId: editingPackage.id } : {}),
        expectedRevision: editingPackage?.revision ?? 0,
        idempotencyKey,
        name: formData.name!.trim(),
        totalSessions: Number(formData.totalSessions),
        durationMonths: Number(formData.durationMonths),
        price: Number(formData.price),
        branchId: formData.branchId || null,
      }
      const result = backendMode === 'demo'
        ? {
            packageId: editingPackage?.id || `demo-package-${Date.now()}`,
            revision: (editingPackage?.revision ?? 0) + 1,
            status: 'active' as const,
          }
        : await upsertTrainingPackage(input)
      if (backendMode === 'demo') {
        const next: TrainingPackage = { ...input, id: result.packageId, branchId: input.branchId || undefined, status: 'active', revision: result.revision }
        setDemoPackages((current) => editingPackage
          ? current.map((item) => item.id === editingPackage.id ? next : item)
          : [next, ...current])
      }
      setNotice(editingPackage ? 'Đã cập nhật gói tập.' : 'Đã tạo gói tập mới.')
      setIsEditing(false)
      setEditingPackage(null)
    } catch (caught) {
      setError(commandError(caught))
    } finally {
      pendingRef.current = false
      setBusyAction(null)
    }
  }

  const handleArchive = async () => {
    if (!archiveCandidate || pendingRef.current) return
    pendingRef.current = true
    setBusyAction(`archive:${archiveCandidate.id}`)
    setError(null)
    const candidate = archiveCandidate
    const idempotencyKey = createPackageCommandKey()
    try {
      if (backendMode === 'demo') {
        setDemoPackages((current) => current.filter((item) => item.id !== candidate.id))
      } else {
        await archiveTrainingPackage({
          packageId: candidate.id,
          expectedRevision: candidate.revision ?? 0,
          idempotencyKey,
        })
      }
      setArchiveCandidate(null)
      setNotice(`Đã ngừng áp dụng “${candidate.name}”. Hợp đồng cũ vẫn giữ nguyên thông tin gói.`)
    } catch (caught) {
      setError(commandError(caught))
    } finally {
      pendingRef.current = false
      setBusyAction(null)
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <header className="flex justify-between items-center bg-zinc-900 p-6 rounded-2xl border border-zinc-800">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-xl bg-pink-500/10 text-pink-500 flex items-center justify-center"><Package aria-hidden="true" /></span>
          <div>
            <p className="text-xs font-bold text-pink-500">SẢN PHẨM & QUYỀN LỢI</p>
            <h1 className="text-xl font-bold text-white">Gói tập đang áp dụng</h1>
            <p className="text-sm text-zinc-400">Thay đổi chỉ áp dụng cho hợp đồng tạo sau thời điểm cập nhật.</p>
          </div>
        </div>
        {canManagePackages && <Button onClick={openCreate}><Plus size={17} /> Thêm gói</Button>}
      </header>

      {notice && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700" role="status" aria-live="polite">{notice}</div>}
      {error && <ErrorState title="Chưa thể cập nhật gói tập" description={error} />}
      {operationsSync.status === 'error' && <ErrorState title="Danh sách gói chưa đồng bộ đầy đủ" description={operationsSync.error || 'Hãy tải lại trang rồi thử lại.'} />}

      <div className="grid grid-cols-1 gap-4">
        {visiblePackages.length > 0 ? visiblePackages.map((item) => (
          <article key={item.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-sm">
            <div className="flex justify-between items-start gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <h2 className="text-lg font-bold text-white">{item.name}</h2>
                  <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-bold text-emerald-700">Đang áp dụng</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                  <span className="flex items-center gap-2 text-sm text-zinc-400"><Hash size={16} /> {item.totalSessions} buổi tập</span>
                  <span className="flex items-center gap-2 text-sm text-zinc-400"><Clock size={16} /> {item.durationMonths} tháng</span>
                  <span className="flex items-center gap-2 text-sm text-zinc-400"><Building2 size={16} /> {item.branchId ? branches.find((branch) => branch.id === item.branchId)?.name || 'Chi nhánh không còn hoạt động' : 'Tất cả chi nhánh'}</span>
                  <strong className="flex items-center gap-2 text-sm text-pink-500"><DollarSign size={16} /> {item.price.toLocaleString('vi-VN')} VNĐ</strong>
                </div>
              </div>
              {canManagePackages && <div className="flex gap-2 shrink-0">
                <button type="button" onClick={() => openEdit(item)} disabled={Boolean(busyAction)} className="p-2 bg-zinc-800 text-zinc-500 hover:text-zinc-900 rounded-xl disabled:opacity-50" aria-label={`Sửa ${item.name}`}><Edit2 size={17} /></button>
                <button type="button" onClick={() => { setError(null); setNotice(null); setArchiveCandidate(item) }} disabled={Boolean(busyAction)} className="p-2 bg-red-500/10 text-red-600 hover:bg-red-500 hover:text-white rounded-xl disabled:opacity-50" aria-label={`Ngừng áp dụng ${item.name}`}><Archive size={17} /></button>
              </div>}
            </div>
          </article>
        )) : <EmptyState title="Chưa có gói tập đang áp dụng" description="Tạo gói đầu tiên để dùng khi lập hợp đồng cho học viên." action={canManagePackages ? <Button onClick={openCreate}><Plus size={17} /> Thêm gói</Button> : undefined} />}
      </div>

      <Dialog
        open={isEditing}
        onClose={closeEditor}
        title={editingPackage ? 'Sửa gói tập' : 'Tạo gói tập'}
        description="Tên, quyền lợi, thời hạn và giá sẽ được lưu thành một phiên bản có kiểm toán."
        footer={<>
          <Button variant="secondary" onClick={closeEditor} disabled={busyAction === 'save'}>Hủy</Button>
          <Button onClick={handleSave} disabled={busyAction === 'save' || !packageDraftValid(formData)}>
            {busyAction === 'save' ? <LoaderCircle className="animate-spin" size={17} /> : null}
            {busyAction === 'save' ? 'Đang lưu…' : 'Lưu gói tập'}
          </Button>
        </>}
      >
        <div className="space-y-4">
          <label className="block text-sm font-medium text-zinc-600">Tên gói tập
            <input type="text" value={formData.name || ''} onChange={(event) => setFormData({ ...formData, name: event.target.value })} disabled={busyAction === 'save'} className="mt-1 w-full p-3 rounded-xl border border-zinc-300 bg-white text-zinc-900" placeholder="Ví dụ: Gói PT 36 buổi" />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="block text-sm font-medium text-zinc-600">Số buổi
              <input type="number" min="1" step="1" value={formData.totalSessions ?? 0} onChange={(event) => setFormData({ ...formData, totalSessions: Number(event.target.value) })} disabled={busyAction === 'save'} className="mt-1 w-full p-3 rounded-xl border border-zinc-300 bg-white text-zinc-900" />
            </label>
            <label className="block text-sm font-medium text-zinc-600">Thời hạn (tháng)
              <input type="number" min="1" step="1" value={formData.durationMonths ?? 0} onChange={(event) => setFormData({ ...formData, durationMonths: Number(event.target.value) })} disabled={busyAction === 'save'} className="mt-1 w-full p-3 rounded-xl border border-zinc-300 bg-white text-zinc-900" />
            </label>
          </div>
          <label className="block text-sm font-medium text-zinc-600">Giá niêm yết (VNĐ)
            <input type="number" min="0" step="1" value={formData.price ?? 0} onChange={(event) => setFormData({ ...formData, price: Number(event.target.value) })} disabled={busyAction === 'save'} className="mt-1 w-full p-3 rounded-xl border border-zinc-300 bg-white text-zinc-900" />
          </label>
          <label className="block text-sm font-medium text-zinc-600">Phạm vi áp dụng
            <select value={formData.branchId || ''} onChange={(event) => setFormData({ ...formData, branchId: event.target.value })} disabled={busyAction === 'save'} className="mt-1 w-full p-3 rounded-xl border border-zinc-300 bg-white text-zinc-900">
              {elevatedActor && <option value="">Tất cả chi nhánh</option>}
              {availableBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        </div>
      </Dialog>

      <Dialog
        open={Boolean(archiveCandidate)}
        onClose={() => { if (!pendingRef.current) setArchiveCandidate(null) }}
        title="Ngừng áp dụng gói tập?"
        description={archiveCandidate ? `“${archiveCandidate.name}” sẽ không còn xuất hiện khi tạo hợp đồng mới.` : undefined}
        footer={<>
          <Button variant="secondary" onClick={() => setArchiveCandidate(null)} disabled={Boolean(busyAction)}>Giữ gói này</Button>
          <Button tone="danger" onClick={handleArchive} disabled={Boolean(busyAction)}>
            {busyAction?.startsWith('archive:') ? <LoaderCircle className="animate-spin" size={17} /> : <Archive size={17} />}
            {busyAction?.startsWith('archive:') ? 'Đang xử lý…' : 'Ngừng áp dụng'}
          </Button>
        </>}
      >
        <p className="text-sm text-zinc-600">Hợp đồng và lịch sử thanh toán đã dùng gói này vẫn được giữ nguyên. Aura không xóa dữ liệu nghiệp vụ cũ.</p>
      </Dialog>
    </div>
  )
}
