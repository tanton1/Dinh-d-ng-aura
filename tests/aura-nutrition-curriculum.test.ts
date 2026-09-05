import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { auraFoundationCourse } from '../src/course-template'
import { auraNutritionCurriculumStats, auraNutritionPhases } from '../src/data/auraNutritionCurriculum'
import { getDueAcademyReviewCards } from '../src/features/academy/reviewQueue'
import type { AcademyReviewState } from '../src/services/academyLearningService'

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
    assert.match(core.primaryContent?.body ?? '', /Mở tab \*\*Tài liệu\*\*/)
    assert.ok((core.memory?.takeaways.length ?? 0) >= 3)
    assert.ok((core.memory?.flashcards.length ?? 0) >= 6)
    assert.ok(core.learningDesign)
    assert.ok((core.learningDesign?.cards.length ?? 0) >= 6)
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
    assert.equal(checkpoint.quiz?.questions.length, 12)
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
  assert.match(pageSource, /\$\{modules\.length\} chương toàn văn/)
  assert.match(pageSource, /className="course-reader-outline"/)
  assert.match(pageSource, /className="course-reader-search"/)
  assert.match(pageSource, /onOpenResources=\{\(\) => setReaderView\('resources'\)\}/)
  assert.match(pageSource, /PDF gốc/)
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
  assert.match(pageSource, /\(!selectedPdfResource \|\| isAuraNutritionCurriculum\) \? <button[^>]*role="tab"[\s\S]*?Nội dung/)
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
