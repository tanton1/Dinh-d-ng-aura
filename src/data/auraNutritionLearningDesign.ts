import type {
  AcademyLearningDesignV1,
  AcademyLearningCard,
  AcademyKnowledgeCheck,
} from '../types'
import type { AuraNutritionStudyGuide } from './auraNutritionStudyGuides'
import { applyAuraPracticePolicy } from './auraNutritionPracticePolicy'

export type LearningChapterSource = {
  number: number
  title: string
  promise: string
  objectives: readonly string[]
  takeaways: readonly string[]
  practiceTitle: string
  practiceSteps: readonly string[]
  practiceResult: string
  safety: string
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
    practice: applyAuraPracticePolicy(source.number, {
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
    }),
    safetyGate: {
      title: 'Tôi hiểu giới hạn an toàn',
      body: source.safety,
      mustAcknowledge: true,
    },
  }
}
