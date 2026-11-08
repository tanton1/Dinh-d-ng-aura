// Learner-specific wording rendered only by the lazy warning-detail and
// student-summary panels. It lives apart from availabilityPresentation so this
// text ships with those chunks instead of BranchScheduleWorkspace, whose gzip
// size is budgeted in scripts/check-performance-budget.mjs.
import { CONFIRMED_AVAILABILITY_STATUSES, hasUnconfirmedLegacyAvailability, type AvailabilityPresentationStudent } from './availabilityPresentation'

/** Why the listed slots are not used for scheduling; null once availability
 * is usable. */
export function unconfirmedAvailabilityNote(student: AvailabilityPresentationStudent | null | undefined) {
  if (!student || CONFIRMED_AVAILABILITY_STATUSES.has(student.availabilityStatus)) return null
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
