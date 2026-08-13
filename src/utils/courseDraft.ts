import type { Course, CourseDraftInput } from '../types'

export function toCourseDraft(course: Course): CourseDraftInput {
  return {
    id: String(course.id),
    revision: Number.isInteger(course.revision) ? course.revision : 0,
    coverUrl: course.coverUrl,
    slug: course.slug ?? String(course.id),
    title: course.title,
    description: course.description,
    category: course.category,
    level: course.level,
    coach: course.coach,
    duration: course.duration,
    outcomes: course.outcomes ?? [],
    requirements: course.requirements ?? [],
    modules: course.modules ?? [],
    settings: course.settings ?? {
      accessTier: 'pro',
      completionPercent: 80,
      certificateEnabled: true,
      dripSchedule: 'weekly',
      visibility: 'members',
    },
    publicationStatus: course.publicationStatus ?? 'draft',
  }
}
