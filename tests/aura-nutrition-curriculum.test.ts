import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { auraFoundationCourse } from '../src/course-template'
import { auraNutritionCurriculumStats, auraNutritionPhases } from '../src/data/auraNutritionCurriculum'
import { getDueAcademyReviewCards } from '../src/features/academy/reviewQueue'
import { courseLoadErrorMessage } from '../src/features/academy/courseLoadError'
import { academyMastery } from '../src/features/academy/mastery'
import { emptyReaderState, flattenPdfOutline, normalizeReaderState, readerStorageKey } from '../src/features/academy/readerState'
import {
  academyPortfolioStages,
  getAcademyPortfolioStage,
  isAcademyPortfolioComplete,
  isAcademyPracticeArtifactComplete,
} from '../src/features/academy/portfolio'
import type { AcademyReviewState, AcademyWorkbookState } from '../src/services/academyLearningService'

test('Academy outages do not masquerade as deleted courses or leak raw internal errors', () => {
  for (const error of [new Error('internal'), { code: 'functions/internal' }, { code: 'functions/resource-exhausted' }, new Error('wrapper', { cause: { code: 'functions/unavailable' } })]) {
    assert.match(courseLoadErrorMessage(error), /tạm gián đoạn hoặc quá tải/)
    assert.doesNotMatch(courseLoadErrorMessage(error), /^internal$|Không tìm thấy khóa học/)
  }
  assert.match(courseLoadErrorMessage({ code: 'functions/permission-denied' }), /chưa có quyền/)
  assert.match(courseLoadErrorMessage({ code: 'functions/unauthenticated' }), /đăng nhập lại/)
  assert.equal(courseLoadErrorMessage(new Error('Quiz hết lượt.')), 'Quiz hết lượt.')
  const page = readFileSync(new URL('../src/pages/student/CourseDetailPage.tsx', import.meta.url), 'utf8')
  assert.ok(page.indexOf('if (loadError)') < page.indexOf('<h1>Không tìm thấy khóa học'))
  const lazyLoader = readFileSync(new URL('../src/components/ChunkErrorBoundary.tsx', import.meta.url), 'utf8')
  assert.match(lazyLoader, /if \(!component\?\.default\) throw new Error/)
  assert.match(lazyLoader, /if \(!retryComponent\?\.default\) throw new Error/)
})

test('PDF reading state is bounded, versioned, and account/resource scoped', () => {
  assert.deepEqual(normalizeReaderState(null), emptyReaderState())
  assert.deepEqual(normalizeReaderState({ version: 1, page: 900, bookmarks: [2, 2, 0, -1, 10, 3, '2'] }, 5), { version: 1, page: 5, bookmarks: [2, 3] })
  assert.equal(normalizeReaderState({ version: 1, page: 0 }).page, 1)
  assert.equal(normalizeReaderState({ version: 1, bookmarks: Array.from({ length: 70 }, (_, i) => i + 1) }).bookmarks.length, 50)
  assert.notEqual(readerStorageKey('a', 'course', 'lesson', 'pdf'), readerStorageKey('b', 'course', 'lesson', 'pdf'))
  assert.notEqual(readerStorageKey('a:b', 'c', 'd', 'e'), readerStorageKey('a', 'b:c', 'd', 'e'))
  const outline = flattenPdfOutline([{ title: 'A', dest: 'a', items: [{ title: 'B', dest: [0] }] }, { title: 'C', dest: 'c' }], 2)
  assert.deepEqual(outline.map((item) => [item.title, item.depth]), [['A', 0], ['B', 1]])
})

test('mastery distinguishes reviewed cards from remembered cards and counts partial practice', () => {
  const core = auraFoundationCourse.modules[0].lessons[0]
  const design = core.learningDesign!
  const workbook = { microCheckAnswers: {}, answers: {}, reviewAt: '', safetyAcknowledged: false } as AcademyWorkbookState
  const reviews: AcademyReviewState = { version: 1, cards: Object.fromEntries(design.cards.map((card) => [`${core.id}:${card.id}`, { lessonId: core.id, cardId: card.id, rating: 'again' as const, repetitions: 0, intervalDays: 0, reviewedAt: 1, dueAt: 2 }])) }
  const initial = academyMastery(design, workbook, reviews, core.id, 3)
  assert.equal(initial.reviewed, 12)
  assert.equal(initial.remembered, 0)
  assert.equal(initial.memoryPercent, 0)
  assert.equal(initial.practiceComplete, false)
  assert.equal(initial.due, 12)
  reviews.cards[`${core.id}:${design.cards[0].id}`].rating = 'good'
  workbook.answers.context = 'Dữ kiện thực tế'
  assert.equal(academyMastery(design, workbook, reviews, core.id).remembered, 1)
  assert.ok(academyMastery(design, workbook, reviews, core.id).practicePercent > 0)
  design.practice.fields.forEach((field) => { if (field.id === 'reviewAt') workbook.reviewAt = '2026-09-20'; else workbook.answers[field.id] = 'Đã điền' })
  assert.equal(academyMastery(design, workbook, reviews, core.id).practiceComplete, false)
  workbook.safetyAcknowledged = true
  assert.equal(academyMastery(design, workbook, reviews, core.id).practiceComplete, true)
})

test('AURA nutrition curriculum contains four phases, 20 chapters and 60 lessons', () => {
  assert.equal(auraNutritionPhases.length, 4)
  assert.equal(auraNutritionCurriculumStats.chapters, 20)
  assert.equal(auraNutritionCurriculumStats.lessons, 60)
  assert.equal(auraFoundationCourse.modules.length, 20)
  assert.ok(auraFoundationCourse.modules.every((module) => module.lessons.length === 3))
  assert.equal(auraFoundationCourse.settings.accessTier, 'free')
  assert.equal(auraFoundationCourse.settings.visibility, 'members')
  assert.equal(auraFoundationCourse.settings.dripSchedule, 'none')
})

test('curriculum lesson identifiers are unique and every chapter is publication-ready', () => {
  const lessons = auraFoundationCourse.modules.flatMap((module) => module.lessons)
  const ids = lessons.map((lesson) => lesson.id)
  assert.equal(new Set(ids).size, ids.length)

  for (const module of auraFoundationCourse.modules) {
    const [core, practice, checkpoint] = module.lessons
    assert.equal(core.type, 'Bài đọc')
    assert.equal(core.primaryContent?.kind, 'rich-text')
    assert.ok((core.primaryContent?.body?.length ?? 0) >= 4_200)
    assert.match(core.primaryContent?.body ?? '', /Câu hỏi lớn/)
    assert.match(core.primaryContent?.body ?? '', /Khung học sâu: hiểu, quan sát và tự kiểm/)
    assert.match(core.primaryContent?.body ?? '', /Tình huống đã phân tích/)
    assert.match(core.primaryContent?.body ?? '', /Từ kiến thức đến một quyết định có thể kiểm chứng/)
    assert.match(core.primaryContent?.body ?? '', /Hiểu lầm thường gặp/)
    assert.match(core.primaryContent?.body ?? '', /Góc bằng chứng/)
    assert.match(core.primaryContent?.body ?? '', /Cổng an toàn/)
    assert.match(core.primaryContent?.body ?? '', /Mở tab \*\*Nội Dung\*\*/)
    assert.ok((core.memory?.takeaways.length ?? 0) >= 3)
    assert.equal(core.memory?.flashcards.length, 12)
    assert.ok(core.learningDesign)
    assert.equal(core.learningDesign?.cards.length, 12)
    assert.equal(new Set(core.learningDesign?.cards.map((card) => card.id)).size, 12)
    assert.ok(core.learningDesign?.cards.some((card) => card.title.startsWith('Ca thực tế:')))
    assert.ok(core.learningDesign?.cards.some((card) => card.kind === 'myth'))
    assert.ok(core.learningDesign?.cards.some((card) => card.kind === 'decision'))
    assert.ok(core.learningDesign?.cards.some((card) => card.kind === 'safety'))
    assert.ok((core.learningDesign?.microChecks.length ?? 0) >= 4)
    assert.equal(practice.type, 'Bài đọc')
    assert.equal(practice.primaryContent?.kind, 'rich-text')
    assert.ok((practice.primaryContent?.body?.length ?? 0) >= 1_300)
    assert.match(practice.primaryContent?.body ?? '', /Mẫu đầu ra để tự điền/)
    assert.match(practice.primaryContent?.body ?? '', /Ba câu tự kiểm/)
    assert.equal(Boolean(core.resources?.some((resource) => resource.kind === 'video')), false)
    assert.equal(Boolean(practice.resources?.some((resource) => resource.kind === 'video')), false)
    assert.equal(checkpoint.type, 'Quiz')
    assert.equal(checkpoint.completionPolicy?.mode, 'quiz-pass')
    assert.equal(checkpoint.quiz?.questions.length, 16)
    assert.equal(new Set(checkpoint.quiz?.questions.map((question) => question.id)).size, 16)
    assert.ok((checkpoint.quiz?.questions.filter((question) => question.kind === 'scenario').length ?? 0) >= 3)
    assert.equal(checkpoint.quiz?.publicSettings?.questionsPerAttempt, 8)
    assert.equal(checkpoint.quiz?.passPercent, 80)
    assert.ok(checkpoint.quiz?.questions.some((question) => question.mustPass))
    checkpoint.quiz?.questions.forEach((question) => {
      assert.equal(question.options.length, 3)
      assert.ok(Number.isInteger(question.correctIndex))
      assert.ok((question.correctIndex ?? -1) >= 0 && (question.correctIndex ?? 3) < question.options.length)
    })
  }
})

test('medical chapter keeps the education and referral boundary explicit', () => {
  const medicalModule = auraFoundationCourse.modules[16]
  const medicalCore = medicalModule.lessons[0]
  assert.match(medicalModule.title, /bệnh lý/i)
  assert.match(medicalCore.primaryContent?.body ?? '', /chỉ phục vụ giáo dục/i)
  assert.match(medicalCore.primaryContent?.body ?? '', /điều trị/i)
})

test('full handbook reader ships all 20 PDF chapters as bounded lazy-loaded assets', () => {
  const readerRoot = new URL('../public/academy/full-reader/', import.meta.url)
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', readerRoot), 'utf8')) as {
    schemaVersion: number
    chapters: Array<{ chapter: number; pageCount: number; wordCount: number; sourceSha256: string }>
  }
  assert.equal(manifest.schemaVersion, 1)
  assert.deepEqual(manifest.chapters.map((chapter) => chapter.chapter), Array.from({ length: 20 }, (_, index) => index + 1))
  assert.equal(manifest.chapters.reduce((total, chapter) => total + chapter.pageCount, 0), 1823)
  assert.ok(manifest.chapters.reduce((total, chapter) => total + chapter.wordCount, 0) > 400_000)

  manifest.chapters.forEach((chapter) => {
    const content = JSON.parse(readFileSync(new URL(`chapter-${String(chapter.chapter).padStart(2, '0')}.json`, readerRoot), 'utf8')) as {
      schemaVersion: number
      chapter: number
      pageCount: number
      sourceSha256: string
      pages: Array<{ number: number; blocks: Array<{ kind: string; text: string }> }>
    }
    assert.equal(content.schemaVersion, 1)
    assert.equal(content.chapter, chapter.chapter)
    assert.equal(content.pages.length, content.pageCount)
    assert.match(content.sourceSha256, /^[a-f0-9]{64}$/)
    assert.ok(content.pages.every((page, index) => page.number === index + 1 && page.blocks.length > 0))
    assert.ok(content.pages.flatMap((page) => page.blocks).every((block) => ['heading', 'paragraph', 'bullet'].includes(block.kind) && block.text.trim()))
  })
})

test('focused lesson reader keeps searchable outlines and real pagination on every viewport', () => {
  const shellSource = readFileSync(new URL('../src/components/AppShell.tsx', import.meta.url), 'utf8')
  const courseContentSource = readFileSync(new URL('../src/utils/courseContent.ts', import.meta.url), 'utf8')
  const pageSource = readFileSync(new URL('../src/pages/student/CourseDetailPage.tsx', import.meta.url), 'utf8')
  const runtimeSource = readFileSync(new URL('../src/components/CourseLessonRuntime.tsx', import.meta.url), 'utf8')
  const academyStyles = readFileSync(new URL('../src/styles-academy.css', import.meta.url), 'utf8')
  const fullReaderSource = readFileSync(new URL('../src/components/academy/AcademyFullChapterReader.tsx', import.meta.url), 'utf8')

  assert.match(shellSource, /isImmersive[\s\S]*view === 'course-detail'/)
  assert.match(courseContentSource, /buildAuraReaderDemoModules/)
  assert.match(courseContentSource, /auraReaderChapterTitles\.map/)
  assert.match(pageSource, /const navigationLessons = useMemo/)
  assert.match(pageSource, /lazy\(\(\) => import\('\.\.\/\.\.\/components\/academy\/AcademyChapterLearningStudio'\)\)/)
  assert.match(pageSource, /\$\{modules\.length\} chương toàn văn/)
  assert.match(pageSource, /className="course-reader-outline"/)
  assert.match(pageSource, /className="course-reader-search"/)
  assert.match(pageSource, /className="course-reader-outline__chapter-copy"/)
  assert.match(pageSource, /onOpenResources=\{\(\) => setReaderView\('resources'\)\}/)
  assert.match(pageSource, /Nội Dung/)
  assert.match(pageSource, /Nội Dung[\s\S]*Học cùng Aura/)
  assert.doesNotMatch(pageSource, /Ghi nhớ sâu|Thảo luận đang hoàn thiện|AI Tổng hợp/)
  assert.match(runtimeSource, /className="academy-article-outline"/)
  assert.match(runtimeSource, /className="academy-handbook-callout"/)
  assert.match(academyStyles, /\.course-reader-layout \{[^}]*grid-template-columns: 292px minmax\(0, 1fr\)/)
  assert.match(academyStyles, /@media \(max-width: 1080px\)[\s\S]*?\.course-reader-outline \{ display: none; \}[\s\S]*?\.course-reader-outline-button \{ display: inline-flex; \}/)
  assert.match(academyStyles, /\.course-reader-page \.mobile-lesson-sheet-backdrop \{[^}]*display: flex;/)
  assert.match(fullReaderSource, /\/academy\/full-reader\/chapter-/)
  assert.match(fullReaderSource, /className="academy-full-reader__outline-panel"/)
  assert.match(fullReaderSource, /className="academy-full-reader__pagination"/)
  assert.match(fullReaderSource, /const visiblePages = \[availablePages\[currentPage - 1\]/)
  assert.doesNotMatch(fullReaderSource, /IntersectionObserver/)
})

test('private PDF reader supports mobile pagination without exposing a redundant content tab', () => {
  const pageSource = readFileSync(new URL('../src/pages/student/CourseDetailPage.tsx', import.meta.url), 'utf8')
  const studioSource = readFileSync(new URL('../src/components/academy/AcademyChapterLearningStudio.tsx', import.meta.url), 'utf8')
  const runtimeSource = readFileSync(new URL('../src/components/CourseLessonRuntime.tsx', import.meta.url), 'utf8')
  const mobileStyles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
  const cors = JSON.parse(readFileSync(new URL('../storage.cors.json', import.meta.url), 'utf8')) as Array<{
    origin: string[]
    method: string[]
    responseHeader: string[]
  }>

  assert.match(runtimeSource, /import\('pdfjs-dist'\)/)
  assert.match(runtimeSource, /goToPage\(pageNumber \+ 1\)/)
  assert.match(runtimeSource, /horizontalPadding/)
  assert.doesNotMatch(runtimeSource, /lesson-pdf-reader__frame|pdfViewerUrl/)
  assert.doesNotMatch(runtimeSource, /onBackToContent/)
  assert.match(pageSource, /selectedLesson\?\.resources\?\.length \? <button[^>]*role="tab"[\s\S]*?Nội Dung/)
  assert.match(pageSource, /\(!selectedPdfResource \|\| isAuraNutritionCurriculum\) \? <button[^>]*role="tab"[\s\S]*?Học cùng Aura/)
  assert.doesNotMatch(studioSource, /id: 'reader'|Toàn văn|shortLabel: 'Đọc'/)
  assert.match(mobileStyles, /\.lesson-pdf-reader__stage \{ padding: 0;/)
  assert.ok(cors[0]?.origin.includes('https://dinh-duong-aura.vercel.app'))
  assert.ok(cors[0]?.method.includes('GET'))
  assert.ok(cors[0]?.responseHeader.includes('Range'))
})

test('Academy practice sync detects device conflicts and sharing stays explicit', () => {
  const learningService = readFileSync(new URL('../src/services/academyLearningService.ts', import.meta.url), 'utf8')
  const learningStudio = readFileSync(new URL('../src/components/academy/AcademyChapterLearningStudio.tsx', import.meta.url), 'utf8')
  const firestoreRules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')

  assert.match(learningService, /runTransaction\(firestoreDb/)
  assert.match(learningService, /remoteRevision !== state\.cloudRevision/)
  assert.match(learningService, /AcademyWorkbookConflictError/)
  assert.match(learningService, /definitionVersion: number/)
  assert.match(learningStudio, /Có bản mới từ thiết bị khác/)
  assert.match(learningStudio, /Chia sẻ bài thực hành với coach phụ trách/)
  assert.match(firestoreRules, /request\.resource\.data\.revision == resource\.data\.revision \+ 1/)
  assert.match(firestoreRules, /resource\.data\.sharedWithCoach == true && coachOwnsClient\(userId\)/)
})

test('Academy review queue includes only previously reviewed cards that are due', () => {
  const firstLesson = auraFoundationCourse.modules[0].lessons[0]
  const secondLesson = auraFoundationCourse.modules[1].lessons[0]
  const dueCard = firstLesson.memory?.flashcards[0]
  const futureCard = secondLesson.memory?.flashcards[0]
  assert.ok(dueCard)
  assert.ok(futureCard)
  const now = Date.UTC(2026, 8, 6, 9)
  const state: AcademyReviewState = {
    version: 1,
    cards: {
      [`${firstLesson.id}:${dueCard.id}`]: {
        lessonId: firstLesson.id,
        cardId: dueCard.id,
        rating: 'hard',
        repetitions: 1,
        intervalDays: 1,
        reviewedAt: now - 2 * 86_400_000,
        dueAt: now - 86_400_000,
      },
      [`${secondLesson.id}:${futureCard.id}`]: {
        lessonId: secondLesson.id,
        cardId: futureCard.id,
        rating: 'good',
        repetitions: 1,
        intervalDays: 1,
        reviewedAt: now,
        dueAt: now + 86_400_000,
      },
    },
  }

  const queue = getDueAcademyReviewCards([
    {
      lessonId: secondLesson.id,
      lessonTitle: secondLesson.title,
      chapterLabel: 'Chương 2',
      cards: secondLesson.memory?.flashcards ?? [],
    },
    {
      lessonId: firstLesson.id,
      lessonTitle: firstLesson.title,
      chapterLabel: 'Chương 1',
      cards: firstLesson.memory?.flashcards ?? [],
    },
  ], state, now)
  assert.deepEqual(queue.map((item) => `${item.lessonId}:${item.id}`), [`${firstLesson.id}:${dueCard.id}`])
})

test('Academy portfolio creates four capstones without treating incomplete chapter drafts as finished', () => {
  const newWorkbook = (): AcademyWorkbookState => ({
    schemaVersion: 2,
    definitionVersion: 1,
    cloudRevision: 0,
    sharedWithCoach: false,
    answers: {},
    challengeDone: {},
    microCheckAnswers: {},
    confidenceBefore: null,
    confidenceAfter: null,
    rubric: { data: 0, mechanism: 0, feasibility: 0, safety: 0 },
    decision: null,
    reviewAt: '',
    safetyAcknowledged: false,
    updatedAt: 0,
  })
  assert.deepEqual(academyPortfolioStages.map((stage) => stage.milestoneChapter), [5, 10, 15, 20])
  assert.deepEqual(academyPortfolioStages.map((stage) => stage.chapterRange), [[1, 5], [6, 10], [11, 15], [16, 20]])
  assert.equal(getAcademyPortfolioStage(4), null)
  assert.equal(getAcademyPortfolioStage(20)?.title, 'Hệ điều hành dinh dưỡng 1.0')

  const fieldIds = academyPortfolioStages.flatMap((stage) => stage.fields.map((field) => `${stage.id}:${field.id}`))
  assert.equal(new Set(fieldIds).size, fieldIds.length)
  assert.ok(academyPortfolioStages.every((stage) => stage.fields.length >= 6))

  const practice = newWorkbook()
  assert.equal(isAcademyPracticeArtifactComplete(practice), false)
  practice.answers = Object.fromEntries(['context', 'hypothesis', 'action', 'minimum', 'data', 'stop'].map((key) => [key, 'Đã có dữ liệu']))
  practice.reviewAt = '2026-09-20'
  practice.safetyAcknowledged = true
  assert.equal(isAcademyPracticeArtifactComplete(practice), true)

  const finalStage = academyPortfolioStages[3]
  const portfolio = newWorkbook()
  portfolio.answers = Object.fromEntries(finalStage.fields.map((field) => [field.id, 'Nội dung đã tổng hợp']))
  portfolio.reviewAt = '2026-10-01'
  portfolio.safetyAcknowledged = true
  portfolio.rubric = { data: 2, mechanism: 2, feasibility: 1, safety: 1 }
  assert.equal(isAcademyPortfolioComplete(finalStage, portfolio), true)
  portfolio.rubric.safety = 0
  assert.equal(isAcademyPortfolioComplete(finalStage, portfolio), false)

  const studioSource = readFileSync(new URL('../src/components/academy/AcademyChapterLearningStudio.tsx', import.meta.url), 'utf8')
  const portfolioSource = readFileSync(new URL('../src/components/academy/AcademyPortfolioStudio.tsx', import.meta.url), 'utf8')
  assert.match(studioSource, /lazy\(\(\) => import\('\.\/AcademyPortfolioStudio'\)\)/)
  assert.match(portfolioSource, /Portfolio chặng/)
  assert.match(portfolioSource, /Chia sẻ portfolio với coach phụ trách/)
  assert.match(portfolioSource, /loadAcademyWorkbookFromCloud/)
  assert.match(portfolioSource, /AcademyWorkbookConflictError/)
})
