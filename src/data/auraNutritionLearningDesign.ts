import type {
  AcademyLearningDesignV1,
  AcademyLearningCard,
  AcademyKnowledgeCheck,
  LessonQuizQuestionDraft,
} from '../types'
import type { AuraNutritionStudyGuide } from './auraNutritionStudyGuides'

type LearningChapterSource = {
  number: number
  title: string
  promise: string
  objectives: readonly string[]
  takeaways: readonly string[]
  practiceTitle: string
  practiceSteps: readonly string[]
  practiceResult: string
  safety: string
  quiz: ReadonlyArray<{ question: string; options: readonly string[]; correctIndex: number }>
}

const chapterId = (chapter: number) => `chapter-${String(chapter).padStart(2, '0')}`
const cardId = (chapter: number, suffix: string) => `${chapterId(chapter)}-card-${suffix}`
const competencyId = (chapter: number, suffix: string) => `${chapterId(chapter)}-${suffix}`

function sentence(value: string, maximum = 470) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maximum) return normalized
  return `${normalized.slice(0, maximum - 1).trimEnd()}…`
}

function buildCards(source: LearningChapterSource, guide: AuraNutritionStudyGuide): AcademyLearningCard[] {
  const sections = guide.sections.slice(0, 3)
  const deepDive = guide.deepDive
  const concepts = sections.map((_, index) => competencyId(source.number, `concept-${index + 1}`))
  const decision = competencyId(source.number, 'decision')
  const safety = competencyId(source.number, 'safety')
  const misconception = guide.misconceptions[0] ?? ['Một quy tắc tuyệt đối luôn đúng', 'Dinh dưỡng cần được đọc theo dữ liệu và bối cảnh.']

  return [
    ...sections.map((section, index): AcademyLearningCard => ({
      id: cardId(source.number, `core-${index + 1}`),
      kind: index === 1 ? 'compare' : 'core',
      title: section.title,
      body: sentence(section.explanation),
      detail: sentence(section.points.join(' • '), 620),
      competencyIds: [concepts[index]],
    })),
    {
      id: cardId(source.number, 'model'),
      kind: 'model',
      title: deepDive?.visualModel.title ?? `Mô hình ra quyết định Chương ${source.number}`,
      body: sentence(deepDive?.visualModel.steps.map((step, index) => `${index + 1}. ${step.label}`).join(' → ') ?? source.objectives.join(' → ')),
      detail: 'Đi theo thứ tự, chỉ chuyển bước khi dữ liệu hiện tại đủ rõ. Đây là bản đồ suy nghĩ, không phải một luật cứng cho mọi người.',
      competencyIds: concepts,
    },
    {
      id: cardId(source.number, 'vietnam'),
      kind: 'vietnam-example',
      title: deepDive?.vietnamExample.title ?? 'Tình huống trong đời sống Việt',
      body: sentence(deepDive?.vietnamExample.before ?? guide.practiceExample),
      detail: sentence(`${deepDive?.vietnamExample.adjustment ?? source.practiceSteps[0]} ${deepDive?.vietnamExample.rationale ?? ''}`, 620),
      competencyIds: [concepts[0], decision],
    },
    {
      id: cardId(source.number, 'myth'),
      kind: 'myth',
      title: `Hiểu lầm: ${misconception[0]}`,
      body: sentence(misconception[1]),
      detail: 'Hãy kiểm tra lượng, tần suất, bối cảnh và xu hướng trước khi biến một quan sát thành kết luận.',
      competencyIds: [concepts[1] ?? concepts[0]],
    },
    {
      id: cardId(source.number, 'decision'),
      kind: 'decision',
      title: 'Bạn sẽ giữ, chỉnh hay dừng?',
      body: sentence(guide.workedExample),
      detail: `Quyết định tốt cần nêu một dữ liệu, một giả thuyết và một ngày rà. ${source.practiceResult}`,
      competencyIds: [decision],
    },
    {
      id: cardId(source.number, 'safety'),
      kind: 'safety',
      title: 'Cổng an toàn — không được bỏ qua',
      body: sentence(source.safety),
      detail: 'Nội dung này phục vụ giáo dục. Khi xuất hiện cờ đỏ, lựa chọn đúng là dừng tự thử và liên hệ người có chuyên môn phù hợp.',
      competencyIds: [safety],
    },
    ...(deepDive?.caseStudies?.slice(0, 3).map((caseStudy, index): AcademyLearningCard => ({
      id: cardId(source.number, `case-${index + 1}`),
      kind: 'decision',
      title: `Ca thực tế: ${caseStudy.name}`,
      body: sentence(`${caseStudy.context} Tín hiệu cần đọc: ${caseStudy.signal}`),
      detail: sentence(`Diễn giải: ${caseStudy.interpretation} Bước tiếp theo: ${caseStudy.nextStep}`, 620),
      competencyIds: [decision, concepts[index % concepts.length] ?? decision],
    })) ?? []),
    {
      id: cardId(source.number, 'reflection'),
      kind: 'reflection',
      title: 'Nối kiến thức với chính bạn',
      body: guide.reviewQuestions[0],
      detail: guide.reviewQuestions[2],
      competencyIds: [decision],
    },
  ]
}

function buildMicroChecks(source: LearningChapterSource, guide: AuraNutritionStudyGuide): AcademyKnowledgeCheck[] {
  const sections = guide.sections.slice(0, 3)
  const myth = guide.misconceptions[0] ?? ['Một quy tắc tuyệt đối', 'Cần xem bối cảnh và dữ liệu.']
  return [
    ...sections.map((section, index): AcademyKnowledgeCheck => ({
      id: `${chapterId(source.number)}-micro-${index + 1}`,
      competencyId: competencyId(source.number, `concept-${index + 1}`),
      prompt: `Cách hiểu nào phù hợp nhất với “${section.title}”?`,
      options: [
        { label: sentence(section.points[0] ?? section.explanation, 190), feedback: 'Đúng — lựa chọn này giữ đúng cơ chế và bối cảnh của chương.' },
        { label: `Chỉ cần áp dụng một quy tắc giống nhau cho mọi người.`, feedback: 'Chưa đúng — chương này yêu cầu đọc dữ liệu và bối cảnh trước khi quyết định.' },
        { label: `Một quan sát là đủ để kết luận chắc chắn.`, feedback: 'Chưa đúng — cần nhìn xu hướng, sai số và các tín hiệu liên quan.' },
      ],
      correctIndex: 0,
      remediationCardIds: [cardId(source.number, `core-${index + 1}`)],
    })),
    {
      id: `${chapterId(source.number)}-micro-myth`,
      competencyId: competencyId(source.number, 'decision'),
      prompt: `Nhận định “${myth[0]}” nên được xử lý thế nào?`,
      options: [
        { label: sentence(myth[1], 190), feedback: 'Đúng — đây là cách diễn giải có giới hạn và phù hợp với bằng chứng.' },
        { label: 'Coi đó là luật đúng cho mọi bữa ăn và mọi người.', feedback: 'Chưa đúng — một phát biểu tuyệt đối làm mất bối cảnh và dễ dẫn tới quyết định sai.' },
        { label: 'Bỏ qua dữ liệu cá nhân vì kinh nghiệm trên mạng đã đủ.', feedback: 'Chưa đúng — dữ liệu cá nhân được dùng để đặt câu hỏi, không phải để tự chẩn đoán.' },
      ],
      correctIndex: 0,
      remediationCardIds: [cardId(source.number, 'myth'), cardId(source.number, 'decision')],
    },
  ]
}

export function buildAuraNutritionLearningDesign(
  source: LearningChapterSource,
  guide: AuraNutritionStudyGuide,
): AcademyLearningDesignV1 {
  const id = chapterId(source.number)
  const competencyIds = [
    ...guide.sections.slice(0, 3).map((_, index) => competencyId(source.number, `concept-${index + 1}`)),
    competencyId(source.number, 'decision'),
    competencyId(source.number, 'safety'),
  ]
  return {
    version: 1,
    chapterId: id,
    competencyIds,
    cards: buildCards(source, guide),
    microChecks: buildMicroChecks(source, guide),
    practice: {
      version: 1,
      title: source.practiceTitle,
      outcome: source.practiceResult,
      fields: [
        { id: 'context', label: 'Dữ kiện và bối cảnh', prompt: 'Điều gì đã xảy ra, vào lúc nào và trong hoàn cảnh nào?', kind: 'long', required: true },
        { id: 'hypothesis', label: 'Giả thuyết tạm thời', prompt: 'Bạn nghĩ tín hiệu nào đáng kiểm chứng? Không dùng ô này để tự chẩn đoán.', kind: 'long', required: true },
        { id: 'action', label: 'Một hành động nhỏ', prompt: source.practiceSteps[1] ?? 'Bạn sẽ thử thay đổi đúng một biến nào?', kind: 'long', required: true },
        { id: 'minimum', label: 'Phiên bản ngày bận', prompt: 'Phiên bản nhỏ nhất vẫn làm được khi thiếu thời gian là gì?', kind: 'short', required: true },
        { id: 'data', label: 'Dữ liệu tối thiểu', prompt: 'Chọn 1–4 tín hiệu sẽ ghi, không tạo một dashboard quá tải.', kind: 'long', required: true },
        { id: 'stop', label: 'Điều kiện dừng hoặc hỏi chuyên môn', prompt: source.safety, kind: 'long', required: true },
        { id: 'reviewAt', label: 'Ngày rà lại', prompt: 'Chọn ngày đủ xa để đọc xu hướng nhưng không bỏ quên thử nghiệm.', kind: 'date', required: true },
      ],
      minimumEvidence: ['Bối cảnh và thời điểm', 'Một giả thuyết', 'Một thay đổi chính', 'Ít nhất một dữ liệu', 'Điều kiện dừng', 'Ngày rà'],
      safetyPrompt: source.safety,
    },
    safetyGate: {
      title: 'Tôi hiểu giới hạn an toàn',
      body: source.safety,
      mustAcknowledge: true,
    },
  }
}

export function buildAuraNutritionQuestionBank(
  source: LearningChapterSource,
  guide: AuraNutritionStudyGuide,
): LessonQuizQuestionDraft[] {
  const id = chapterId(source.number)
  const card = (suffix: string) => cardId(source.number, suffix)
  const original = source.quiz.map((question, index): LessonQuizQuestionDraft => ({
    id: `${id}-checkpoint-question-${index + 1}`,
    kind: 'single',
    competencyId: competencyId(source.number, `concept-${Math.min(index + 1, 3)}`),
    difficulty: 1,
    question: question.question,
    options: [...question.options],
    correctIndex: question.correctIndex,
    explanation: 'Đáp án đúng giữ nguyên cơ chế và giới hạn được trình bày trong chương.',
    remediationCardIds: [card(`core-${Math.min(index + 1, 3)}`)],
  }))
  const conceptQuestions = guide.sections.slice(0, 3).map((section, index): LessonQuizQuestionDraft => ({
    id: `${id}-checkpoint-question-${index + 4}`,
    kind: 'scenario',
    competencyId: competencyId(source.number, `concept-${index + 1}`),
    difficulty: 2,
    question: `Trong một tình huống thực tế, kết luận nào vận dụng đúng “${section.title}”?`,
    options: [
      sentence(section.points[0] ?? section.explanation, 220),
      'Áp dụng một quy tắc cứng mà không cần biết bối cảnh.',
      'Đổi nhiều biến cùng lúc để có kết quả nhanh hơn.',
    ],
    correctIndex: 0,
    explanation: sentence(section.explanation, 500),
    remediationCardIds: [card(`core-${index + 1}`)],
  }))
  const misconceptionQuestions = guide.misconceptions.slice(0, 3).map(([myth, fact], index): LessonQuizQuestionDraft => ({
    id: `${id}-checkpoint-question-${index + 7}`,
    kind: 'single',
    competencyId: competencyId(source.number, 'decision'),
    difficulty: 2,
    question: `Cách phản biện phù hợp nhất với nhận định “${myth}” là gì?`,
    options: [sentence(fact, 240), 'Đúng trong mọi trường hợp và không cần dữ liệu thêm.', 'Cần bỏ toàn bộ kế hoạch hiện tại ngay lập tức.'],
    correctIndex: 0,
    explanation: sentence(fact, 500),
    remediationCardIds: [card('myth'), card('decision')],
  }))
  const scenarioQuestions: LessonQuizQuestionDraft[] = [
    {
      id: `${id}-checkpoint-question-10`,
      kind: 'scenario',
      competencyId: competencyId(source.number, 'decision'),
      difficulty: 3,
      question: `Sau tình huống này, bước tiếp theo nào tạo được quyết định có thể kiểm chứng? ${sentence(guide.workedExample, 380)}`,
      options: ['Ghi dữ liệu nền, đổi một biến và đặt ngày rà.', 'Đổi đồng thời mọi phần của kế hoạch.', 'Kết luận nguyên nhân chỉ từ một lần quan sát.'],
      correctIndex: 0,
      explanation: 'Một thử nghiệm tốt phải đủ nhỏ để biết biến nào liên quan đến kết quả và có mốc rà rõ ràng.',
      remediationCardIds: [card('decision'), card('reflection')],
    },
    {
      id: `${id}-checkpoint-question-11`,
      kind: 'scenario',
      competencyId: competencyId(source.number, 'decision'),
      difficulty: 2,
      question: `Đầu ra nào đạt yêu cầu thực hành của Chương ${source.number}?`,
      options: [source.practiceResult, 'Một mục tiêu chung nhưng không có dữ liệu hoặc thời hạn.', 'Một danh sách thật dài các thay đổi phải làm ngay.'],
      correctIndex: 0,
      explanation: 'Đầu ra cần cụ thể, có thể làm, có dữ liệu tối thiểu và một ngày rà.',
      remediationCardIds: [card('decision')],
    },
    {
      id: `${id}-checkpoint-question-12`,
      kind: 'scenario',
      competencyId: competencyId(source.number, 'safety'),
      difficulty: 3,
      question: `Khi gặp cờ đỏ liên quan đến nội dung chương này, hành động an toàn là gì?`,
      options: ['Dừng tự thử và liên hệ người có chuyên môn phù hợp.', 'Tự tăng mức can thiệp để kiểm tra phản ứng.', 'Tiếp tục vì nội dung giáo dục có thể thay thế đánh giá y khoa.'],
      correctIndex: 0,
      explanation: source.safety,
      remediationCardIds: [card('safety')],
      mustPass: true,
    },
  ]
  const caseQuestions = (guide.deepDive?.caseStudies ?? []).slice(0, 3).map((caseStudy, index): LessonQuizQuestionDraft => ({
    id: `${id}-checkpoint-question-${index + 13}`,
    kind: 'scenario',
    competencyId: competencyId(source.number, 'decision'),
    difficulty: 3,
    question: `Ca thực tế “${caseStudy.name}”: tín hiệu nào nên dẫn đường cho bước tiếp theo? ${sentence(caseStudy.context, 260)}`,
    options: [
      sentence(`${caseStudy.signal} ${caseStudy.nextStep}`, 260),
      'Đổi đồng thời nhiều biến mà không cần thêm dữ liệu.',
      'Kết luận nguyên nhân chắc chắn chỉ từ một lần quan sát.',
    ],
    correctIndex: 0,
    explanation: sentence(caseStudy.interpretation, 500),
    remediationCardIds: [card(`case-${index + 1}`), card('decision')],
  }))
  const challenge = guide.deepDive?.challenge
  const challengeQuestion: LessonQuizQuestionDraft = {
    id: `${id}-checkpoint-question-16`,
    kind: 'scenario',
    competencyId: competencyId(source.number, 'decision'),
    difficulty: 3,
    question: `Để biến kiến thức Chương ${source.number} thành một thử nghiệm an toàn, lựa chọn nào đầy đủ nhất? ${sentence(challenge?.title ?? source.practiceTitle, 260)}`,
    options: [
      'Chọn một thay đổi nhỏ, ghi dữ liệu tối thiểu, đặt ngày rà và nêu điều kiện dừng.',
      'Theo một thực đơn cứng trong thời gian dài mà không cần rà dữ liệu.',
      'Đổi nhiều biến cùng lúc để kết quả xuất hiện nhanh hơn.',
    ],
    correctIndex: 0,
    explanation: sentence(challenge?.days?.[0]?.reflection ?? 'Một thử nghiệm tốt cần giới hạn rõ, dữ liệu tối thiểu và mốc rà để biết nên giữ, chỉnh hay dừng.', 500),
    remediationCardIds: [card('decision'), card('reflection')],
  }
  return [...original, ...conceptQuestions, ...misconceptionQuestions, ...scenarioQuestions, ...caseQuestions, challengeQuestion]
}
