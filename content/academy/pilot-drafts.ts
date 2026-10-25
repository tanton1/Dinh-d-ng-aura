import { chapter03Unit } from './chapter-03'
import { chapter08Unit } from './chapter-08'
import { chapter17Unit } from './chapter-17'
import { chapter18Unit } from './chapter-18'
import { academyEvidenceSources } from './references'
import { pilotFormativeChecks } from './pilot-formative-checks'
import type { AcademyDraftReviewPacket, AcademyLearningUnit } from './learning-unit'

export const academyPilotUnits: AcademyLearningUnit[] = [chapter03Unit, chapter08Unit, chapter17Unit, chapter18Unit]

export function getAcademyPilotDraft(chapter: number): AcademyDraftReviewPacket | null {
  const unit = academyPilotUnits.find((candidate) => candidate.chapter === chapter)
  if (!unit) return null
  return {
    schemaVersion: 1,
    unit,
    sources: unit.referenceIds.map((id) => {
      const source = academyEvidenceSources.find((candidate) => candidate.id === id)
      if (!source) throw new Error(`Missing evidence source: ${id}`)
      return source
    }),
    formativeChecks: pilotFormativeChecks[chapter] ?? [],
  }
}
