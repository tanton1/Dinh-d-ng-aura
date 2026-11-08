// Learner availability wording shared by the schedule workspace. Kept free of
// service imports so the labels can be unit-tested without the Firebase SDK.
// Only short labels belong here: this module is bundled into the
// BranchScheduleWorkspace chunk, whose gzip size is budgeted. Longer wording
// that only the lazy detail panels render lives in availabilityDetail.ts.
export const CONFIRMED_AVAILABILITY_STATUSES = new Set(['submitted', 'locked', 'inherited', 'recurring'])

export interface AvailabilityPresentationStudent {
  availabilityStatus: string
  availabilitySource?: string | null
  availabilitySourceWeekId?: string | null
  availableSlots?: readonly string[] | null
}

/** A profile migrated from the old app whose slots the learner never
 * confirmed. The optimizer treats it as missing availability while the
 * workspace still lists the slots, so staff need to be told why the two
 * disagree instead of reading a generic "chưa gửi lịch rảnh". */
export function hasUnconfirmedLegacyAvailability(student: AvailabilityPresentationStudent | null | undefined) {
  if (!student || CONFIRMED_AVAILABILITY_STATUSES.has(student.availabilityStatus)) return false
  return student.availabilitySource === 'legacy_default' && (student.availableSlots?.length || 0) > 0
}

export function availabilityOriginLabel(student: AvailabilityPresentationStudent) {
  if (student.availabilityStatus === 'inherited') return `kế thừa tuần ${student.availabilitySourceWeekId || 'gần nhất'}`
  if (student.availabilityStatus === 'recurring') return 'lịch mặc định cũ'
  if (['submitted', 'locked'].includes(student.availabilityStatus)) return 'đã gửi lịch rảnh'
  if (hasUnconfirmedLegacyAvailability(student)) return 'lịch mặc định cũ chưa xác nhận'
  return 'thiếu lịch rảnh'
}
