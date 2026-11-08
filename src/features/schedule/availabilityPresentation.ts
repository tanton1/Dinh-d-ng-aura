// Learner availability wording shared by the schedule workspace. Kept free of
// service imports so the labels can be unit-tested without the Firebase SDK.
export const CONFIRMED_AVAILABILITY_STATUSES = new Set(['submitted', 'locked', 'inherited', 'recurring'])

export interface AvailabilityPresentationStudent {
  availabilityStatus: string
  availabilitySource?: string | null
  availabilitySourceWeekId?: string | null
  availableSlots?: readonly string[] | null
}

export function isConfirmedAvailabilityStatus(status: string | undefined) {
  return typeof status === 'string' && CONFIRMED_AVAILABILITY_STATUSES.has(status)
}

/** A profile migrated from the old app whose slots the learner never
 * confirmed. The optimizer treats it as missing availability while the
 * workspace still lists the slots, so staff need to be told why the two
 * disagree instead of reading a generic "chưa gửi lịch rảnh". */
export function hasUnconfirmedLegacyAvailability(student: AvailabilityPresentationStudent | null | undefined) {
  if (!student || isConfirmedAvailabilityStatus(student.availabilityStatus)) return false
  return student.availabilitySource === 'legacy_default' && (student.availableSlots?.length || 0) > 0
}

export function availabilityOriginLabel(student: AvailabilityPresentationStudent) {
  if (student.availabilityStatus === 'inherited') return `kế thừa tuần ${student.availabilitySourceWeekId || 'gần nhất'}`
  if (student.availabilityStatus === 'recurring') return 'lịch mặc định cũ'
  if (['submitted', 'locked'].includes(student.availabilityStatus)) return 'đã gửi lịch rảnh'
  if (hasUnconfirmedLegacyAvailability(student)) return 'lịch mặc định cũ chưa xác nhận'
  return 'thiếu lịch rảnh'
}

/** Why the listed slots are not used for scheduling; null once availability
 * is usable. */
export function unconfirmedAvailabilityNote(student: AvailabilityPresentationStudent | null | undefined) {
  if (!student || isConfirmedAvailabilityStatus(student.availabilityStatus)) return null
  if (hasUnconfirmedLegacyAvailability(student)) {
    const slotCount = student.availableSlots?.length || 0
    return `Lịch mặc định cũ (${slotCount} khung) chưa được học viên xác nhận nên không dùng để xếp tự động. Học viên xác nhận trong app hoặc Admin lưu lịch rảnh thay học viên.`
  }
  return 'Học viên chưa gửi lịch rảnh tuần này.'
}

/** Learner-specific wording for AVAILABILITY_NOT_SUBMITTED; null defers to
 * the generic conflict label. */
export function availabilityReasonOverride(code: string | undefined, student: AvailabilityPresentationStudent | null | undefined) {
  if (code !== 'AVAILABILITY_NOT_SUBMITTED' || !hasUnconfirmedLegacyAvailability(student)) return null
  return 'Lịch mặc định cũ chưa được học viên xác nhận.'
}
