/** Authoring contract. Draft units are not automatically imported into published courses. */
export type AcademyLearningUnit = {
  schemaVersion: 1
  chapter: number
  revision: string
  title: string
  review: { status: 'draft-needs-review'; requiresQualifiedReviewer: boolean }
  audience: string
  scope: string
  prerequisites: number[]
  objectives: Array<{ id: string; outcome: string; evidence: string }>
  sections: Array<{
    id: string
    title: string
    objectiveIds: string[]
    paragraphs: string[]
    takeaways: string[]
    sourceIds: string[]
  }>
  workedExamples: Array<{
    id: string
    title: string
    objectiveIds: string[]
    prompt: string
    given: string[]
    steps: string[]
    answer: string
    limitation: string
  }>
  cases: Array<{
    id: string
    title: string
    context: string
    question: string
    reasoning: string[]
    safeNextStep: string
    commonError: string
  }>
  practice: {
    title: string
    artifact: string
    steps: string[]
    fields: Array<{ id: string; label: string; prompt: string; required: boolean }>
    modelResponse: string[]
    rubric: Array<{ id: 'data' | 'mechanism' | 'feasibility' | 'safety'; label: string; levels: [string, string, string] }>
  }
  coachExtension: string[]
  safety: string[]
  referenceIds: string[]
}

export type AcademyEvidenceSource = {
  id: string
  title: string
  organization: string
  url: string
  checkedAt: string
  supports: string
  limitations: string
}

/** Formative answers are deliberately visible after a response; not completion proof. */
export type AcademyUnitCheck = {
  id: string
  objectiveId: string
  prompt: string
  options: [string, string, string, string]
  correctIndex: 0 | 1 | 2 | 3
  feedback: string
  sectionId: string
}

/** This packet is served only to trusted editors; it never publishes a course. */
export type AcademyDraftReviewPacket = {
  schemaVersion: 1
  unit: AcademyLearningUnit
  sources: AcademyEvidenceSource[]
  formativeChecks: AcademyUnitCheck[]
}
