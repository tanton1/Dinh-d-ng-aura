type QuizQuestion = { id: string; mustPass?: boolean }

export function academyQuizCompletionCurrent(lesson: { id: string; contentVersion?: string } | undefined,
  completedIds: string[], versions?: Record<string, string>) {
  return Boolean(lesson && completedIds.includes(lesson.id)
    && (!lesson.contentVersion || versions?.[lesson.id] === lesson.contentVersion))
}

export function stableQuizOrderScore(value: string) {
  let score = 0
  for (let index = 0; index < value.length; index += 1) score = Math.imul(31, score) + value.charCodeAt(index) | 0
  return score
}

// Keep this contract in parity with Functions quizQuestionsForAttempt.
export function selectAcademyQuizQuestions<T extends QuizQuestion>(questions: T[], ownerId: string, lessonId: string, requested?: number, order?: string) {
  const items = [...questions]
  const count = Number.isInteger(requested) ? Math.max(1, Math.min(items.length, Number(requested))) : items.length
  if (count < items.length || order === 'shuffle') {
    items.sort((left, right) => stableQuizOrderScore(`${ownerId}:${lessonId}:${left.id}`) - stableQuizOrderScore(`${ownerId}:${lessonId}:${right.id}`) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  }
  const required = items.filter((question) => question.mustPass === true)
  const optional = items.filter((question) => question.mustPass !== true)
  return [...required, ...optional.slice(0, Math.max(0, count - required.length))]
}

/** Presentation only. Submitted answers retain the canonical server option index. */
export function academyQuizOptionOrder<T>(options: T[], seed: string) {
  let state = stableQuizOrderScore(seed) >>> 0
  const items = options.map((option, optionIndex) => ({ option, optionIndex }))
  for (let index = items.length - 1; index > 0; index -= 1) {
    state += 0x6D2B79F5
    let mixed = Math.imul(state ^ state >>> 15, state | 1)
    mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61)
    const random = ((mixed ^ mixed >>> 14) >>> 0) / 4294967296
    const other = Math.floor(random * (index + 1))
    ;[items[index], items[other]] = [items[other], items[index]]
  }
  return items
}

export function academyQuizCanReveal(mode: string | undefined, passed: boolean) {
  return mode !== 'never' && (mode !== 'after-pass' || passed)
}
