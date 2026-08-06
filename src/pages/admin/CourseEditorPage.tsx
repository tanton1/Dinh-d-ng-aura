import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileQuestion,
  FileSpreadsheet,
  FileText,
  FileType,
  GraduationCap,
  GripVertical,
  Image,
  Layers,
  Play,
  PlusCircle,
  Plus,
  Save,
  Sparkles,
  Settings2,
  ShieldCheck,
  X,
  Trash2,
  Video,
} from 'lucide-react'
import { auraFoundationCourse } from '../../course-template'
import AcademyLessonMemoryEditor from '../../components/academy/AcademyLessonMemoryEditor'
import {
  getAcademyCoachNote,
  getAcademyLessonContent,
  hasAcademyLessonContent,
  toAcademyLessonMemory,
  type AcademyLessonContent,
} from '../../services/academyLearningService'
import { loadCourseQuizAnswerKeys, uploadCourseMedia } from '../../services/firebaseService'
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

type SaveMode = 'draft' | 'review' | 'publish'

interface CourseEditorPageProps {
  onNavigate: (view: ViewId) => void
  onSave?: (course: CourseDraftInput, publish: boolean) => Promise<void>
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
  scheduled: 'Đã lên lịch',
  published: 'Đã xuất bản',
  archived: 'Đã lưu trữ',
} as const

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
  const coverInputRef = useRef<HTMLInputElement>(null)
  const isDirty = JSON.stringify(course) !== lastSavedSnapshot.current
  const isPublished = course.publicationStatus === 'published'

  useEffect(() => {
    const nextCourse = createEditorDraft(initialCourse)
    setCourse(nextCourse)
    lastSavedSnapshot.current = JSON.stringify(nextCourse)
    setActiveStep(1)
    setSavedMode(null)
    setSaveError(null)
  }, [initialCourse?.id])

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
  const isReady = Boolean(
    course.title.trim()
      && course.slug.trim()
      && course.description.trim()
      && course.coach.trim()
      && curriculumReady
      && lessonTotal >= 6
      && course.outcomes.length > 0
      && course.requirements.length > 0
      && settingsReady
      && contentIssues.length === 0
  )
  const completeness = Math.round(([
    course.title,
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
  ].filter(Boolean).length / 11) * 100)
  const detailModule = course.modules[detailLessonModuleIndex]
  const detailLesson = detailModule?.lessons[detailLessonIndex]
  const detailAcademyContent = getAcademyLessonContent(detailLesson)

  const updateField = <K extends keyof CourseDraftInput>(key: K, value: CourseDraftInput[K]) => {
    setCourse((current) => ({ ...current, [key]: value }))
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
    setCourse((current) => ({
      ...current,
      modules: current.modules.map((module, index) => index === moduleIndex
        ? { ...module, lessons: module.lessons.filter((_, position) => position !== lessonIndex) }
        : module),
    }))
  }

  const save = async (mode: SaveMode) => {
    if ((mode === 'review' || mode === 'publish') && !isReady) {
      if (contentIssues.length) {
        setSaveError(`Chưa thể xuất bản: ${contentIssues.slice(0, 3).join(' ')}`)
        return
      }
      setSaveError('Hãy hoàn thiện thông tin, kết quả, yêu cầu, thiết lập hoàn thành 50–100% và ít nhất 6 bài học có tiêu đề/thời lượng cụ thể trước khi gửi duyệt hoặc xuất bản. Bạn vẫn có thể lưu bản nháp chưa hoàn thiện.')
      return
    }
    if (mode === 'publish' && !canPublish) {
      setSaveError('Vai trò hiện tại chỉ có thể gửi khóa học để duyệt.')
      return
    }

    const publicationStatus = mode === 'publish'
      ? 'published'
      : mode === 'review'
        ? 'review'
        : course.publicationStatus === 'review' || course.publicationStatus === 'scheduled' || course.publicationStatus === 'archived'
          ? course.publicationStatus
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
        await onSave(nextCourse, mode === 'publish')
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

  const navigateBack = () => onNavigate('admin-courses')

  const saveFromHeader = () => {
    void save(isPublished ? 'publish' : 'draft')
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
    window.setTimeout(() => coverInputRef.current?.focus(), 0)
  }

  return (
    <div className="course-editor-page">
      <header className="editor-header">
        <button className="back-button" onClick={navigateBack}><ArrowLeft size={18} /> Khóa học</button>
        <div className="editor-title"><span className={`draft-dot ${course.publicationStatus}`} /><div><strong>{course.title || 'Khóa học mới'}</strong><small>{publicationLabels[course.publicationStatus]} · {lessonTotal} bài học</small></div></div>
        <div className="editor-actions"><button className="outline-button" onClick={() => setActiveStep(4)}><Play size={16} /> Kiểm tra</button><button className="primary-button" onClick={saveFromHeader} disabled={saving || (isPublished && !canPublish)} title={isPublished && !canPublish ? 'Chỉ Administrator có quyền cập nhật trực tiếp khóa học đã xuất bản.' : undefined}>{(isPublished ? savedMode === 'publish' : savedMode === 'draft') ? <Check size={17} /> : <Save size={17} />}{saving ? 'Đang lưu...' : isPublished ? savedMode === 'publish' ? 'Đã cập nhật' : canPublish ? 'Lưu cập nhật' : 'Cần Admin' : savedMode === 'draft' ? saveTarget === 'firebase' ? 'Đã lưu' : 'Đã lưu' : 'Lưu bản nháp'}</button></div>
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
            onClick={() => setActiveStep(item.step)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="editor-layout">
        <aside className="builder-summary unified-editor-sidebar">
          {/* Top Header & Cover Box */}
          <div className="sidebar-course-header">
            <div className={`course-cover-editor ${course.coverUrl ? 'has-image' : ''}`}>
              {course.coverUrl && <img src={course.coverUrl} alt="" />}
              <div className="cover-pattern"><i /><i /></div>
              {!course.coverUrl && <BookOpen size={38} />}
              <button type="button" onClick={focusCoverInput}>
                <Image size={15} /> {course.coverUrl ? 'Đổi ảnh bìa' : 'Thêm ảnh bìa'}
              </button>
            </div>
            <div className="sidebar-course-copy">
              <span className={`status-pill-mini ${course.publicationStatus}`}>
                {publicationLabels[course.publicationStatus]}
              </span>
              <h2>{course.title || 'Khóa học chưa đặt tên'}</h2>
              <p>{course.description || 'Chưa có mô tả ngắn cho khóa học này.'}</p>
            </div>
          </div>

          {/* Completeness Bar */}
          <div className="builder-completeness">
            <div>
              <span>Mức độ hoàn thiện</span>
              <strong>{completeness}%</strong>
            </div>
            <i>
              <span style={{ width: `${completeness}%` }} />
            </i>
            <small>
              {isReady
                ? 'Khóa học đã đủ điều kiện gửi duyệt / xuất bản.'
                : 'Hoàn thiện các trường bắt buộc trước khi xuất bản.'}
            </small>
          </div>

          {/* Grouped Vertical Section Navigation Menu */}
          <div className="editor-nav-group">
            <span className="nav-group-label">NỘI DUNG BIÊN TẬP</span>
            <nav className="editor-sections-menu" aria-label="Danh mục các phần biên tập khóa học">
              {[
                {
                  step: 1,
                  title: '1. Thông tin cơ bản',
                  subtitle: 'Tên, mô tả, danh mục & kết quả',
                  icon: FileText,
                  done: Boolean(course.title && course.description),
                },
                {
                  step: 2,
                  title: '2. Chương & Bài học',
                  subtitle: `${course.modules.length} chương · ${lessonTotal} bài`,
                  icon: Layers,
                  done: curriculumReady && lessonTotal >= 6,
                },
                {
                  step: 3,
                  title: '3. Thiết lập & Quyền',
                  subtitle: `${course.settings.accessTier === 'pro' ? 'Aura Pro' : 'Miễn phí'} · ${course.settings.visibility === 'private' ? 'Riêng tư' : 'Thành viên'}`,
                  icon: Settings2,
                  done: settingsReady,
                },
                {
                  step: 4,
                  title: '4. Kiểm tra & Xuất bản',
                  subtitle: isReady ? 'Đã sẵn sàng ra mắt' : 'Cần hoàn thiện checklist',
                  icon: ShieldCheck,
                  done: isReady,
                },
              ].map((item) => {
                const ItemIcon = item.icon
                const isActive = activeStep === item.step
                return (
                  <button
                    key={item.step}
                    type="button"
                    className={`section-menu-item ${isActive ? 'active' : ''} ${item.done ? 'is-done' : ''}`}
                    onClick={() => setActiveStep(item.step)}
                  >
                    <span className="menu-item-icon">
                      <ItemIcon size={18} />
                    </span>
                    <div className="menu-item-content">
                      <strong className="menu-item-title">{item.title}</strong>
                      <small className="menu-item-sub">{item.subtitle}</small>
                    </div>
                    {item.done ? (
                      <span className="menu-item-check" title="Đã hoàn thành mục này">
                        <CheckCircle2 size={16} />
                      </span>
                    ) : (
                      <span className="menu-item-badge">B{item.step}</span>
                    )}
                  </button>
                )
              })}
            </nav>
          </div>

          {/* Bottom Integrated Meta Footer */}
          <div className="sidebar-meta-footer">
            <div className="meta-footer-item">
              <Clock3 size={15} />
              <span>{course.duration || 'Chưa đặt thời lượng'}</span>
            </div>
            <div className="meta-footer-item">
              <GraduationCap size={15} />
              <span>{course.coach || 'Chưa phân công giảng viên'}</span>
            </div>
          </div>
        </aside>

        <main className="curriculum-builder">
          {activeStep === 1 && (
            <section className="editor-step-panel">
              <div className="builder-heading"><div><span className="eyebrow">BƯỚC 1 / 4</span><h1>Thông tin cơ bản</h1><p>Định vị khóa học rõ ràng để học viên biết mình sẽ đạt được gì.</p></div></div>
              <div className="course-form-grid">
                <label className="span-2"><span>Tên khóa học *</span><input value={course.title} onChange={(event) => updateField('title', event.target.value)} /></label>
                <label className="span-2"><span>Slug *</span><input value={course.slug} onChange={(event) => updateField('slug', event.target.value)} /></label>
                <label className="span-2"><span>URL ảnh bìa</span><input ref={coverInputRef} type="url" inputMode="url" value={course.coverUrl ?? ''} onChange={(event) => updateField('coverUrl', event.target.value)} placeholder="https://.../anh-khoa-hoc.jpg" /><small>Dùng ảnh ngang tối thiểu 1200 × 675 px để hiển thị sắc nét trên mọi thiết bị.</small></label>
                <label className="span-2"><span>Mô tả *</span><textarea value={course.description} onChange={(event) => updateField('description', event.target.value)} /></label>
                <label><span>Danh mục</span><select value={course.category} onChange={(event) => updateField('category', event.target.value)}>{!['Dinh dưỡng nền tảng', 'Dinh dưỡng giảm mỡ', 'Dinh dưỡng tăng cơ', 'Dinh dưỡng thể thao', 'Dinh dưỡng chuyên sâu', 'Chứng nhận chuyên môn'].includes(course.category) ? <option>{course.category}</option> : null}<option>Dinh dưỡng nền tảng</option><option>Dinh dưỡng giảm mỡ</option><option>Dinh dưỡng tăng cơ</option><option>Dinh dưỡng thể thao</option><option>Dinh dưỡng chuyên sâu</option><option>Chứng nhận chuyên môn</option></select></label>
                <label><span>Cấp độ</span><select value={course.level} onChange={(event) => updateField('level', event.target.value)}><option>Cơ bản</option><option>Trung cấp</option><option>Nâng cao</option><option>Mọi cấp độ</option></select></label>
                <label><span>Giảng viên *</span><input value={course.coach} onChange={(event) => updateField('coach', event.target.value)} /></label>
                <label><span>Thời lượng</span><input value={course.duration} onChange={(event) => updateField('duration', event.target.value)} /></label>
                <label><span>Kết quả đầu ra · mỗi dòng một ý</span><textarea value={course.outcomes.join('\n')} onChange={(event) => updateField('outcomes', event.target.value.split('\n').filter(Boolean))} /></label>
                <label><span>Yêu cầu tham gia · mỗi dòng một ý</span><textarea value={course.requirements.join('\n')} onChange={(event) => updateField('requirements', event.target.value.split('\n').filter(Boolean))} /></label>
              </div>
            </section>
          )}

          {activeStep === 2 && (
            <section className="editor-step-panel">
              <div className="builder-heading"><div><span className="eyebrow">BƯỚC 2 / 4</span><h1>Nội dung Aura Academy</h1><p>Thiết kế khóa đào tạo dinh dưỡng chuyên sâu, độc lập hoàn toàn với giáo án PT.</p></div><button className="outline-button" onClick={addModule}><Plus size={17} /> Thêm chương</button></div>
              <div className="builder-tip"><span>💡</span><p><strong>Nhịp học ghi nhớ sâu</strong>Kết hợp video, bài đọc, tóm tắt 60 giây, active recall, flashcard và quiz kiểm tra.</p></div>
              <div className="module-list">
                {course.modules.map((module, moduleIndex) => (
                  <article className="builder-module editable" key={module.id}>
                    <header><GripVertical size={18} /><span className="module-number">{moduleIndex + 1}</span><input value={module.title} onChange={(event) => updateModule(moduleIndex, { title: event.target.value })} /><small>{module.lessons.length} bài</small><button title="Xóa chương" onClick={() => removeModule(moduleIndex)}><Trash2 size={16} /></button></header>
                    <div className="builder-lessons">
                      {module.lessons.map((item, lessonIndex) => {
                        const Icon = lessonIcons[item.type] ?? FileText
                        return <div className="builder-lesson editable" key={item.id}><GripVertical size={16} /><span className={`lesson-type-icon ${item.type === 'Video' ? 'purple' : item.type === 'Quiz' ? 'orange' : 'blue'}`}><Icon size={17} /></span><input value={item.title} onChange={(event) => updateLesson(moduleIndex, lessonIndex, { title: event.target.value })} /><select value={item.type} onChange={(event) => updateLessonType(moduleIndex, lessonIndex, event.target.value as CourseLessonType)}>{lessonTypes.map((type) => <option key={type}>{type}</option>)}</select><input className="duration-input" value={item.duration} onChange={(event) => updateLesson(moduleIndex, lessonIndex, { duration: event.target.value })} /><label className="preview-toggle"><input type="checkbox" checked={Boolean(item.preview)} onChange={(event) => updateLesson(moduleIndex, lessonIndex, { preview: event.target.checked })} /> Xem thử</label><button title="Xóa bài" onClick={() => removeLesson(moduleIndex, lessonIndex)}><Trash2 size={16} /></button></div>
                      })}
                      <button className="add-lesson-button" onClick={() => addLesson(moduleIndex)}><Plus size={16} /> Thêm bài học</button>
                    </div>
                  </article>
                ))}
              </div>
              <div className="builder-lesson-editor">
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
                        <label className="span-2"><span>Điều kiện hoàn thành</span>
                          <div className="course-form-grid form-grid-2col">
                            <select
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
                        </label>
                        <div className="span-2">
                          <AcademyLessonMemoryEditor content={detailAcademyContent} onChange={updateAcademyContent} />
                        </div>
                        <label className="span-2"><span>Tài nguyên học liệu</span>
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
                              <select value={resource.kind} onChange={(event) => updateLessonResource(detailLessonModuleIndex, detailLessonIndex, resourceIndex, { kind: event.target.value as LessonResourceKind })}>
                                {(Object.keys(resourceTypeLabels) as LessonResourceKind[]).map((kind) => (
                                  <option key={kind} value={kind}>{resourceTypeLabels[kind]}</option>
                                ))}
                              </select>
                              <input
                                className="resource-title"
                                value={resource.title}
                                onChange={(event) => updateLessonResource(detailLessonModuleIndex, detailLessonIndex, resourceIndex, { title: event.target.value })}
                                placeholder="Tên tài nguyên"
                              />
                              <div className="resource-url">
                                <input
                                  value={resource.url}
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
                                value={resource.note ?? ''}
                                onChange={(event) => updateLessonResource(detailLessonModuleIndex, detailLessonIndex, resourceIndex, { note: event.target.value })}
                                placeholder="Ghi chú tài nguyên (nội bộ cho bài học)"
                              />
                              <button type="button" title="Xóa tài nguyên" onClick={() => removeLessonResource(detailLessonModuleIndex, detailLessonIndex, resourceIndex)}><Trash2 size={14} /></button>
                            </div>
                          ))}
                        </div>
                        <button type="button" className="outline-button" onClick={() => addLessonResource(detailLessonModuleIndex, detailLessonIndex)}><PlusCircle size={14} /> Thêm tài nguyên</button>
                      </label>
                      {detailLesson?.type === 'Quiz' && (
                        <label className="span-2">
                          <span>Quiz builder</span>
                          <div className="builder-quiz-head">
                            <select value={detailLesson.quiz?.questionOrder ?? 'sequential'} onChange={(event) => updateLesson(detailLessonModuleIndex, detailLessonIndex, { quiz: { ...(detailLesson.quiz ?? createDefaultQuiz()), questionOrder: event.target.value as 'sequential' | 'shuffle' } })}>
                              <option value="sequential">Theo thứ tự</option>
                              <option value="shuffle">Ngẫu nhiên</option>
                            </select>
                            <select value={detailLesson.quiz?.passPercent ?? 70} onChange={(event) => updateLesson(detailLessonModuleIndex, detailLessonIndex, { quiz: { ...(detailLesson.quiz ?? createDefaultQuiz()), passPercent: Number(event.target.value) } })}>
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
                          {(detailLesson.quiz?.questions ?? []).map((question, questionIndex) => (
                            <div className="builder-question" key={question.id}>
                              <div className="builder-question-head"><span>Câu hỏi {questionIndex + 1}</span><button onClick={() => removeQuizQuestion(detailLessonModuleIndex, detailLessonIndex, questionIndex)}><Trash2 size={13} /></button></div>
                              <textarea value={question.question} onChange={(event) => updateQuizQuestion(detailLessonModuleIndex, detailLessonIndex, questionIndex, { question: event.target.value })} />
                              <div className="builder-quiz-options">
                                {question.options.map((option, optionIndex) => (
                                  <label key={`${question.id}-${optionIndex}`}>
                                    <input type="radio" checked={question.correctIndex === optionIndex} onChange={() => updateQuizQuestion(detailLessonModuleIndex, detailLessonIndex, questionIndex, { correctIndex: optionIndex })} />
                                    <input value={option} onChange={(event) => updateQuizOption(detailLessonModuleIndex, detailLessonIndex, questionIndex, optionIndex, event.target.value)} />
                                    {question.options.length > 2 ? <button className="outline-button small" onClick={() => removeQuizOption(detailLessonModuleIndex, detailLessonIndex, questionIndex, optionIndex)}><X size={12} /></button> : <span />}
                                  </label>
                                ))}
                              </div>
                              <button className="outline-button" onClick={() => updateQuizQuestion(detailLessonModuleIndex, detailLessonIndex, questionIndex, { options: [...question.options, ''] })}><Plus size={13} /> Thêm đáp án</button>
                            </div>
                          ))}
                          <button className="outline-button" onClick={() => addQuizQuestion(detailLessonModuleIndex, detailLessonIndex)}><Plus size={14} /> Thêm câu hỏi</button>
                        </label>
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
            <section className="editor-step-panel">
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
              <div className="publish-review-grid">
                <article className="publish-preview-card"><div className={`preview-cover ${course.coverUrl ? 'has-image' : ''}`}>{course.coverUrl ? <img src={course.coverUrl} alt={`Ảnh bìa ${course.title}`} /> : <BookOpen size={46} />}</div><span>{course.category} · {course.level}</span><h2>{course.title}</h2><p>{course.description}</p><div><strong>{course.modules.length}</strong><small>chương</small><strong>{lessonTotal}</strong><small>bài học</small><strong>{course.duration}</strong><small>thời lượng</small></div></article>
                <article className="publish-checklist"><h2>Checklist xuất bản</h2>{[
                  ['Thông tin khóa học', Boolean(course.title && course.description)],
                  ['Giáo trình không còn bài placeholder', curriculumReady && lessonTotal >= 6],
                  ['Mục tiêu và yêu cầu', course.outcomes.length > 0 && course.requirements.length > 0],
                  ['Thiết lập quyền truy cập', Boolean(course.settings.accessTier)],
                  ['Ngưỡng hoàn thành hợp lệ', settingsReady],
                  ['Giảng viên phụ trách', Boolean(course.coach)],
                ].map(([label, done]) => <div key={String(label)} className={done ? 'done' : ''}><span>{done ? <Check size={15} /> : '!'}</span><strong>{label}</strong></div>)}<div className="publish-permission"><ShieldCheck size={18} /><p><strong>{canPublish ? 'Bạn có quyền xuất bản' : 'Cần Administrator duyệt'}</strong><small>{canPublish ? 'Khóa học sẽ hiển thị cho học viên ngay sau khi đồng bộ.' : 'Khóa học sẽ chuyển sang trạng thái chờ duyệt.'}</small></p></div></article>
              </div>
            </section>
          )}

          {saveError && <div className="builder-save-error">{saveError}</div>}
          <div className="editor-footer"><span>{isDirty ? <Clock3 size={16} /> : <Check size={16} />} {saving ? saveTarget === 'firebase' ? 'Đang đồng bộ với Firebase...' : 'Đang lưu bản demo...' : isDirty ? 'Có thay đổi chưa lưu' : savedMode ? saveTarget === 'firebase' ? 'Đã đồng bộ với Firebase' : 'Đã lưu bản demo trên thiết bị' : 'Không có thay đổi chưa lưu'}</span><div>{activeStep > 1 && <button className="outline-button" onClick={() => setActiveStep((step) => step - 1)}>Quay lại</button>}{activeStep < 4 ? <button className="primary-button" onClick={() => setActiveStep((step) => step + 1)}>Tiếp tục <ChevronRight size={17} /></button> : <>{!isPublished && <button className="outline-button" onClick={() => void save('draft')} disabled={saving}>Lưu nháp</button>}<button className="primary-button" onClick={() => void save(isPublished ? 'publish' : canPublish ? 'publish' : 'review')} disabled={saving || !isReady || (isPublished && !canPublish)}>{isPublished && !canPublish ? <><ShieldCheck size={17} /> Cần Admin cập nhật</> : canPublish ? <><ShieldCheck size={17} /> {isPublished ? 'Cập nhật khóa học' : 'Xuất bản khóa học'}</> : <><Save size={17} /> Gửi duyệt</>}</button></>}</div></div>
        </main>
      </div>
    </div>
  )
}
