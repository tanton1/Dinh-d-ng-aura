import '../../styles-admin.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  FileQuestion,
  FileSpreadsheet,
  FileText,
  FileType,
  GripVertical,
  GitCompare,
  History,
  LoaderCircle,
  Play,
  PlusCircle,
  Plus,
  Save,
  Sparkles,
  ShieldCheck,
  X,
  Trash2,
  Undo2,
  Video,
} from 'lucide-react'
import { auraFoundationCourse } from '../../course-template'
import AcademyLessonMemoryEditor from '../../components/academy/AcademyLessonMemoryEditor'
import CourseEditorSidebar from '../../components/admin/CourseEditorSidebar'
import CourseEditorValidationPanel, { type CourseEditorValidationIssue } from '../../components/admin/CourseEditorValidationPanel'
import {
  getAcademyCoachNote,
  getAcademyLessonContent,
  hasAcademyLessonContent,
  toAcademyLessonMemory,
  type AcademyLessonContent,
} from '../../services/academyLearningService'
import {
  getCourseRevisionDiff,
  getCourseRevisionHistory,
  loadCourseQuizAnswerKeys,
  restoreCourseRevisionToDraft,
  transitionCoursePublicationStatus,
  uploadCourseMedia,
  uploadCourseCover,
  type CourseRevisionDiff,
  type CourseRevisionSummary,
} from '../../services/firebaseService'
import { generateCourseMemory, generateCourseOutline, generateCourseQuiz } from '../../services/generativeAiService'
import type {
  CourseDraftInput,
  CourseQuizAnswerKeys,
  CourseLessonDraft,
  CourseLessonType,
  LessonQuizDraft,
  LessonResourceDraft,
  LessonResourceKind,
  ViewId,
} from '../../types'

type SaveMode = 'draft' | 'review'
type CourseSaveResult = { courseId: string; revision: number }
type CourseUndoState = {
  message: string
  restore: (current: CourseDraftInput) => CourseDraftInput
}

interface CourseEditorPageProps {
  onNavigate: (view: ViewId) => void
  onSave?: (course: CourseDraftInput) => Promise<void | CourseSaveResult>
  onDirtyChange?: (dirty: boolean) => void
  canPublish?: boolean
  initialCourse?: CourseDraftInput
  saveTarget?: 'firebase' | 'demo'
}

const steps = ['Thông tin cơ bản', 'Nội dung khóa học', 'Thiết lập', 'Kiểm tra & xuất bản']
const lessonIcons: Record<string, typeof Video> = { Video, 'Bài đọc': FileText, Quiz: FileQuestion }
const lessonTypes: CourseLessonType[] = ['Video', 'Bài đọc', 'Quiz']
const resourceTypeLabels: Record<LessonResourceKind, string> = {
  slide: 'Slide',
  video: 'Video',
  document: 'Tài liệu',
}
const resourceTypeHints: Record<LessonResourceKind, string> = {
  slide: 'URL slide / link Google Slide',
  video: 'URL video (YouTube, Vimeo, URL trực tiếp...)',
  document: 'URL tài liệu (PDF, Google Docs...)',
}
const resourceIcon = {
  slide: FileSpreadsheet,
  video: Video,
  document: FileType,
}
function resourceTypeIcon(kind: LessonResourceKind) {
  const Icon = resourceIcon[kind]
  return <Icon size={14} />
}
const defaultResourceKind: LessonResourceKind = 'video'

function createDefaultQuiz(): LessonQuizDraft {
  return {
    id: `quiz-${crypto.randomUUID()}`,
    passPercent: 70,
    questionOrder: 'sequential',
    publicSettings: { maxAttempts: 3, revealMode: 'after-submit' },
    questions: [{
      id: `question-${crypto.randomUUID()}`,
      question: '',
      options: ['', ''],
      correctIndex: 0,
    }],
  }
}

function defaultCompletionPolicy(type: CourseLessonType): NonNullable<CourseLessonDraft['completionPolicy']> {
  if (type === 'Quiz') return { mode: 'quiz-pass' }
  if (type === 'Video') return { mode: 'media-progress', thresholdPercent: 80 }
  return { mode: 'manual' }
}

function ensureLessonMeta(lesson: CourseLessonDraft): CourseLessonDraft {
  const normalized = { ...lesson }
  delete normalized.workoutRef
  const type: CourseLessonType = lesson.type === 'Buổi tập' ? 'Bài đọc' : lesson.type
  const tags = lesson.tags ?? []
  const resources = lesson.resources ?? []
  const academyContent = getAcademyLessonContent(lesson)
  const memory = lesson.memory ?? (hasAcademyLessonContent(academyContent) ? toAcademyLessonMemory(academyContent) : undefined)
  const completionPolicy = type === 'Quiz'
    ? defaultCompletionPolicy(type)
    : !lesson.completionPolicy || lesson.completionPolicy.mode === 'workout-complete'
      ? defaultCompletionPolicy(type)
      : lesson.completionPolicy
  const primaryContent = lesson.primaryContent?.kind === 'workout'
    ? resources[0] ? { kind: 'resource' as const, resourceId: resources[0].id } : { kind: 'rich-text' as const, body: lesson.summary ?? '' }
    : lesson.primaryContent ?? (resources[0] ? { kind: 'resource' as const, resourceId: resources[0].id } : undefined)
  return {
    ...normalized,
    type,
    tags,
    resources,
    coachNotes: getAcademyCoachNote(lesson),
    ...(memory ? { memory } : {}),
    completionPolicy,
    primaryContent,
    quiz: type === 'Quiz'
      ? lesson.quiz ?? createDefaultQuiz()
      : lesson.quiz,
  }
}

function hydrateQuizAnswers(course: CourseDraftInput, keys: CourseQuizAnswerKeys): CourseDraftInput {
  return {
    ...course,
    quizAnswerKeys: keys,
    modules: course.modules.map((module) => ({
      ...module,
      lessons: module.lessons.map((lesson) => ({
        ...lesson,
        quiz: lesson.quiz
          ? {
              ...lesson.quiz,
              questions: lesson.quiz.questions.map((question) => ({
                ...question,
                correctIndex: keys[lesson.id]?.[question.id]?.[0] ?? question.correctIndex,
              })),
            }
          : undefined,
      })),
    })),
  }
}

function createEditorDraft(initialCourse?: CourseDraftInput): CourseDraftInput {
  if (initialCourse) {
    const normalizedCourse = structuredClone(initialCourse)
    const editorCourse = {
      ...normalizedCourse,
      schemaVersion: 2 as const,
      modules: normalizedCourse.modules.map((module) => ({
        ...module,
        lessons: module.lessons.map((lesson) => ensureLessonMeta(lesson)),
      })),
    }
    return normalizedCourse.quizAnswerKeys
      ? hydrateQuizAnswers(editorCourse, normalizedCourse.quizAnswerKeys)
      : editorCourse
  }
  const uniqueId = crypto.randomUUID()
  return {
    ...structuredClone(auraFoundationCourse),
    id: `course-${uniqueId}`,
    schemaVersion: 2,
    slug: `khoa-hoc-moi-${uniqueId.slice(0, 8)}`,
    title: 'Khóa học mới',
    description: '',
    outcomes: [],
    requirements: [],
    modules: [{
      id: `module-${crypto.randomUUID()}`,
      order: 1,
      title: 'Chương 1',
      lessons: [],
    }],
    publicationStatus: 'draft',
  }
}

const publicationLabels = {
  draft: 'Bản nháp',
  review: 'Đang chờ duyệt',
  approved: 'Đã duyệt',
  scheduled: 'Đã lên lịch',
  published: 'Đã xuất bản',
  archived: 'Đã lưu trữ',
} as const

function formatRevisionDiffValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    const serialized = JSON.stringify(value)
    return serialized.length > 240 ? `${serialized.slice(0, 237)}...` : serialized
  } catch {
    return '[Dữ liệu phức hợp]'
  }
}

export default function CourseEditorPage({ onNavigate, onSave, onDirtyChange, canPublish = false, initialCourse, saveTarget = 'firebase' }: CourseEditorPageProps) {
  const [activeStep, setActiveStep] = useState(1)
  const [course, setCourse] = useState<CourseDraftInput>(() => createEditorDraft(initialCourse))
  const lastSavedSnapshot = useRef(JSON.stringify(course))
  const [saving, setSaving] = useState(false)
  const [savedMode, setSavedMode] = useState<SaveMode | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [detailLessonModuleIndex, setDetailLessonModuleIndex] = useState(0)
  const [detailLessonIndex, setDetailLessonIndex] = useState(0)
  const [mediaUploads, setMediaUploads] = useState<Record<string, { progress: number; error?: string }>>({})
  const [coverUploading, setCoverUploading] = useState(false)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const [validationRequested, setValidationRequested] = useState(false)
  const [undoState, setUndoState] = useState<CourseUndoState | null>(null)
  const undoTimeoutRef = useRef<number | null>(null)
  
  const [generatingOutline, setGeneratingOutline] = useState(false)
  const [generatingQuiz, setGeneratingQuiz] = useState(false)
  const [generatingMemory, setGeneratingMemory] = useState(false)
  const [workflowBusy, setWorkflowBusy] = useState(false)
  const [revisionHistory, setRevisionHistory] = useState<CourseRevisionSummary[]>([])
  const [revisionLoading, setRevisionLoading] = useState(false)
  const [revisionError, setRevisionError] = useState<string | null>(null)
  const [revisionDiff, setRevisionDiff] = useState<CourseRevisionDiff | null>(null)
  const [comparingRevision, setComparingRevision] = useState<number | null>(null)

  const isContentLocked = ['approved', 'scheduled', 'published', 'archived'].includes(course.publicationStatus)

  useEffect(() => {
    if (saveTarget !== 'firebase' || !Number.isInteger(course.revision) || (course.revision ?? 0) < 1) {
      setRevisionHistory([])
      return
    }
    let active = true
    setRevisionLoading(true)
    setRevisionError(null)
    void getCourseRevisionHistory(course.id)
      .then((items) => {
        if (active) setRevisionHistory(items)
      })
      .catch((error) => {
        if (active) setRevisionError(error instanceof Error ? error.message : 'Chưa thể tải lịch sử phiên bản.')
      })
      .finally(() => {
        if (active) setRevisionLoading(false)
      })
    return () => { active = false }
  }, [course.id, course.revision, saveTarget])

  const handleGenerateOutline = async () => {
    if (!course.title) {
      alert("Vui lòng nhập tên khóa học ở Bước 1 trước khi tự động lên sườn.");
      return;
    }
    if (course.modules.length > 0) {
      if (!window.confirm("Khóa học đã có chương. Việc tạo tự động có thể sẽ xóa hoặc ghi đè nội dung. Bạn có chắc chắn muốn tiếp tục?")) return;
    }
    try {
      setGeneratingOutline(true);
      const data = await generateCourseOutline({
        topic: course.title,
        audience: course.description || course.outcomes.join(', '),
        weeks: Number.parseInt(course.duration, 10) || 4,
      });
      if (data && data.modules) {
        setCourse((c) => ({
          ...c,
          modules: data.modules.map((m: any, i: number) => ({
            id: 'module-' + crypto.randomUUID(),
            title: m.title,
            order: i,
            lessons: m.lessons.map((l: any, j: number) => ({
              id: 'lesson-' + crypto.randomUUID(),
              type: "Video",
              title: l.title,
              duration: "5 phút",
              preview: false,
              summary: l.summary,
            }))
          }))
        }));
      }
    } catch (e) {
      alert("Có lỗi xảy ra khi gọi AI.");
    } finally {
      setGeneratingOutline(false);
    }
  }

  const handleGenerateQuiz = async () => {
    const detailLesson = course.modules[detailLessonModuleIndex]?.lessons[detailLessonIndex]
    if (!detailLesson) return;
    try {
      setGeneratingQuiz(true);
      const data = await generateCourseQuiz({
        lessonTitle: detailLesson.title,
        lessonSummary: detailLesson.summary || detailLesson.coachNotes || course.title,
      });
      if (data && data.questions) {
        setCourse((c) => {
          const newCourse = { ...c };
          const mod = newCourse.modules[detailLessonModuleIndex];
          const les = mod.lessons[detailLessonIndex];
          if (!les.quiz) {
            les.quiz = { id: crypto.randomUUID(),
              questionOrder: 'sequential',
              passPercent: 70,
              publicSettings: { maxAttempts: 3, revealMode: 'after-submit' },
              questions: []
            };
          }
          les.quiz!.questions = [
            ...(les.quiz!.questions || []),
            ...data.questions.map((q: any) => ({
              id: 'quiz-' + crypto.randomUUID(),
              question: q.question,
              options: q.options,
              correctIndex: q.correctIndex,
              explanation: q.explanation
            }))
          ];
          return newCourse;
        });
      }
    } catch (e) {
      alert("Có lỗi xảy ra khi gọi AI Quiz.");
    } finally {
      setGeneratingQuiz(false);
    }
  }

  const handleGenerateMemory = async () => {
    const detailLesson = course.modules[detailLessonModuleIndex]?.lessons[detailLessonIndex]
    if (!detailLesson) return;
    try {
      setGeneratingMemory(true);
      const data = await generateCourseMemory({
        lessonTitle: detailLesson.title,
        lessonSummary: detailLesson.summary || detailLesson.coachNotes || course.title,
      });
      if (data) {
        setCourse((c) => {
          const newCourse = { ...c };
          const mod = newCourse.modules[detailLessonModuleIndex];
          const les = mod.lessons[detailLessonIndex];
          const existingContent = getAcademyLessonContent(les);
          
          const newContent = {
             minuteSummary: data.minuteSummary || existingContent.minuteSummary,
             keyTakeaways: [...(existingContent.keyTakeaways||[]), ...(data.keyTakeaways||[])],
             terms: [...(existingContent.terms||[]), ...(data.terms||[]).map((t:any) => ({ id: crypto.randomUUID(), term: t.term, definition: t.definition }))],
             recallPrompts: [...(existingContent.recallPrompts||[]), ...(data.recallPrompts||[]).map((r:any) => ({ id: crypto.randomUUID(), prompt: r.prompt, answer: r.answer }))],
             flashcards: [...(existingContent.flashcards||[]), ...(data.flashcards||[]).map((f:any) => ({ id: crypto.randomUUID(), front: f.front, back: f.back, hint: f.hint }))]
          };
          
          les.memory = toAcademyLessonMemory(newContent);
          return newCourse;
        });
      }
    } catch (e) {
      alert("Có lỗi xảy ra khi gọi AI Flashcard.");
    } finally {
      setGeneratingMemory(false);
    }
  }

  const isDirty = JSON.stringify(course) !== lastSavedSnapshot.current

  useEffect(() => {
    const nextCourse = createEditorDraft(initialCourse)
    setCourse(nextCourse)
    lastSavedSnapshot.current = JSON.stringify(nextCourse)
    setActiveStep(1)
    setSavedMode(null)
    setSaveError(null)
    setValidationRequested(false)
    setUndoState(null)
  }, [initialCourse?.id])

  useEffect(() => () => {
    if (undoTimeoutRef.current !== null) window.clearTimeout(undoTimeoutRef.current)
  }, [])

  useEffect(() => {
    if (!initialCourse?.id || saveTarget !== 'firebase') return
    let cancelled = false
    void loadCourseQuizAnswerKeys(initialCourse.id).then((keys) => {
      if (cancelled) return
      setCourse((current) => {
        if (current.id !== initialCourse.id) return current
        const wasClean = JSON.stringify(current) === lastSavedSnapshot.current
        const hydrated = hydrateQuizAnswers(current, keys)
        if (wasClean) lastSavedSnapshot.current = JSON.stringify(hydrated)
        return hydrated
      })
    }).catch(() => {
      // Legacy projects may not have quizKeys yet. The editor keeps legacy answers until the next save.
    })
    return () => { cancelled = true }
  }, [initialCourse?.id, saveTarget])

  useEffect(() => {
    const firstModule = course.modules[0]
    if (!firstModule || !firstModule.lessons.length) {
      setDetailLessonModuleIndex(0)
      setDetailLessonIndex(0)
      return
    }
    const moduleIndex = Math.min(detailLessonModuleIndex, course.modules.length - 1)
    const lessonLength = (course.modules[moduleIndex]?.lessons.length ?? 0)
    const lessonIndex = Math.min(detailLessonIndex, lessonLength - 1)
    setDetailLessonModuleIndex(moduleIndex)
    setDetailLessonIndex(Math.max(0, lessonIndex))
  }, [course.modules.length, course.modules.flatMap((module) => module.lessons.length).join(',')])

  useEffect(() => {
    const warnAboutUnsavedChanges = (event: BeforeUnloadEvent) => {
      if (!isDirty) return
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', warnAboutUnsavedChanges)
    return () => window.removeEventListener('beforeunload', warnAboutUnsavedChanges)
  }, [isDirty])

  useEffect(() => {
    onDirtyChange?.(isDirty)
    return () => onDirtyChange?.(false)
  }, [isDirty, onDirtyChange])

  const lessonTotal = useMemo(
    () => course.modules.reduce((total, module) => total + module.lessons.length, 0),
    [course.modules],
  )
  const contentIssues = useMemo(() => course.modules.flatMap((module) => module.lessons.flatMap((lesson) => {
    const label = `${module.title || 'Chương'} / ${lesson.title || 'Bài học'}`
    const issues: string[] = []
    const resources = lesson.resources ?? []
    const validResources = resources.filter((resource) => Boolean(
      resource.title.trim()
      && (resource.assetRef?.status === 'ready' && resource.assetRef.storagePath.trim() || /^https?:\/\//i.test(resource.url.trim()) || resource.url.trim().startsWith('/')),
    ))
    const requiresPrivateDelivery = course.settings.accessTier === 'pro' || course.settings.visibility === 'private'
    if (requiresPrivateDelivery && resources.some((resource) => resource.assetRef?.status !== 'ready')) {
      issues.push(`${label}: khóa Pro/riêng tư phải tải học liệu lên Firebase thay vì dùng URL ngoài.`)
    }
    if (resources.length !== validResources.length) issues.push(`${label}: học liệu thiếu tên hoặc nguồn hợp lệ.`)

    if (lesson.type === 'Video' && !validResources.some((resource) => resource.kind === 'video')) {
      issues.push(`${label}: bài Video cần ít nhất một video hợp lệ.`)
    }
    if (lesson.type === 'Bài đọc') {
      const hasReadableBody = Boolean(
        lesson.summary?.trim()
          || (lesson.primaryContent?.kind === 'rich-text' && lesson.primaryContent.body?.trim()),
      )
      if (!hasReadableBody && !validResources.length) {
        issues.push(`${label}: bài đọc cần mô tả, nội dung bài viết hoặc ít nhất một học liệu hợp lệ.`)
      }
    }
    if (lesson.primaryContent?.kind === 'resource'
        && !validResources.some((resource) => resource.id === lesson.primaryContent?.resourceId)) {
      issues.push(`${label}: học liệu chính không còn hợp lệ.`)
    }

    const policy = lesson.completionPolicy ?? defaultCompletionPolicy(lesson.type)
    if (policy.mode === 'media-progress') {
      const threshold = policy.thresholdPercent ?? 80
      const primaryId = lesson.primaryContent?.resourceId
      const primaryResource = validResources.find((resource) => resource.id === primaryId)
      if (!primaryId || !primaryResource) issues.push(`${label}: chưa chọn media chính.`)
      if (primaryResource && primaryResource.kind !== 'video') issues.push(`${label}: theo dõi tiến độ media hiện chỉ hỗ trợ video.`)
      if (primaryResource
          && !primaryResource.assetRef
          && !/\.(mp4|webm|ogg)(?:$|[?#])/i.test(primaryResource.url.trim())) {
        issues.push(`${label}: URL video nhúng không đo được tiến độ; hãy tải video lên Firebase hoặc chọn hoàn thành thủ công.`)
      }
      if (threshold < 1 || threshold > 100) issues.push(`${label}: ngưỡng xem media phải từ 1–100%.`)
    }
    if (lesson.type === 'Quiz') {
      if (policy.mode !== 'quiz-pass') issues.push(`${label}: bài Quiz phải dùng điều kiện đạt bài quiz.`)
      if (!lesson.quiz?.questions.length) issues.push(`${label}: quiz chưa có câu hỏi.`)
      lesson.quiz?.questions.forEach((question, index) => {
        const correctIndex = course.quizAnswerKeys?.[lesson.id]?.[question.id]?.[0] ?? question.correctIndex
        if (!question.question.trim() || question.options.length < 2 || question.options.some((option) => !option.trim())) {
          issues.push(`${label}: câu hỏi ${index + 1} chưa hoàn thiện.`)
        } else if (typeof correctIndex !== 'number' || correctIndex < 0 || correctIndex >= question.options.length) {
          issues.push(`${label}: câu hỏi ${index + 1} chưa có đáp án đúng.`)
        }
      })
    }
    return issues
  })), [course])
    const curriculumReady = course.modules.length > 0
    && course.modules.every((module) => module.title.trim()
      && module.title.trim() !== 'Chương mới'
      && module.lessons.length > 0
      && module.lessons.every((lesson) => lesson.title.trim()
        && lesson.title.trim() !== 'Bài học mới'
        && lesson.duration.trim()))
  const settingsReady = (course.settings.accessTier === 'free' || course.settings.accessTier === 'pro')
    && (course.settings.visibility === 'members' || course.settings.visibility === 'private')
    && (course.settings.dripSchedule === 'none' || course.settings.dripSchedule === 'weekly')
    && Number.isInteger(course.settings.completionPercent)
    && course.settings.completionPercent >= 50
    && course.settings.completionPercent <= 100
  const basicsReady = Boolean(
    course.title.trim()
      && course.slug.trim()
      && course.description.trim()
      && course.category.trim()
      && course.level.trim()
      && course.coach.trim()
      && course.duration.trim()
      && course.outcomes.length > 0
      && course.requirements.length > 0
  )
  const contentReady = contentIssues.length === 0
  const isReady = Boolean(
    basicsReady
      && curriculumReady
      && lessonTotal >= 6
      && settingsReady
      && contentReady
  )
  const completeness = Math.round(([
    course.title,
    course.slug,
    course.description,
    course.category,
    course.level,
    course.coach,
    course.duration,
    curriculumReady,
    lessonTotal >= 6,
    course.outcomes.length > 0,
    course.requirements.length > 0,
    settingsReady,
    contentReady,
  ].filter(Boolean).length / 13) * 100)
  const validationIssues = useMemo<CourseEditorValidationIssue[]>(() => {
    const issues: CourseEditorValidationIssue[] = []
    const add = (issue: CourseEditorValidationIssue) => issues.push(issue)

    if (!course.title.trim()) add({ id: 'title', step: 1, label: 'Tên khóa học', detail: 'Nhập tên rõ ràng để học viên nhận biết khóa học.', targetId: 'course-title' })
    if (!course.slug.trim()) add({ id: 'slug', step: 1, label: 'Đường dẫn khóa học', detail: 'Slug là trường bắt buộc khi lưu và xuất bản.', targetId: 'course-slug' })
    if (!course.description.trim()) add({ id: 'description', step: 1, label: 'Mô tả khóa học', detail: 'Bổ sung giá trị và nội dung chính của khóa học.', targetId: 'course-description' })
    if (!course.category.trim()) add({ id: 'category', step: 1, label: 'Danh mục khóa học', detail: 'Chọn danh mục phù hợp để học viên tìm thấy khóa học.', targetId: 'course-category' })
    if (!course.level.trim()) add({ id: 'level', step: 1, label: 'Cấp độ khóa học', detail: 'Chọn cấp độ phù hợp với người học.', targetId: 'course-level' })
    if (!course.coach.trim()) add({ id: 'coach', step: 1, label: 'Giảng viên phụ trách', detail: 'Phân công người chịu trách nhiệm chuyên môn.', targetId: 'course-coach' })
    if (!course.duration.trim()) add({ id: 'duration', step: 1, label: 'Thời lượng khóa học', detail: 'Bổ sung thời lượng dự kiến của khóa học.', targetId: 'course-duration' })
    if (!course.outcomes.length) add({ id: 'outcomes', step: 1, label: 'Kết quả đầu ra', detail: 'Thêm ít nhất một kết quả học viên sẽ đạt được.', targetId: 'course-outcomes' })
    if (!course.requirements.length) add({ id: 'requirements', step: 1, label: 'Yêu cầu tham gia', detail: 'Thêm ít nhất một điều kiện hoặc ghi rõ không yêu cầu.', targetId: 'course-requirements' })
    if (!curriculumReady) add({ id: 'curriculum', step: 2, label: 'Cấu trúc chương và bài học', detail: 'Mỗi chương cần tên và ít nhất một bài có tên, thời lượng.', targetId: 'course-curriculum' })
    if (lessonTotal < 6) add({ id: 'lesson-count', step: 2, label: 'Tối thiểu 6 bài học', detail: `Hiện có ${lessonTotal}/6 bài học.`, targetId: 'course-curriculum' })
    contentIssues.slice(0, 6).forEach((detail, index) => add({ id: `content-${index}`, step: 2, label: 'Học liệu cần hoàn thiện', detail, targetId: 'course-lesson-detail' }))
    if (!settingsReady) add({ id: 'settings', step: 3, label: 'Thiết lập hoàn thành', detail: 'Kiểm tra gói, hiển thị, lịch mở và ngưỡng hoàn thành 50–100%.', targetId: 'course-settings' })
    return issues
  }, [contentIssues, course.category, course.coach, course.description, course.duration, course.level, course.outcomes.length, course.requirements.length, course.slug, course.title, curriculumReady, lessonTotal, settingsReady])
  const detailModule = course.modules[detailLessonModuleIndex]
  const detailLesson = detailModule?.lessons[detailLessonIndex]
  const detailAcademyContent = getAcademyLessonContent(detailLesson)

  const updateField = <K extends keyof CourseDraftInput>(key: K, value: CourseDraftInput[K]) => {
    setSaveError(null)
    setCourse((current) => ({ ...current, [key]: value }))
  }

  const openValidationIssue = (issue: CourseEditorValidationIssue) => {
    setValidationRequested(true)
    setActiveStep(issue.step)
    window.setTimeout(() => {
      const target = issue.targetId ? document.getElementById(issue.targetId) : null
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) target.focus()
    }, 80)
  }

  const rememberUndo = (message: string, restore: CourseUndoState['restore']) => {
    setUndoState({ message, restore })
    if (undoTimeoutRef.current !== null) window.clearTimeout(undoTimeoutRef.current)
    undoTimeoutRef.current = window.setTimeout(() => setUndoState(null), 6500)
  }

  const restoreUndo = () => {
    if (!undoState) return
    setCourse((current) => undoState.restore(current))
    setUndoState(null)
    if (undoTimeoutRef.current !== null) window.clearTimeout(undoTimeoutRef.current)
  }

  const updateModule = (moduleIndex: number, values: Partial<CourseDraftInput['modules'][number]>) => {
    setCourse((current) => ({
      ...current,
      modules: current.modules.map((module, index) => index === moduleIndex ? { ...module, ...values } : module),
    }))
  }

  const updateLesson = (
    moduleIndex: number,
    lessonIndex: number,
    values: Partial<CourseLessonDraft>,
  ) => {
    setCourse((current) => ({
      ...current,
      modules: current.modules.map((module, index) => index === moduleIndex
        ? { ...module, lessons: module.lessons.map((item, position) => {
          if (position !== lessonIndex) return item
          const nextLesson = { ...item, ...values }
          return ensureLessonMeta(nextLesson)
        }) }
        : module),
    }))
  }

  const updateLessonType = (moduleIndex: number, lessonIndex: number, type: CourseLessonType) => {
    updateLesson(moduleIndex, lessonIndex, {
      type,
      quiz: type === 'Quiz' ? createDefaultQuiz() : undefined,
      completionPolicy: defaultCompletionPolicy(type),
      workoutRef: undefined,
    })
  }

  const updateAcademyContent = (content: AcademyLessonContent) => {
    if (!detailLesson) return
    updateLesson(detailLessonModuleIndex, detailLessonIndex, {
      coachNotes: getAcademyCoachNote(detailLesson),
      memory: toAcademyLessonMemory(content),
    })
  }

  const updateInstructorNote = (coachNote: string) => {
    if (!detailLesson) return
    const academyContent = getAcademyLessonContent(detailLesson)
    updateLesson(detailLessonModuleIndex, detailLessonIndex, {
      coachNotes: coachNote,
      ...(hasAcademyLessonContent(academyContent) ? { memory: toAcademyLessonMemory(academyContent) } : {}),
    })
  }

  const updateLessonTags = (moduleIndex: number, lessonIndex: number, tagsRaw: string) => {
    const nextTags = tagsRaw
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
    updateLesson(moduleIndex, lessonIndex, { tags: nextTags })
  }

  const addLessonResource = (moduleIndex: number, lessonIndex: number) => {
    const newResource: LessonResourceDraft = {
      id: `resource-${crypto.randomUUID()}`,
      kind: defaultResourceKind,
      title: '',
      url: '',
      note: '',
    }
    const currentResources = course.modules[moduleIndex].lessons[lessonIndex].resources ?? []
    updateLesson(moduleIndex, lessonIndex, {
      resources: [...currentResources, newResource],
      ...(!currentResources.length ? { primaryContent: { kind: 'resource', resourceId: newResource.id } as const } : {}),
    })
  }

  const updateLessonResource = (
    moduleIndex: number,
    lessonIndex: number,
    resourceIndex: number,
    values: Partial<LessonResourceDraft>,
  ) => {
    const currentResources = course.modules[moduleIndex].lessons[lessonIndex].resources ?? []
    updateLesson(moduleIndex, lessonIndex, {
      resources: currentResources.map((resource, index) => index === resourceIndex
        ? ({
            ...resource,
            ...values,
            ...(values.kind && values.kind !== resource.kind ? { assetRef: undefined, url: '' } : {}),
          })
        : resource),
    })
  }

  const removeLessonResource = (moduleIndex: number, lessonIndex: number, resourceIndex: number) => {
    const currentLesson = course.modules[moduleIndex].lessons[lessonIndex]
    const currentResources = currentLesson.resources ?? []
    const removedResourceId = currentResources[resourceIndex]?.id
    const nextResources = currentResources.filter((_, index) => index !== resourceIndex)
    updateLesson(moduleIndex, lessonIndex, {
      resources: nextResources,
      ...(currentLesson.primaryContent?.resourceId === removedResourceId
        ? { primaryContent: nextResources[0] ? { kind: 'resource' as const, resourceId: nextResources[0].id } : undefined }
        : {}),
    })
  }

  const addQuizQuestion = (moduleIndex: number, lessonIndex: number) => {
    const quiz = course.modules[moduleIndex].lessons[lessonIndex].quiz ?? createDefaultQuiz()
    const nextQuestion = {
      id: `question-${crypto.randomUUID()}`,
      question: '',
      options: ['', ''],
      correctIndex: 0,
    }
    updateLesson(moduleIndex, lessonIndex, {
      quiz: {
        ...quiz,
        questions: [...quiz.questions, nextQuestion],
      },
    })
  }

  const updateQuizQuestion = (
    moduleIndex: number,
    lessonIndex: number,
    questionIndex: number,
    values: Partial<LessonQuizDraft['questions'][number]>,
  ) => {
    const currentLesson = course.modules[moduleIndex].lessons[lessonIndex]
    const quiz = currentLesson.quiz ?? createDefaultQuiz()
    const nextQuestions = quiz.questions.map((question, index) => {
      if (index !== questionIndex) return question
      return { ...question, ...values }
    })
    updateLesson(moduleIndex, lessonIndex, {
      quiz: {
        ...quiz,
        questions: nextQuestions,
      },
    })
  }

  const removeQuizQuestion = (moduleIndex: number, lessonIndex: number, questionIndex: number) => {
    const currentLesson = course.modules[moduleIndex].lessons[lessonIndex]
    const quiz = currentLesson.quiz ?? createDefaultQuiz()
    const nextQuestions = quiz.questions.filter((_, index) => index !== questionIndex)
    updateLesson(moduleIndex, lessonIndex, {
      quiz: {
        ...quiz,
        questions: nextQuestions.length ? nextQuestions : [{
          id: `question-${crypto.randomUUID()}`,
          question: '',
          options: ['', ''],
          correctIndex: 0,
        }],
      },
    })
  }

  const updateQuizOption = (
    moduleIndex: number,
    lessonIndex: number,
    questionIndex: number,
    optionIndex: number,
    value: string,
  ) => {
    const currentLesson = course.modules[moduleIndex].lessons[lessonIndex]
    const quiz = currentLesson.quiz ?? createDefaultQuiz()
    const nextQuestions = quiz.questions.map((question, qIndex) => {
      if (qIndex !== questionIndex) return question
      const nextOptions = question.options.map((option, index) => index === optionIndex ? value : option)
      return { ...question, options: nextOptions }
    })
    updateLesson(moduleIndex, lessonIndex, {
      quiz: {
        ...quiz,
        questions: nextQuestions,
      },
    })
  }

  const removeQuizOption = (
    moduleIndex: number,
    lessonIndex: number,
    questionIndex: number,
    optionIndex: number,
  ) => {
    const currentLesson = course.modules[moduleIndex].lessons[lessonIndex]
    const quiz = currentLesson.quiz ?? createDefaultQuiz()
    const nextQuestions = quiz.questions.map((question, qIndex) => {
      if (qIndex !== questionIndex) return question
      if (question.options.length <= 2) return question
      const nextOptions = question.options.filter((_, index) => index !== optionIndex)
      const currentCorrectIndex = question.correctIndex ?? 0
      const nextCorrectIndex = currentCorrectIndex === optionIndex
        ? 0
        : currentCorrectIndex > optionIndex
          ? currentCorrectIndex - 1
          : currentCorrectIndex
      return { ...question, options: nextOptions, correctIndex: nextCorrectIndex }
    })
    updateLesson(moduleIndex, lessonIndex, {
      quiz: {
        ...quiz,
        questions: nextQuestions,
      },
    })
  }

  const addModule = () => {
    setCourse((current) => ({
      ...current,
      modules: [...current.modules, {
        id: `module-${crypto.randomUUID()}`,
        order: current.modules.length + 1,
        title: 'Chương mới',
        lessons: [],
      }],
    }))
  }

  const removeModule = (moduleIndex: number) => {
    const module = course.modules[moduleIndex]
    if (!module || !window.confirm(`Xóa chương “${module.title || `Chương ${moduleIndex + 1}`}” và toàn bộ ${module.lessons.length} bài học bên trong?`)) return
    const removedModule = structuredClone(module)
    rememberUndo(`Đã xóa chương “${module.title || `Chương ${moduleIndex + 1}`}”.`, (current) => {
      if (current.modules.some((item) => item.id === removedModule.id)) return current
      const modules = [...current.modules]
      modules.splice(Math.min(moduleIndex, modules.length), 0, removedModule)
      return { ...current, modules: modules.map((item, index) => ({ ...item, order: index + 1 })) }
    })
    setCourse((current) => ({
      ...current,
      modules: current.modules
        .filter((_, index) => index !== moduleIndex)
        .map((module, index) => ({ ...module, order: index + 1 })),
    }))
  }

  const addLesson = (moduleIndex: number) => {
    setCourse((current) => ({
      ...current,
      modules: current.modules.map((module, index) => index === moduleIndex
        ? {
            ...module,
            lessons: [...module.lessons, {
              id: `lesson-${crypto.randomUUID()}`,
              title: 'Bài học mới',
              type: 'Video',
              duration: '5 phút',
              summary: '',
              tags: [],
              resources: [],
              coachNotes: '',
            }],
          }
        : module),
    }))
  }

  const removeLesson = (moduleIndex: number, lessonIndex: number) => {
    const lesson = course.modules[moduleIndex]?.lessons[lessonIndex]
    if (!lesson || !window.confirm(`Xóa bài học “${lesson.title || `Bài ${lessonIndex + 1}`}”?`)) return
    const moduleId = course.modules[moduleIndex].id
    const removedLesson = structuredClone(lesson)
    rememberUndo(`Đã xóa bài học “${lesson.title || `Bài ${lessonIndex + 1}`}”.`, (current) => ({
      ...current,
      modules: current.modules.map((module) => {
        if (module.id !== moduleId || module.lessons.some((item) => item.id === removedLesson.id)) return module
        const lessons = [...module.lessons]
        lessons.splice(Math.min(lessonIndex, lessons.length), 0, removedLesson)
        return { ...module, lessons }
      }),
    }))
    setCourse((current) => ({
      ...current,
      modules: current.modules.map((module, index) => index === moduleIndex
        ? { ...module, lessons: module.lessons.filter((_, position) => position !== lessonIndex) }
        : module),
    }))
  }

  const save = async (mode: SaveMode) => {
    if (isContentLocked) {
      setSaveError('Phiên bản này đã khóa nội dung. Hãy khôi phục một revision thành bản nháp mới nếu cần chỉnh sửa.')
      return
    }
    if (mode === 'review' && !isReady) {
      setValidationRequested(true)
      setActiveStep(4)
      if (contentIssues.length) {
        setSaveError(`Chưa thể xuất bản: ${contentIssues.slice(0, 3).join(' ')}`)
        return
      }
      setSaveError('Hãy hoàn thiện thông tin, kết quả, yêu cầu, thiết lập hoàn thành 50–100% và ít nhất 6 bài học có tiêu đề/thời lượng cụ thể trước khi gửi duyệt hoặc xuất bản. Bạn vẫn có thể lưu bản nháp chưa hoàn thiện.')
      return
    }
    const publicationStatus = mode === 'review'
      ? 'review'
      : course.publicationStatus === 'review'
        ? 'review'
        : 'draft'
    const nextCourse: CourseDraftInput = {
      ...course,
      schemaVersion: 2,
      publicationStatus,
      modules: course.modules.map((module) => ({ ...module, lessons: module.lessons.map(ensureLessonMeta) })),
    }
    setSaving(true)
    setSaveError(null)
    try {
      if (saveTarget === 'firebase') {
        if (!onSave) throw new Error('Missing Firebase save handler')
        const result = await onSave(nextCourse)
        if (result) Object.assign(nextCourse, { revision: result.revision })
      } else {
        window.localStorage.setItem(`aura-demo-course:${nextCourse.id}`, JSON.stringify(nextCourse))
      }
      const savedSourceSnapshot = JSON.stringify(course)
      const savedResultSnapshot = JSON.stringify(nextCourse)
      lastSavedSnapshot.current = savedResultSnapshot
      setCourse((current) => JSON.stringify(current) === savedSourceSnapshot ? nextCourse : current)
      setSavedMode(mode)
      window.setTimeout(() => setSavedMode(null), 2200)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Chưa thể đồng bộ khóa học lên Firebase. Kiểm tra quyền và thử lại.')
    } finally {
      setSaving(false)
    }
  }

  const applyAuraNutritionCurriculum = () => {
    if (isContentLocked) {
      setSaveError('Phiên bản này đã khóa nội dung. Hãy khôi phục một revision thành bản nháp trước khi thay giáo trình.')
      return
    }
    const hasAuthoredContent = course.modules.some((module) => (
      module.lessons.length > 0
      || (module.title.trim() && module.title.trim() !== 'Chương 1' && module.title.trim() !== 'Chương mới')
    ))
    if (hasAuthoredContent && !window.confirm('Nạp giáo trình AURA 20 chương sẽ thay toàn bộ chương và bài học hiện tại. Bạn muốn tiếp tục?')) return

    const template = structuredClone(auraFoundationCourse)
    setCourse((current) => ({
      ...current,
      title: template.title,
      description: template.description,
      category: template.category,
      level: template.level,
      coach: template.coach,
      duration: template.duration,
      outcomes: template.outcomes,
      requirements: template.requirements,
      modules: template.modules.map((module) => ({
        ...module,
        lessons: module.lessons.map(ensureLessonMeta),
      })),
      settings: {
        ...current.settings,
        accessTier: 'free',
        visibility: 'members',
        dripSchedule: 'none',
      },
      quizAnswerKeys: undefined,
    }))
    setDetailLessonModuleIndex(0)
    setDetailLessonIndex(0)
    setValidationRequested(false)
    setSaveError(null)
  }

  const changePublicationStatus = async (nextStatus: 'approved' | 'published' | 'archived') => {
    if (isDirty) {
      setSaveError('Hãy lưu hoặc bỏ các thay đổi cục bộ trước khi duyệt hay xuất bản.')
      return
    }
    const expectedRevision = course.revision ?? 0
    if (saveTarget !== 'firebase' || expectedRevision < 1) {
      setSaveError('Khóa học cần được lưu trên Firebase trước khi đổi trạng thái.')
      return
    }
    setWorkflowBusy(true)
    setSaveError(null)
    try {
      const result = await transitionCoursePublicationStatus(course.id, expectedRevision, nextStatus)
      setCourse((current) => {
        const updated = { ...current, publicationStatus: nextStatus, revision: result.revision }
        lastSavedSnapshot.current = JSON.stringify(updated)
        return updated
      })
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Chưa thể đổi trạng thái khóa học.')
    } finally {
      setWorkflowBusy(false)
    }
  }

  const compareWithCurrentRevision = async (sourceRevision: number) => {
    const currentRevision = course.revision ?? 0
    if (sourceRevision === currentRevision || currentRevision < 1) return
    setComparingRevision(sourceRevision)
    setRevisionError(null)
    try {
      setRevisionDiff(await getCourseRevisionDiff(course.id, sourceRevision, currentRevision))
    } catch (error) {
      setRevisionError(error instanceof Error ? error.message : 'Chưa thể so sánh hai phiên bản.')
    } finally {
      setComparingRevision(null)
    }
  }

  const restoreRevision = async (sourceRevision: number) => {
    const expectedRevision = course.revision ?? 0
    if (!canPublish || saveTarget !== 'firebase' || expectedRevision < 1) return
    if (isDirty) {
      setSaveError('Hãy xử lý thay đổi cục bộ trước khi khôi phục phiên bản.')
      return
    }
    if (!window.confirm(`Khôi phục revision ${sourceRevision} thành một bản nháp mới? Phiên bản đã xuất bản sẽ không bị sửa.`)) return
    setWorkflowBusy(true)
    setRevisionError(null)
    try {
      await restoreCourseRevisionToDraft(course.id, sourceRevision, expectedRevision)
      window.location.reload()
    } catch (error) {
      setRevisionError(error instanceof Error ? error.message : 'Chưa thể khôi phục phiên bản.')
      setWorkflowBusy(false)
    }
  }

  const navigateBack = () => onNavigate('admin-courses')

  const saveFromHeader = () => {
    void save('draft')
  }

  const uploadLessonResource = async (
    moduleIndex: number,
    lessonIndex: number,
    resourceIndex: number,
    file: File,
  ) => {
    const lesson = course.modules[moduleIndex].lessons[lessonIndex]
    const resource = lesson.resources?.[resourceIndex]
    if (!resource) return
    setMediaUploads((current) => ({ ...current, [resource.id]: { progress: 0 } }))
    try {
      const assetRef = await uploadCourseMedia(
        { courseId: course.id, lessonId: lesson.id, kind: resource.kind },
        file,
        (progress) => setMediaUploads((current) => ({ ...current, [resource.id]: { progress } })),
      )
      updateLessonResource(moduleIndex, lessonIndex, resourceIndex, {
        title: resource.title.trim() || file.name,
        url: '',
        assetRef,
      })
      setMediaUploads((current) => ({ ...current, [resource.id]: { progress: 100 } }))
    } catch (error) {
      setMediaUploads((current) => ({
        ...current,
        [resource.id]: { progress: 0, error: error instanceof Error ? error.message : 'Không thể tải tệp lên.' },
      }))
    }
  }

  const focusCoverInput = () => {
    setActiveStep(1)
    window.setTimeout(() => coverInputRef.current?.click(), 0)
  }

  const handleCoverUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    
    if (saveTarget !== 'firebase') {
      alert('Vui lòng đồng bộ khóa học với Firebase (hoặc cài đặt biến môi trường Firebase) để tải ảnh.')
      return
    }
    
    if (!course.id) {
       alert('Vui lòng lưu nháp khóa học một lần trước khi tải ảnh lên.')
       return
    }

    try {
      setCoverUploading(true)
      const url = await uploadCourseCover(course.id, file)
      updateField('coverUrl', url)
    } catch (error: any) {
      alert(error.message || 'Có lỗi xảy ra khi tải ảnh lên.')
    } finally {
      setCoverUploading(false)
    }
  }

  return (
    <div className="course-editor-page">
      <header className="editor-header">
        <button className="back-button" onClick={navigateBack}><ArrowLeft size={18} /> Khóa học</button>
        <div className="editor-title"><span className={`draft-dot ${course.publicationStatus}`} /><div><strong>{course.title || 'Khóa học mới'}</strong><small>{publicationLabels[course.publicationStatus]} · {lessonTotal} bài học</small></div></div>
        <div className="editor-actions">
          <button className="outline-button editor-preview-button" aria-label="Kiểm tra khóa học trước khi xuất bản" onClick={() => { setValidationRequested(true); setActiveStep(4) }}><Play size={16} /><span>Kiểm tra</span></button>
          <button
            className="primary-button"
            aria-label={saving ? 'Đang lưu khóa học' : 'Lưu khóa học'}
            onClick={saveFromHeader}
            disabled={saving || isContentLocked}
            title={isContentLocked ? 'Nội dung đã khóa. Khôi phục một revision thành bản nháp mới để chỉnh sửa.' : undefined}
          >
            {savedMode === 'draft' ? <Check size={17} /> : <Save size={17} />}
            {saving ? 'Đang lưu...' : isContentLocked ? 'Nội dung đã khóa' : savedMode === 'draft' ? 'Đã lưu' : 'Lưu bản nháp'}
          </button>
        </div>
      </header>

      {/* Mobile Step Switcher Bar (visible on screens <= 900px) */}
      <nav className="editor-mobile-stepper" aria-label="Điều hướng các bước biên tập">
        {[
          { step: 1, label: '1. Thông tin' },
          { step: 2, label: `2. Nội dung (${lessonTotal})` },
          { step: 3, label: '3. Thiết lập' },
          { step: 4, label: '4. Xuất bản' },
        ].map((item) => (
          <button
            key={item.step}
            type="button"
            className={`mobile-step-btn ${activeStep === item.step ? 'active' : ''}`}
            aria-current={activeStep === item.step ? 'step' : undefined}
            onClick={() => setActiveStep(item.step)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="editor-layout">
        <CourseEditorSidebar
          course={course}
          activeStep={activeStep}
          lessonTotal={lessonTotal}
          completeness={completeness}
          basicsReady={basicsReady}
          curriculumReady={curriculumReady}
          contentReady={contentReady}
          settingsReady={settingsReady}
          isReady={isReady}
          onStepChange={setActiveStep}
          onChooseCover={focusCoverInput}
        />

        <main className="curriculum-builder">
          {isContentLocked && (
            <div className="academy-content-lock" role="status">
              <ShieldCheck size={19} />
              <span><strong>Nội dung revision này đã khóa</strong><small>Phiên bản đã duyệt, xuất bản hoặc lưu trữ không được sửa trực tiếp. Có thể khôi phục một revision bên dưới thành bản nháp mới.</small></span>
            </div>
          )}
          <fieldset className="course-editor-content-fieldset" disabled={isContentLocked}>
          {activeStep === 1 && (
            <section className="editor-step-panel">
              <div className="builder-heading"><div><span className="eyebrow">BƯỚC 1 / 4</span><h1>Thông tin cơ bản</h1><p>Định vị khóa học rõ ràng để học viên biết mình sẽ đạt được gì.</p></div></div>
              <div className="course-form-grid">
                <label className={`span-2 ${validationRequested && !course.title.trim() ? 'field-has-error' : ''}`}><span>Tên khóa học *</span><input id="course-title" value={course.title} aria-invalid={validationRequested && !course.title.trim()} onChange={(event) => updateField('title', event.target.value)} />{validationRequested && !course.title.trim() && <small className="field-error">Nhập tên khóa học.</small>}</label>
                <label className={`span-2 ${validationRequested && !course.slug.trim() ? 'field-has-error' : ''}`}><span>Slug *</span><input id="course-slug" value={course.slug} aria-invalid={validationRequested && !course.slug.trim()} onChange={(event) => updateField('slug', event.target.value)} />{validationRequested && !course.slug.trim() && <small className="field-error">Slug không được để trống.</small>}</label>
                <label className="span-2">
                  <span>Ảnh bìa</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                     <input 
                       ref={coverInputRef} 
                       type="file" 
                       accept="image/jpeg, image/png, image/webp"
                       onChange={handleCoverUpload} 
                       style={{ flex: 1 }}
                     />
                     {coverUploading && <span style={{ fontSize: '14px', color: '#666' }}>Đang tải...</span>}
                  </div>
                  <small>Dùng ảnh ngang tối thiểu 1200 × 675 px. {course.coverUrl && <a href={course.coverUrl} target="_blank" rel="noreferrer" style={{ color: '#0066cc', textDecoration: 'underline' }}>Xem ảnh hiện tại</a>}</small>
                </label>
                <label className={`span-2 ${validationRequested && !course.description.trim() ? 'field-has-error' : ''}`}><span>Mô tả *</span><textarea id="course-description" value={course.description} aria-invalid={validationRequested && !course.description.trim()} onChange={(event) => updateField('description', event.target.value)} />{validationRequested && !course.description.trim() && <small className="field-error">Mô tả giúp học viên hiểu giá trị khóa học.</small>}</label>
                <label><span>Danh mục</span><select id="course-category" value={course.category} onChange={(event) => updateField('category', event.target.value)}>{!['Dinh dưỡng nền tảng', 'Dinh dưỡng giảm mỡ', 'Dinh dưỡng tăng cơ', 'Dinh dưỡng thể thao', 'Dinh dưỡng chuyên sâu', 'Chứng nhận chuyên môn'].includes(course.category) ? <option>{course.category}</option> : null}<option>Dinh dưỡng nền tảng</option><option>Dinh dưỡng giảm mỡ</option><option>Dinh dưỡng tăng cơ</option><option>Dinh dưỡng thể thao</option><option>Dinh dưỡng chuyên sâu</option><option>Chứng nhận chuyên môn</option></select></label>
                <label><span>Cấp độ</span><select id="course-level" value={course.level} onChange={(event) => updateField('level', event.target.value)}>{!['Cơ bản', 'Trung cấp', 'Nâng cao', 'Mọi cấp độ'].includes(course.level) ? <option>{course.level}</option> : null}<option>Cơ bản</option><option>Trung cấp</option><option>Nâng cao</option><option>Mọi cấp độ</option></select></label>
                <label className={validationRequested && !course.coach.trim() ? 'field-has-error' : ''}><span>Giảng viên *</span><input id="course-coach" value={course.coach} aria-invalid={validationRequested && !course.coach.trim()} onChange={(event) => updateField('coach', event.target.value)} />{validationRequested && !course.coach.trim() && <small className="field-error">Chọn hoặc nhập giảng viên phụ trách.</small>}</label>
                <label><span>Thời lượng</span><input id="course-duration" value={course.duration} onChange={(event) => updateField('duration', event.target.value)} /></label>
                <label className={validationRequested && !course.outcomes.length ? 'field-has-error' : ''}><span>Kết quả đầu ra · mỗi dòng một ý</span><textarea id="course-outcomes" value={course.outcomes.join('\n')} aria-invalid={validationRequested && !course.outcomes.length} onChange={(event) => updateField('outcomes', event.target.value.split('\n').map((item) => item.trim()).filter(Boolean))} />{validationRequested && !course.outcomes.length && <small className="field-error">Thêm ít nhất một kết quả đầu ra.</small>}</label>
                <label className={validationRequested && !course.requirements.length ? 'field-has-error' : ''}><span>Yêu cầu tham gia · mỗi dòng một ý</span><textarea id="course-requirements" value={course.requirements.join('\n')} aria-invalid={validationRequested && !course.requirements.length} onChange={(event) => updateField('requirements', event.target.value.split('\n').map((item) => item.trim()).filter(Boolean))} />{validationRequested && !course.requirements.length && <small className="field-error">Thêm yêu cầu hoặc ghi “Không yêu cầu”.</small>}</label>
              </div>
            </section>
          )}

          {activeStep === 2 && (
            <section className="editor-step-panel" id="course-curriculum">
              <div className="builder-heading"><div><span className="eyebrow">BƯỚC 2 / 4</span><h1>Nội dung Aura Academy</h1><p>Thiết kế khóa đào tạo dinh dưỡng chuyên sâu, độc lập hoàn toàn với giáo án PT.</p></div><div className="builder-heading-actions"><button className="outline-button academy-curriculum-import" onClick={applyAuraNutritionCurriculum}><BookOpen size={17} /> Nạp giáo trình 20 chương</button><button className="outline-button" onClick={handleGenerateOutline} disabled={generatingOutline} style={{color: '#8b5cf6', border: '1px solid #8b5cf6'}}><Sparkles size={17} /> {generatingOutline ? 'Đang tạo...' : 'AI Lên sườn nội dung'}</button><button className="outline-button" onClick={addModule}><Plus size={17} /> Thêm chương</button></div></div>
              <div className="builder-tip"><span>📚</span><p><strong>Giáo trình AURA 2026 đã sẵn sàng</strong>Nút “Nạp giáo trình 20 chương” tạo 4 chặng, 60 bài micro-learning, bài thực hành, active recall, flashcard và checkpoint có đáp án bảo mật. Khóa được đặt miễn phí, mở toàn bộ cho mọi thành viên sau khi xuất bản.</p></div>
              <div className="module-list">
                {course.modules.map((module, moduleIndex) => (
                  <article className="builder-module editable" key={module.id}>
                    <header><GripVertical size={18} /><span className="module-number">{moduleIndex + 1}</span><input value={module.title} aria-label={`Tên chương ${moduleIndex + 1}`} onChange={(event) => updateModule(moduleIndex, { title: event.target.value })} /><small>{module.lessons.length} bài</small><button type="button" title="Xóa chương" aria-label={`Xóa chương ${module.title || moduleIndex + 1}`} onClick={() => removeModule(moduleIndex)}><Trash2 size={16} /></button></header>
                    <div className="builder-lessons">
                      {module.lessons.map((item, lessonIndex) => {
                        const Icon = lessonIcons[item.type] ?? FileText
                        return <div className="builder-lesson editable" key={item.id}><GripVertical size={16} /><span className={`lesson-type-icon ${item.type === 'Video' ? 'purple' : item.type === 'Quiz' ? 'orange' : 'blue'}`}><Icon size={17} /></span><input value={item.title} aria-label={`Tên bài học ${lessonIndex + 1}`} onChange={(event) => updateLesson(moduleIndex, lessonIndex, { title: event.target.value })} /><select value={item.type} aria-label={`Loại bài học ${lessonIndex + 1}`} onChange={(event) => updateLessonType(moduleIndex, lessonIndex, event.target.value as CourseLessonType)}>{lessonTypes.map((type) => <option key={type}>{type}</option>)}</select><input className="duration-input" value={item.duration} aria-label={`Thời lượng bài học ${lessonIndex + 1}`} onChange={(event) => updateLesson(moduleIndex, lessonIndex, { duration: event.target.value })} /><label className="preview-toggle"><input type="checkbox" checked={Boolean(item.preview)} onChange={(event) => updateLesson(moduleIndex, lessonIndex, { preview: event.target.checked })} /> Xem thử</label><button type="button" title="Xóa bài" aria-label={`Xóa bài ${item.title || lessonIndex + 1}`} onClick={() => removeLesson(moduleIndex, lessonIndex)}><Trash2 size={16} /></button></div>
                      })}
                      <button className="add-lesson-button" onClick={() => addLesson(moduleIndex)}><Plus size={16} /> Thêm bài học</button>
                    </div>
                  </article>
                ))}
              </div>
              <div className="builder-lesson-editor" id="course-lesson-detail">
                <div className="builder-heading">
                  <div><span className="eyebrow">Chi tiết bài học</span><h2>Công cụ biên tập Academy</h2><p>Thêm học liệu, ghi chú giảng viên, bộ ghi nhớ sâu và bài kiểm tra kiến thức.</p></div>
                  {detailModule && detailModule.lessons.length > 0 ? null : <button className="outline-button" onClick={() => addLesson(0)}><Plus size={16} /> Tạo bài học trước</button>}
                </div>
                {detailModule && detailModule.lessons.length > 0 ? (
                  <>
                    <div className="course-form-grid form-grid-2col">
                      <label><span>Chương</span><select value={detailLessonModuleIndex} onChange={(event) => setDetailLessonModuleIndex(Number(event.target.value))}>
                        {course.modules.map((module, moduleIndex) => (
                          <option key={module.id} value={moduleIndex}>Chương {moduleIndex + 1} – {module.title || `Chương ${moduleIndex + 1}`}</option>
                        ))}
                      </select></label>
                      <label><span>Bài học</span><select value={detailLessonIndex} onChange={(event) => setDetailLessonIndex(Number(event.target.value))}>
                        {detailModule.lessons.length ? (
                          detailModule.lessons.map((lesson, lessonIndex) => (
                            <option key={lesson.id} value={lessonIndex}>{lesson.title || `Bài học ${lessonIndex + 1}`}</option>
                          ))
                        ) : <option value={0}>Chưa có bài học</option>}
                      </select></label>
                    </div>
                      <div className="builder-lesson-meta">
                        <label className="span-2"><span>Chủ đề kiến thức</span><input value={detailLesson?.tags?.join(', ') ?? ''} onChange={(event) => updateLessonTags(detailLessonModuleIndex, detailLessonIndex, event.target.value)} placeholder="protein, cân bằng năng lượng, nhãn thực phẩm..." /></label>
                        <label className="span-2"><span>Mô tả bài học</span><textarea value={detailLesson?.summary ?? ''} onChange={(event) => updateLesson(detailLessonModuleIndex, detailLessonIndex, { summary: event.target.value })} rows={2} /></label>
                        <label className="span-2"><span>Ghi chú giảng viên</span><textarea value={getAcademyCoachNote(detailLesson)} onChange={(event) => updateInstructorNote(event.target.value)} rows={3} placeholder="Bối cảnh, lưu ý chuyên môn hoặc hướng dẫn học tập..." /></label>
                        <div className="span-2 builder-control-group"><strong className="builder-control-label">Điều kiện hoàn thành</strong>
                          <div className="course-form-grid form-grid-2col">
                            <select
                              aria-label="Chế độ hoàn thành bài học"
                              value={detailLesson?.completionPolicy?.mode ?? 'manual'}
                              disabled={detailLesson?.type === 'Quiz'}
                              onChange={(event) => updateLesson(detailLessonModuleIndex, detailLessonIndex, {
                                completionPolicy: {
                                  mode: event.target.value as NonNullable<CourseLessonDraft['completionPolicy']>['mode'],
                                  ...(event.target.value === 'media-progress' ? { thresholdPercent: 80 } : {}),
                                },
                              })}
                            >
                              <option value="manual">Học viên tự đánh dấu</option>
                              <option value="media-progress">Xem đủ media</option>
                              <option value="quiz-pass">Đạt bài quiz</option>
                            </select>
                            {detailLesson?.completionPolicy?.mode === 'media-progress' ? (
                              <input type="number" min={1} max={100} value={detailLesson.completionPolicy.thresholdPercent ?? 80} onChange={(event) => updateLesson(detailLessonModuleIndex, detailLessonIndex, { completionPolicy: { ...detailLesson.completionPolicy!, thresholdPercent: Number(event.target.value) } })} aria-label="Phần trăm media cần xem" />
                            ) : <small>Quiz được chấm bảo mật trên backend; chế độ thủ công do học viên xác nhận.</small>}
                          </div>
                        </div>
                        <div className="span-2">
                          <AcademyLessonMemoryEditor content={detailAcademyContent} onChange={updateAcademyContent} />
                        </div>
                        <section className="span-2 builder-control-group" aria-labelledby="course-resources-heading"><strong id="course-resources-heading" className="builder-control-label">Tài nguyên học liệu</strong>
                          {(detailLesson?.resources?.length ?? 0) > 0 && (
                            <select value={detailLesson?.primaryContent?.resourceId ?? ''} onChange={(event) => updateLesson(detailLessonModuleIndex, detailLessonIndex, { primaryContent: { kind: 'resource', resourceId: event.target.value } })} aria-label="Học liệu chính">
                              <option value="">Chọn học liệu chính</option>
                              {(detailLesson?.resources ?? []).map((resource) => <option key={resource.id} value={resource.id}>Học liệu chính: {resource.title || 'Chưa đặt tên'}</option>)}
                            </select>
                          )}
                          <div className="builder-resource-grid">
                          {(detailLesson?.resources ?? []).map((resource, resourceIndex) => (
                            <div className="builder-resource-row" key={resource.id}>
                              <span className="resource-kind-icon">{resourceTypeIcon(resource.kind)}</span>
                              <select aria-label={`Loại tài nguyên ${resourceIndex + 1}`} value={resource.kind} onChange={(event) => updateLessonResource(detailLessonModuleIndex, detailLessonIndex, resourceIndex, { kind: event.target.value as LessonResourceKind })}>
                                {(Object.keys(resourceTypeLabels) as LessonResourceKind[]).map((kind) => (
                                  <option key={kind} value={kind}>{resourceTypeLabels[kind]}</option>
                                ))}
                              </select>
                              <input
                                 className="resource-title"
                                 aria-label={`Tên tài nguyên ${resourceIndex + 1}`}
                                value={resource.title}
                                onChange={(event) => updateLessonResource(detailLessonModuleIndex, detailLessonIndex, resourceIndex, { title: event.target.value })}
                                placeholder="Tên tài nguyên"
                              />
                              <div className="resource-url">
                                <input
                                 value={resource.url}
                                 aria-label={`Đường dẫn tài nguyên ${resourceIndex + 1}`}
                                  onChange={(event) => updateLessonResource(detailLessonModuleIndex, detailLessonIndex, resourceIndex, { url: event.target.value, assetRef: undefined })}
                                  placeholder={resource.assetRef?.storagePath || resourceTypeHints[resource.kind]}
                                  disabled={resource.assetRef?.status === 'ready'}
                                />
                                <input
                                  type="file"
                                  aria-label={resource.assetRef?.status === 'ready' ? 'Đổi tệp Firebase' : 'Tải lên Firebase'}
                                  accept={resource.kind === 'video' ? 'video/*' : resource.kind === 'slide' ? '.pdf,.ppt,.pptx' : '.pdf,.doc,.docx,.txt'}
                                  disabled={Boolean(mediaUploads[resource.id]?.progress && mediaUploads[resource.id].progress < 100)}
                                  onChange={(event) => {
                                    const file = event.target.files?.[0]
                                    if (file) void uploadLessonResource(detailLessonModuleIndex, detailLessonIndex, resourceIndex, file)
                                    event.target.value = ''
                                  }}
                                />
                                {Boolean(mediaUploads[resource.id]?.progress && mediaUploads[resource.id].progress < 100) && <small>Đang tải {mediaUploads[resource.id].progress}%</small>}
                                {resource.assetRef?.storagePath && <small title={resource.assetRef.storagePath}>Đã lưu riêng tư · {resource.assetRef.fileName}</small>}
                                {mediaUploads[resource.id]?.error && <small role="alert">{mediaUploads[resource.id].error}</small>}
                              </div>
                              <input
                                 className="resource-note"
                                 aria-label={`Ghi chú tài nguyên ${resourceIndex + 1}`}
                                value={resource.note ?? ''}
                                onChange={(event) => updateLessonResource(detailLessonModuleIndex, detailLessonIndex, resourceIndex, { note: event.target.value })}
                                placeholder="Ghi chú tài nguyên (nội bộ cho bài học)"
                              />
                              <button type="button" title="Xóa tài nguyên" aria-label={`Xóa tài nguyên ${resource.title || resourceIndex + 1}`} onClick={() => removeLessonResource(detailLessonModuleIndex, detailLessonIndex, resourceIndex)}><Trash2 size={14} /></button>
                            </div>
                          ))}
                        </div>
                        <button type="button" className="outline-button" onClick={() => addLessonResource(detailLessonModuleIndex, detailLessonIndex)}><PlusCircle size={14} /> Thêm tài nguyên</button>
                        </section>
                        {detailLesson?.type === 'Quiz' && (
                          <section className="span-2 builder-control-group" aria-labelledby="course-quiz-heading">
                            <strong id="course-quiz-heading" className="builder-control-label">Quiz builder</strong>
                            <div className="builder-quiz-head">
                              <select aria-label="Thứ tự câu hỏi" value={detailLesson.quiz?.questionOrder ?? 'sequential'} onChange={(event) => updateLesson(detailLessonModuleIndex, detailLessonIndex, { quiz: { ...(detailLesson.quiz ?? createDefaultQuiz()), questionOrder: event.target.value as 'sequential' | 'shuffle' } })}>
                              <option value="sequential">Theo thứ tự</option>
                              <option value="shuffle">Ngẫu nhiên</option>
                            </select>
                              <select aria-label="Điểm đạt quiz" value={detailLesson.quiz?.passPercent ?? 70} onChange={(event) => updateLesson(detailLessonModuleIndex, detailLessonIndex, { quiz: { ...(detailLesson.quiz ?? createDefaultQuiz()), passPercent: Number(event.target.value) } })}>
                              <option value={50}>Đạt: 50%</option>
                              <option value={60}>Đạt: 60%</option>
                              <option value={70}>Đạt: 70%</option>
                              <option value={80}>Đạt: 80%</option>
                              <option value={90}>Đạt: 90%</option>
                            </select>
                            <select value={detailLesson.quiz?.publicSettings?.maxAttempts ?? 3} onChange={(event) => updateLesson(detailLessonModuleIndex, detailLessonIndex, { quiz: { ...(detailLesson.quiz ?? createDefaultQuiz()), publicSettings: { ...(detailLesson.quiz?.publicSettings ?? {}), maxAttempts: Number(event.target.value) } } })} aria-label="Số lần làm quiz">
                              <option value={1}>1 lượt làm</option><option value={2}>2 lượt làm</option><option value={3}>3 lượt làm</option><option value={0}>Không giới hạn</option>
                            </select>
                            <select value={detailLesson.quiz?.publicSettings?.revealMode ?? 'after-submit'} onChange={(event) => updateLesson(detailLessonModuleIndex, detailLessonIndex, { quiz: { ...(detailLesson.quiz ?? createDefaultQuiz()), publicSettings: { ...(detailLesson.quiz?.publicSettings ?? {}), revealMode: event.target.value as 'never' | 'after-submit' | 'after-pass' } } })} aria-label="Thời điểm hiện giải thích">
                              <option value="never">Không hiện đáp án</option><option value="after-submit">Sau khi nộp</option><option value="after-pass">Sau khi đạt</option>
                            </select>
                          </div>
                          <div className="builder-quiz-head" style={{marginTop: 16, borderTop: '1px solid #e2e8f0', paddingTop: 16}}>
                            <button className="outline-button" onClick={handleGenerateQuiz} disabled={generatingQuiz} style={{color: '#8b5cf6', border: '1px solid #8b5cf6'}}><Sparkles size={14} /> {generatingQuiz ? 'Đang tạo...' : 'AI Tạo câu hỏi'}</button>
                          </div>
                          {(detailLesson.quiz?.questions ?? []).map((question, questionIndex) => (
                            <div className="builder-question" key={question.id}>
                              <div className="builder-question-head"><span>Câu hỏi {questionIndex + 1}</span><button type="button" aria-label={`Xóa câu hỏi ${questionIndex + 1}`} onClick={() => removeQuizQuestion(detailLessonModuleIndex, detailLessonIndex, questionIndex)}><Trash2 size={13} /></button></div>
                              <textarea aria-label={`Nội dung câu hỏi ${questionIndex + 1}`} value={question.question} onChange={(event) => updateQuizQuestion(detailLessonModuleIndex, detailLessonIndex, questionIndex, { question: event.target.value })} />
                              <div className="builder-quiz-options">
                                {question.options.map((option, optionIndex) => (
                                  <div key={`${question.id}-${optionIndex}`}>
                                    <input type="radio" name={`correct-${question.id}`} aria-label={`Đặt đáp án ${optionIndex + 1} là đáp án đúng`} checked={question.correctIndex === optionIndex} onChange={() => updateQuizQuestion(detailLessonModuleIndex, detailLessonIndex, questionIndex, { correctIndex: optionIndex })} />
                                    <input type="text" aria-label={`Nội dung đáp án ${optionIndex + 1}`} value={option} onChange={(event) => updateQuizOption(detailLessonModuleIndex, detailLessonIndex, questionIndex, optionIndex, event.target.value)} />
                                    {question.options.length > 2 ? <button type="button" aria-label={`Xóa đáp án ${optionIndex + 1}`} className="outline-button small" onClick={() => removeQuizOption(detailLessonModuleIndex, detailLessonIndex, questionIndex, optionIndex)}><X size={12} /></button> : <span />}
                                  </div>
                                ))}
                              </div>
                              <button className="outline-button" onClick={() => updateQuizQuestion(detailLessonModuleIndex, detailLessonIndex, questionIndex, { options: [...question.options, ''] })}><Plus size={13} /> Thêm đáp án</button>
                            </div>
                          ))}
                          <button className="outline-button" onClick={() => addQuizQuestion(detailLessonModuleIndex, detailLessonIndex)}><Plus size={14} /> Thêm câu hỏi</button>
                          </section>
                      )}
                    </div>
                  </>
                ) : (
                  <p>Hãy thêm ít nhất một bài học trong chương để mở công cụ chi tiết.</p>
                )}
              </div>
            </section>
          )}

          {activeStep === 3 && (
            <section className="editor-step-panel" id="course-settings">
              <div className="builder-heading"><div><span className="eyebrow">BƯỚC 3 / 4</span><h1>Thiết lập khóa học</h1><p>Kiểm soát quyền truy cập, hoàn thành, chứng nhận và lịch mở bài.</p></div></div>
              <div className="course-settings-grid">
                <label><span>Gói truy cập</span><select value={course.settings.accessTier} onChange={(event) => updateField('settings', { ...course.settings, accessTier: event.target.value as 'free' | 'pro' })}><option value="free">Miễn phí</option><option value="pro">Aura Pro</option></select><small>Quyết định nhóm thành viên được phép tham gia.</small></label>
                <label><span>Điều kiện hoàn thành</span><input type="number" min="50" max="100" value={course.settings.completionPercent} onChange={(event) => updateField('settings', { ...course.settings, completionPercent: Number(event.target.value) })} /><small>Phần trăm bài học cần hoàn thành.</small></label>
                <label><span>Lịch mở bài</span><select value={course.settings.dripSchedule} onChange={(event) => updateField('settings', { ...course.settings, dripSchedule: event.target.value as 'none' | 'weekly' })}><option value="none">Mở toàn bộ ngay</option><option value="weekly">Mở theo tuần</option></select><small>Giúp học viên đi đúng nhịp của lộ trình.</small></label>
                <label><span>Hiển thị</span><select value={course.settings.visibility} onChange={(event) => updateField('settings', { ...course.settings, visibility: event.target.value as 'members' | 'private' })}><option value="members">Hiển thị cho thành viên</option><option value="private">Chỉ người được mời</option></select><small>Áp dụng sau khi khóa học được xuất bản.</small></label>
                <label className="settings-switch span-2"><input type="checkbox" checked={course.settings.certificateEnabled} onChange={(event) => updateField('settings', { ...course.settings, certificateEnabled: event.target.checked })} /><span><strong>Cấp chứng nhận hoàn thành</strong><small>Học viên nhận chứng nhận khi đạt điều kiện hoàn thành.</small></span></label>
              </div>
            </section>
          )}

          {activeStep === 4 && (
            <section className="editor-step-panel">
              <div className="builder-heading"><div><span className="eyebrow">BƯỚC 4 / 4</span><h1>Kiểm tra & xuất bản</h1><p>Xác nhận chất lượng nội dung trước khi đưa khóa học đến học viên.</p></div></div>
              <CourseEditorValidationPanel issues={validationIssues} onSelect={openValidationIssue} />
              <div className="publish-review-grid">
                <article className="publish-preview-card"><div className={`preview-cover ${course.coverUrl ? 'has-image' : ''}`}>{course.coverUrl ? <img src={course.coverUrl} alt={`Ảnh bìa ${course.title}`} /> : <BookOpen size={46} />}</div><span>{course.category} · {course.level}</span><h2>{course.title}</h2><p>{course.description}</p><div><strong>{course.modules.length}</strong><small>chương</small><strong>{lessonTotal}</strong><small>bài học</small><strong>{course.duration}</strong><small>thời lượng</small></div></article>
                <article className="publish-checklist"><h2>Checklist xuất bản</h2>{[
                  ['Thông tin khóa học', basicsReady],
                  ['Giáo trình và học liệu hoàn chỉnh', curriculumReady && lessonTotal >= 6 && contentReady],
                  ['Mục tiêu và yêu cầu', course.outcomes.length > 0 && course.requirements.length > 0],
                  ['Thiết lập quyền truy cập', Boolean(course.settings.accessTier)],
                  ['Ngưỡng hoàn thành hợp lệ', settingsReady],
                  ['Giảng viên phụ trách', Boolean(course.coach)],
                ].map(([label, done]) => <div key={String(label)} className={done ? 'done' : ''}><span>{done ? <Check size={15} /> : '!'}</span><strong>{label}</strong></div>)}<div className="publish-permission"><ShieldCheck size={18} /><p><strong>{canPublish ? 'Bạn có quyền xuất bản' : 'Cần Administrator duyệt'}</strong><small>{canPublish ? 'Khóa học sẽ hiển thị cho học viên ngay sau khi đồng bộ.' : 'Khóa học sẽ chuyển sang trạng thái chờ duyệt.'}</small></p></div></article>
              </div>
            </section>
          )}
          </fieldset>

          {activeStep === 4 && (
            <>
              <section className="academy-workflow-card" aria-label="Quy trình xuất bản khóa học">
                <div className="academy-workflow-heading"><div><span className="eyebrow">QUY TRÌNH SERVER</span><h2>Duyệt và xuất bản</h2><p>Mỗi bước tạo một revision bất biến và audit log riêng.</p></div><span className={`status-badge ${course.publicationStatus}`}>{publicationLabels[course.publicationStatus]}</span></div>
                <ol className="academy-workflow-steps">
                  {(['draft', 'review', 'approved', 'scheduled', 'published', 'archived'] as const).map((status) => (
                    <li key={status} className={course.publicationStatus === status ? 'is-current' : ''}>
                      <span>{publicationLabels[status]}</span>
                      {status === 'scheduled' && <small>Chưa bật scheduler</small>}
                    </li>
                  ))}
                </ol>
                <div className="academy-workflow-actions">
                  {course.publicationStatus === 'draft' && <button className="primary-button" type="button" disabled={saving || !isReady} onClick={() => void save('review')}><Save size={17} /> Gửi duyệt</button>}
                  {course.publicationStatus === 'review' && canPublish && <button className="primary-button" type="button" disabled={workflowBusy || isDirty} onClick={() => void changePublicationStatus('approved')}><ShieldCheck size={17} /> Duyệt nội dung</button>}
                  {course.publicationStatus === 'review' && !canPublish && <p className="academy-workflow-note"><Clock3 size={16} /> Đang chờ Administrator duyệt nội dung.</p>}
                  {course.publicationStatus === 'approved' && canPublish && <button className="primary-button" type="button" disabled={workflowBusy} onClick={() => void changePublicationStatus('published')}><ShieldCheck size={17} /> Xuất bản thủ công</button>}
                  {course.publicationStatus === 'approved' && <button className="outline-button" type="button" disabled title="Chưa có scheduler backend"><Clock3 size={16} /> Lên lịch — chưa khả dụng</button>}
                  {course.publicationStatus === 'scheduled' && canPublish && <button className="primary-button" type="button" disabled={workflowBusy} onClick={() => void changePublicationStatus('published')}><ShieldCheck size={17} /> Xuất bản lịch cũ</button>}
                  {course.publicationStatus === 'published' && canPublish && <button className="outline-button" type="button" disabled={workflowBusy} onClick={() => void changePublicationStatus('archived')}><Archive size={16} /> Lưu trữ khóa học</button>}
                  {course.publicationStatus === 'archived' && <p className="academy-workflow-note"><Archive size={16} /> Khóa học đã lưu trữ. Khôi phục revision để tạo bản nháp mới.</p>}
                  {workflowBusy && <span className="academy-workflow-loading"><LoaderCircle className="spin" size={16} /> Đang xử lý trên server...</span>}
                </div>
              </section>

              <section className="academy-revision-card" aria-label="Lịch sử phiên bản khóa học">
                <div className="academy-workflow-heading"><div><span className="eyebrow">REVISION HISTORY</span><h2>Lịch sử và khôi phục</h2><p>So sánh nội dung hoặc tạo bản nháp mới từ một revision cũ.</p></div><History size={23} /></div>
                {revisionLoading ? <p className="academy-workflow-loading"><LoaderCircle className="spin" size={16} /> Đang tải lịch sử...</p> : revisionError ? <p className="builder-save-error" role="alert">{revisionError}</p> : revisionHistory.length === 0 ? <p className="academy-workflow-note">Lưu khóa học lần đầu để tạo revision.</p> : (
                  <div className="academy-revision-list">
                    {revisionHistory.map((revision) => (
                      <article key={revision.id} className={revision.revision === course.revision ? 'is-current' : ''}>
                        <div><strong>Revision {revision.revision}</strong><small>{publicationLabels[revision.status as keyof typeof publicationLabels] ?? revision.status} · {revision.createdAt ? new Date(revision.createdAt).toLocaleString('vi-VN') : 'Chưa có thời gian'}</small>{revision.restoredFromRevision && <small>Khôi phục từ revision {revision.restoredFromRevision}</small>}</div>
                        <div>
                          {revision.revision !== course.revision && <button className="outline-button" type="button" disabled={comparingRevision !== null} onClick={() => void compareWithCurrentRevision(revision.revision)}><GitCompare size={15} /> {comparingRevision === revision.revision ? 'Đang so sánh...' : 'So với hiện tại'}</button>}
                          {canPublish && (revision.revision !== course.revision || isContentLocked) && <button className="outline-button" type="button" disabled={workflowBusy} onClick={() => void restoreRevision(revision.revision)}><Undo2 size={15} /> Tạo bản nháp</button>}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
                {revisionDiff && (
                  <div className="academy-revision-diff">
                    <div><h3>Revision {revisionDiff.fromRevision} → {revisionDiff.toRevision}</h3><button type="button" onClick={() => setRevisionDiff(null)} aria-label="Đóng so sánh"><X size={16} /></button></div>
                    <p>{revisionDiff.summary.changedFields} thay đổi · {revisionDiff.summary.lessonsBefore} → {revisionDiff.summary.lessonsAfter} bài học{revisionDiff.summary.truncated ? ' · Danh sách đã rút gọn' : ''}</p>
                    {revisionDiff.changes.length === 0 ? <small>Hai phiên bản không khác nội dung công khai.</small> : <ul>{revisionDiff.changes.map((change) => <li key={change.path}><strong>{change.label}</strong><span><del>{formatRevisionDiffValue(change.before)}</del><ins>{formatRevisionDiffValue(change.after)}</ins></span></li>)}</ul>}
                  </div>
                )}
              </section>
            </>
          )}

          {saveError && <div className="builder-save-error" role="alert">{saveError}</div>}
          {undoState && <div className="course-undo-toast" role="status"><span>{undoState.message}</span><button type="button" onClick={restoreUndo}><Undo2 size={15} /> Hoàn tác</button></div>}
          <div className="editor-footer">
            <span role="status" aria-live="polite">{isDirty ? <Clock3 size={16} /> : <Check size={16} />} {saving ? saveTarget === 'firebase' ? 'Đang đồng bộ với Firebase...' : 'Đang lưu bản demo...' : isDirty ? 'Có thay đổi chưa lưu' : savedMode ? saveTarget === 'firebase' ? 'Đã đồng bộ với Firebase' : 'Đã lưu bản demo trên thiết bị' : 'Không có thay đổi chưa lưu'}</span>
            <div>
              {activeStep > 1 && <button className="outline-button editor-nav-back" onClick={() => setActiveStep((step) => step - 1)}>Quay lại</button>}
              {activeStep < 4 && <button className="outline-button editor-review-action" onClick={() => { setValidationRequested(true); setActiveStep(4) }}><Play size={15} /> Kiểm tra</button>}
              {!isContentLocked && <button className="outline-button editor-draft-action" onClick={() => void save('draft')} disabled={saving}><Save size={15} /> {course.publicationStatus === 'review' ? 'Lưu bản chờ duyệt' : 'Lưu nháp'}</button>}
              {activeStep < 4
                ? <button className="primary-button editor-nav-next" onClick={() => setActiveStep((step) => step + 1)}>Tiếp tục <ChevronRight size={17} /></button>
                : !isContentLocked && course.publicationStatus === 'draft'
                  ? <button className="primary-button editor-publish-action" onClick={() => void save('review')} disabled={saving || !isReady}><Save size={17} /> Gửi duyệt</button>
                  : <button className="primary-button editor-publish-action" onClick={() => document.querySelector<HTMLElement>('.academy-workflow-card')?.scrollIntoView({ behavior: 'smooth' })}><ShieldCheck size={17} /> Xem quy trình</button>}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
