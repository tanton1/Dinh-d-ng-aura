import { useEffect, useMemo, useState } from 'react'
import { Check, FlaskConical, ShieldCheck, Users } from 'lucide-react'
import { Badge, Button, ErrorState, LoadingState } from '../../../components/ui'
import { useAuraUiRollout } from '../../../features/ui-rollout/AuraUiRolloutContext'
import { loadAuraUiAssignment, saveAuraUiAssignment, saveAuraUiRolloutConfig } from '../../../features/ui-rollout/uiRolloutService'
import { AURA_UI_SURFACES, type AuraUiAudience, type AuraUiRolloutConfig, type AuraUiSurface } from '../../../features/ui-rollout/types'
import type { AdminUserRecord } from '../../../types'

const surfaceLabels: Record<AuraUiSurface, string> = {
  shell: 'Điều hướng & shell',
  'member-home': 'Học viên · Hôm nay',
  'member-schedule': 'Học viên · Lịch',
  'member-availability': 'Học viên · Lịch rảnh',
  'student-360': 'Học viên 360',
  'admin-dashboard': 'Admin Dashboard',
  'member-nutrition': 'Học viên · Dinh dưỡng',
}

const audienceLabels: Record<AuraUiAudience, string> = {
  off: 'Tắt',
  admin: 'Admin',
  staff: 'Staff',
  all: 'Tất cả',
}

export function UiRolloutPanel({ users, currentUserUid, canManage, demo }: { users: AdminUserRecord[]; currentUserUid?: string; canManage: boolean; demo: boolean }) {
  const rollout = useAuraUiRollout()
  const [draft, setDraft] = useState<AuraUiRolloutConfig>(rollout.config)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [pilotUid, setPilotUid] = useState('')
  const [pilotSurfaces, setPilotSurfaces] = useState<AuraUiSurface[]>([])
  const [pilotExpiresAt, setPilotExpiresAt] = useState('')
  const [pilotLoading, setPilotLoading] = useState(false)

  useEffect(() => setDraft(rollout.config), [rollout.config])
  useEffect(() => {
    let active = true
    if (!pilotUid) {
      setPilotSurfaces([])
      setPilotExpiresAt('')
      setPilotLoading(false)
      return () => { active = false }
    }
    setPilotLoading(true)
    setError('')
    void loadAuraUiAssignment(pilotUid, demo)
      .then((assignment) => {
        if (!active) return
        setPilotSurfaces(assignment?.surfaces ?? [])
        setPilotExpiresAt(assignment?.expiresAt?.slice(0, 10) ?? '')
      })
      .catch((cause) => {
        if (!active) return
        setPilotSurfaces([])
        setPilotExpiresAt('')
        setError(cause instanceof Error ? cause.message : 'Chưa thể tải cohort cá nhân.')
      })
      .finally(() => { if (active) setPilotLoading(false) })
    return () => { active = false }
  }, [demo, pilotUid])
  const sortedUsers = useMemo(() => [...users].sort((a, b) => a.displayName.localeCompare(b.displayName, 'vi')), [users])

  const saveConfig = async () => {
    if (!currentUserUid || !canManage) return
    setSaving(true); setError(''); setSaved('')
    try {
      const result = await saveAuraUiRolloutConfig(draft, currentUserUid, demo)
      setDraft(result)
      setSaved('Đã lưu audience. Thay đổi áp dụng từ phiên mới và đã được ghi audit.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chưa thể lưu rollout giao diện.')
    } finally { setSaving(false) }
  }

  const savePilot = async () => {
    if (!pilotUid || !canManage) return
    setSaving(true); setError(''); setSaved('')
    try {
      const assignment = await saveAuraUiAssignment({
        uid: pilotUid,
        surfaces: pilotSurfaces,
        expiresAt: pilotExpiresAt ? new Date(`${pilotExpiresAt}T23:59:59+07:00`).toISOString() : null,
      }, demo)
      setPilotSurfaces(assignment?.surfaces ?? [])
      setPilotExpiresAt(assignment?.expiresAt?.slice(0, 10) ?? '')
      setSaved(`Đã cập nhật cohort cá nhân cho ${sortedUsers.find((user) => user.uid === pilotUid)?.displayName || pilotUid}.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chưa thể lưu cohort cá nhân.')
    } finally { setSaving(false) }
  }

  if (rollout.loading) return <LoadingState title="Đang tải cấu hình Aura UI 4.0" />

  return <div className="ui-rollout-panel">
    <section className="ui-rollout-panel__intro">
      <span><FlaskConical size={22} /></span>
      <div><Badge tone="info">Feature flag · schema v1</Badge><h2>Aura UI 4.0</h2><p>Mở từng khu vực theo cohort. Nếu cấu hình thiếu hoặc lỗi, ứng dụng tự dùng giao diện ổn định trước đó.</p></div>
    </section>

    {!canManage && <div className="ui-rollout-panel__readonly"><ShieldCheck size={18} /><span>Bạn được xem trạng thái rollout. Chỉ Super Administrator có thể thay đổi.</span></div>}
    {error && <ErrorState description={error} />}
    {saved && <div className="ui-rollout-panel__saved" role="status"><Check size={17} />{saved}</div>}

    <section className="ui-rollout-card">
      <header><div><small>AUDIENCE TOÀN HỆ THỐNG</small><h3>Mở theo vai trò</h3></div><Badge>{draft.updatedAt ? `Cập nhật ${new Date(draft.updatedAt).toLocaleString('vi-VN')}` : 'Chưa xuất bản'}</Badge></header>
      <div className="ui-rollout-grid">
        {AURA_UI_SURFACES.map((surface) => <label key={surface}><span><strong>{surfaceLabels[surface]}</strong><small>{surface}</small></span><select value={draft.surfaces[surface]} disabled={!canManage || saving} onChange={(event) => setDraft((current) => ({ ...current, surfaces: { ...current.surfaces, [surface]: event.target.value as AuraUiAudience } }))}>{(['off', 'admin', 'staff', 'all'] as AuraUiAudience[]).map((audience) => <option key={audience} value={audience}>{audienceLabels[audience]}</option>)}</select></label>)}
      </div>
      <footer><span>Mở `shell` trước các trang để bảo đảm điều hướng V4 nhất quán.</span><Button disabled={!canManage || saving} onClick={() => void saveConfig()}>{saving ? 'Đang lưu…' : 'Lưu audience'}</Button></footer>
    </section>

    <section className="ui-rollout-card">
      <header><div><small>COHORT CÁ NHÂN</small><h3><Users size={18} /> Người dùng thử nghiệm</h3></div><Badge tone="warning">Ưu tiên hơn audience</Badge></header>
      <div className="ui-rollout-pilot">
        <label><span>Người dùng</span><select value={pilotUid} disabled={!canManage || saving} onChange={(event) => setPilotUid(event.target.value)}><option value="">Chọn tài khoản…</option>{sortedUsers.map((user) => <option key={user.uid} value={user.uid}>{user.displayName} · {user.role}</option>)}</select></label>
        <label><span>Hết hạn thử nghiệm</span><input type="date" value={pilotExpiresAt} disabled={!canManage || saving || pilotLoading} onChange={(event) => setPilotExpiresAt(event.target.value)} /></label>
        <fieldset aria-busy={pilotLoading}><legend>{pilotLoading ? 'Đang tải khu vực…' : 'Khu vực được bật'}</legend>{AURA_UI_SURFACES.map((surface) => <label key={surface}><input type="checkbox" checked={pilotSurfaces.includes(surface)} disabled={!canManage || saving || pilotLoading || !pilotUid} onChange={(event) => setPilotSurfaces((current) => event.target.checked ? [...current, surface] : current.filter((item) => item !== surface))} /><span>{surfaceLabels[surface]}</span></label>)}</fieldset>
      </div>
      <footer><span>Để trống surface để thu hồi pilot; ngày hết hạn có thể bỏ trống.</span><Button variant="secondary" disabled={!canManage || saving || pilotLoading || !pilotUid} onClick={() => void savePilot()}>Lưu cohort</Button></footer>
    </section>
  </div>
}
