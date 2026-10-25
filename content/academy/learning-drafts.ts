import { chapter01Unit } from './chapter-01'
import { chapter02Unit } from './chapter-02'
import { chapter04Unit } from './chapter-04'
import { chapter05Unit } from './chapter-05'
import { chapter06Unit } from './chapter-06'
import { chapter07Unit } from './chapter-07'
import { chapter09Unit } from './chapter-09'
import { chapter10Unit } from './chapter-10'
import { chapter11Unit } from './chapter-11'
import { chapter12Unit } from './chapter-12'
import { chapter13Unit } from './chapter-13'
import { chapter14Unit } from './chapter-14'
import { chapter15Unit } from './chapter-15'
import { chapter16Unit } from './chapter-16'
import { chapter19Unit } from './chapter-19'
import { chapter20Unit } from './chapter-20'
import { academyPilotUnits, getAcademyPilotDraft } from './pilot-drafts'
import { foundationFormativeChecks } from './foundation-formative-checks'
import { personalizationFormativeChecks } from './personalization-formative-checks'
import { performanceFormativeChecks } from './performance-formative-checks'
import { masteryFormativeChecks } from './mastery-formative-checks'
import { academyEvidenceSources } from './references'
import type { AcademyDraftReviewPacket, AcademyLearningUnit } from './learning-unit'

export const academyLearningDraftUnits: AcademyLearningUnit[] = [
  chapter01Unit, chapter02Unit, ...academyPilotUnits, chapter04Unit, chapter05Unit,
  chapter06Unit, chapter07Unit, chapter09Unit, chapter10Unit,
  chapter11Unit, chapter12Unit, chapter13Unit, chapter14Unit,
  chapter15Unit, chapter16Unit, chapter19Unit, chapter20Unit,
].sort((a, b) => a.chapter - b.chapter)

export function getAcademyLearningDraft(chapter: number): AcademyDraftReviewPacket | null {
  if (!Number.isInteger(chapter)) return null
  const pilot = getAcademyPilotDraft(chapter)
  if (pilot) return pilot
  const unit = academyLearningDraftUnits.find((candidate) => candidate.chapter === chapter)
  if (!unit) return null
  return {
    schemaVersion: 1, unit,
    sources: unit.referenceIds.map((id) => {
      const source = academyEvidenceSources.find((candidate) => candidate.id === id)
      if (!source) throw new Error(`Missing evidence source: ${id}`)
      return source
    }),
    formativeChecks: foundationFormativeChecks[chapter] ?? personalizationFormativeChecks[chapter] ?? performanceFormativeChecks[chapter] ?? masteryFormativeChecks[chapter] ?? [],
  }
}
