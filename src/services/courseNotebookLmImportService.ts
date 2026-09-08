import type {
  CourseContentProvenance,
  LessonQuizQuestionDraft,
  LessonResourceKind,
} from '../types'

export type NotebookLmImportMode = 'append' | 'replace' | 'new-lesson'

export interface NotebookLmImportManifest {
  courseId?: string
  moduleId?: string
  lessonId?: string
  chapterTitle?: string
  lessonTitle?: string
  source?: string
  sourceUrl?: string
  generatedAt?: string
}

export interface NotebookLmImportIssue {
  level: 'error' | 'warning'
  file: string
  row?: number
  message: string
}

export interface NotebookLmImportPreview {
  manifest?: NotebookLmImportManifest
  flashcards: Array<{ front: string; back: string; hint?: string }>
  quizQuestions: Array<Pick<LessonQuizQuestionDraft, 'question' | 'options' | 'explanation' | 'difficulty' | 'mustPass'> & { correctIndex: number }>
  media: Array<{ file?: File; url?: string; title: string; kind: Extract<LessonResourceKind, 'slide' | 'video' | 'document'> }>
  issues: NotebookLmImportIssue[]
  source: CourseContentProvenance
  counts: { files: number; flashcards: number; quizQuestions: number; media: number }
}

const MAX_FLASHCARDS = 50
const MAX_QUIZ_QUESTIONS = 100
const MAX_TEXT_LENGTH = 3000

function clean(value: unknown, maximum = MAX_TEXT_LENGTH) {
  return typeof value === 'string' ? value.replace(/^\uFEFF/, '').trim().slice(0, maximum) : ''
}

function csvRows(text: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    const next = text[index + 1]
    if (character === '"' && quoted && next === '"') {
      cell += '"'
      index += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === ',' && !quoted) {
      row.push(cell)
      cell = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1
      row.push(cell)
      if (row.some((item) => item.trim())) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += character
    }
  }
  row.push(cell)
  if (row.some((item) => item.trim())) rows.push(row)
  return rows
}

function normalizedHeader(value: string) {
  return clean(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '')
}

function pickField(record: Record<string, string>, names: string[]) {
  const wanted = new Set(names.map(normalizedHeader))
  const key = Object.keys(record).find((item) => wanted.has(normalizedHeader(item)))
  return key ? clean(record[key]) : ''
}

function parseFlashcards(text: string, fileName: string, issues: NotebookLmImportIssue[]) {
  const rows = csvRows(text)
  if (rows.length < 2) {
    issues.push({ level: 'error', file: fileName, message: 'CSV cần một dòng tiêu đề và ít nhất một flashcard.' })
    return []
  }
  const headers = rows[0]
  const cards: Array<{ front: string; back: string; hint?: string }> = []
  rows.slice(1).forEach((values, index) => {
    const record = Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] ?? '']))
    const front = pickField(record, ['front', 'question', 'term', 'mat truoc', 'cau hoi'])
    const back = pickField(record, ['back', 'answer', 'definition', 'mat sau', 'dap an', 'giai thich'])
    const hint = pickField(record, ['hint', 'cue', 'goi y'])
    if (!front || !back) {
      issues.push({ level: 'error', file: fileName, row: index + 2, message: 'Thiếu cột front/mặt trước hoặc back/mặt sau.' })
      return
    }
    cards.push({ front, back, ...(hint ? { hint } : {}) })
  })
  if (cards.length > MAX_FLASHCARDS) issues.push({ level: 'error', file: fileName, message: `Flashcard vượt giới hạn ${MAX_FLASHCARDS} thẻ cho một lần nhập.` })
  return cards.slice(0, MAX_FLASHCARDS)
}

function parseQuiz(value: unknown, fileName: string, issues: NotebookLmImportIssue[]) {
  const rawQuestions = Array.isArray(value) ? value : value && typeof value === 'object' && Array.isArray((value as { questions?: unknown }).questions) ? (value as { questions: unknown[] }).questions : []
  if (!rawQuestions.length) {
    issues.push({ level: 'error', file: fileName, message: 'JSON quiz chưa có mảng questions.' })
    return []
  }
  const questions: NotebookLmImportPreview['quizQuestions'] = []
  rawQuestions.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      issues.push({ level: 'error', file: fileName, row: index + 1, message: 'Câu hỏi không phải object JSON.' })
      return
    }
    const item = raw as Record<string, unknown>
    const question = clean(item.question ?? item.prompt, 2000)
    const options = Array.isArray(item.options) ? item.options.map((option) => clean(option, 1000)).filter(Boolean) : []
    let correctIndex = Number.isInteger(item.correctIndex) ? Number(item.correctIndex) : -1
    if (correctIndex < 0 && typeof item.correctAnswer === 'string') correctIndex = options.findIndex((option) => option === clean(item.correctAnswer))
    if (!question || options.length < 2 || options.length > 10 || correctIndex < 0 || correctIndex >= options.length) {
      issues.push({ level: 'error', file: fileName, row: index + 1, message: 'Câu hỏi cần nội dung, 2–10 lựa chọn và correctIndex hợp lệ.' })
      return
    }
    const difficulty = Number(item.difficulty)
    questions.push({
      question,
      options,
      correctIndex,
      ...(clean(item.explanation, 3000) ? { explanation: clean(item.explanation, 3000) } : {}),
      ...(difficulty >= 1 && difficulty <= 3 ? { difficulty: difficulty as 1 | 2 | 3 } : {}),
      ...(item.mustPass === true ? { mustPass: true } : {}),
    })
  })
  if (questions.length > MAX_QUIZ_QUESTIONS) issues.push({ level: 'error', file: fileName, message: `Quiz vượt giới hạn ${MAX_QUIZ_QUESTIONS} câu cho một lần nhập.` })
  return questions.slice(0, MAX_QUIZ_QUESTIONS)
}

function mediaKind(file: File): NotebookLmImportPreview['media'][number]['kind'] | undefined {
  const name = file.name.toLowerCase()
  if (file.type.startsWith('video/') || /\.(mp4|webm|ogg|mov)$/i.test(name)) return 'video'
  if (file.type === 'application/pdf' || /\.(pdf|ppt|pptx)$/i.test(name)) return 'slide'
  if (/\.(doc|docx|txt)$/i.test(name)) return 'document'
  return undefined
}

function fileWithInferredType(file: File) {
  if (file.type && file.type !== 'application/octet-stream') return file
  const extension = file.name.toLowerCase().split('.').pop() ?? ''
  const contentType: Record<string, string> = {
    mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg', mov: 'video/quicktime',
    pdf: 'application/pdf', ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain',
  }
  return contentType[extension] ? new File([file], file.name, { type: contentType[extension], lastModified: file.lastModified }) : file
}

async function contentHash(files: File[]) {
  const input = files.map((file) => `${file.name}:${file.size}:${file.lastModified}`).join('|')
  if (globalThis.crypto?.subtle) {
    const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
    return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  return input.slice(0, 200)
}

export async function parseNotebookLmFiles(input: File[] | FileList): Promise<NotebookLmImportPreview> {
  const files = Array.from(input)
  const issues: NotebookLmImportIssue[] = []
  let manifest: NotebookLmImportManifest | undefined
  const flashcards: NotebookLmImportPreview['flashcards'] = []
  const quizQuestions: NotebookLmImportPreview['quizQuestions'] = []
  const media: NotebookLmImportPreview['media'] = []
  for (const file of files) {
    const lowerName = file.name.toLowerCase()
    if (lowerName.endsWith('.csv')) {
      flashcards.push(...parseFlashcards(await file.text(), file.name, issues))
      continue
    }
    if (lowerName.endsWith('.json')) {
      try {
        const parsed = JSON.parse(await file.text()) as unknown
        if (lowerName.includes('manifest')) {
          if (!parsed || typeof parsed !== 'object') throw new Error('manifest phải là object JSON.')
          manifest = parsed as NotebookLmImportManifest
        } else {
          quizQuestions.push(...parseQuiz(parsed, file.name, issues))
        }
      } catch (error) {
        issues.push({ level: 'error', file: file.name, message: error instanceof Error ? error.message : 'JSON không hợp lệ.' })
      }
      continue
    }
    if (lowerName.endsWith('.txt') && /video[-_ ]?url/i.test(lowerName)) {
      const url = clean(await file.text(), 2000)
      if (/^https?:\/\//i.test(url)) {
        media.push({ url, title: file.name.replace(/\.[^.]+$/, ''), kind: 'video' })
      } else {
        issues.push({ level: 'error', file: file.name, message: 'File video-url.txt phải chứa một URL HTTP/HTTPS hợp lệ.' })
      }
      continue
    }
    const kind = mediaKind(file)
    if (kind) media.push({ file: fileWithInferredType(file), title: file.name.replace(/\.[^.]+$/, ''), kind })
    else issues.push({ level: 'warning', file: file.name, message: 'Định dạng chưa được nhận diện; file này sẽ bị bỏ qua.' })
  }
  if (flashcards.length > MAX_FLASHCARDS) {
    issues.push({ level: 'error', file: 'Flashcard', message: `Tổng số flashcard vượt giới hạn ${MAX_FLASHCARDS} thẻ cho một bài học.` })
    flashcards.length = MAX_FLASHCARDS
  }
  if (quizQuestions.length > MAX_QUIZ_QUESTIONS) {
    issues.push({ level: 'error', file: 'Quiz', message: `Tổng số câu hỏi vượt giới hạn ${MAX_QUIZ_QUESTIONS} câu cho một quiz.` })
    quizQuestions.length = MAX_QUIZ_QUESTIONS
  }
  if (media.length > 20) {
    issues.push({ level: 'error', file: 'Học liệu', message: 'Một bài học chỉ hỗ trợ tối đa 20 tài nguyên.' })
    media.length = 20
  }
  if (!flashcards.length && !quizQuestions.length && !media.length) {
    issues.push({ level: 'error', file: '—', message: 'Chưa tìm thấy flashcard, quiz, slide, video hoặc tài liệu để nhập.' })
  }
  if (!files.length) issues.push({ level: 'error', file: '—', message: 'Chọn ít nhất một file export từ NotebookLM.' })
  const artifactHash = await contentHash(files)
  const source: CourseContentProvenance = {
    provider: 'NotebookLM',
    ...(manifest?.sourceUrl ? { sourceUrl: clean(manifest.sourceUrl, 2000) } : {}),
    ...(manifest?.generatedAt ? { generatedAt: clean(manifest.generatedAt, 100) } : {}),
    artifactHash,
    importBatchId: `notebooklm-${artifactHash.slice(0, 16)}`,
  }
  return {
    manifest,
    flashcards,
    quizQuestions,
    media,
    issues,
    source,
    counts: { files: files.length, flashcards: flashcards.length, quizQuestions: quizQuestions.length, media: media.length },
  }
}

export function importPreviewHasErrors(preview: NotebookLmImportPreview | null) {
  return Boolean(preview?.issues.some((issue) => issue.level === 'error'))
}
