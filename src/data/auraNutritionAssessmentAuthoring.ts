import type { LessonQuizQuestionDraft } from '../types'
import type { LearningChapterSource } from './auraNutritionLearningDesign'
import type { AuraNutritionStudyGuide } from './auraNutritionStudyGuides'
import { auraPracticeMode } from './auraNutritionPracticePolicy'

const chapterId = (chapter: number) => `chapter-${String(chapter).padStart(2, '0')}`
const cardId = (chapter: number, suffix: string) => `${chapterId(chapter)}-card-${suffix}`
const competencyId = (chapter: number, suffix: string) => `${chapterId(chapter)}-${suffix}`

function sentence(value: string, maximum = 470) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maximum) return normalized
  return `${normalized.slice(0, maximum - 1).trimEnd()}…`
}

export function buildAuraNutritionQuestionBank(
  source: LearningChapterSource & { quiz: ReadonlyArray<{ question: string; options: readonly string[]; correctIndex: number }> },
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
      options: [auraPracticeMode(source.number) === 'coordination' ? 'Xác minh thông tin và liên hệ chuyên môn phù hợp trước khi thay đổi kế hoạch.' : auraPracticeMode(source.number) === 'evidence' ? 'Truy nguồn, kiểm tra đối tượng và độ bất định trước khi quyết định có áp dụng hay không.' : 'Ghi dữ liệu nền, đổi một biến phù hợp phạm vi tự chăm sóc và đặt ngày rà.', 'Đổi đồng thời mọi phần của kế hoạch.', 'Kết luận nguyên nhân chỉ từ một lần quan sát.'],
      correctIndex: 0,
      explanation: auraPracticeMode(source.number) === 'coordination' ? source.safety : 'Cần kiểm tra phạm vi an toàn và dữ liệu trước khi chọn hành động; không mặc định mọi tình huống đều cần thử thay đổi chế độ ăn.',
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
    question: `Để vận dụng kiến thức Chương ${source.number} đúng phạm vi, lựa chọn nào đầy đủ nhất? ${sentence(challenge?.title ?? source.practiceTitle, 260)}`,
    options: [
      auraPracticeMode(source.number) === 'coordination' ? 'Chuẩn bị hồ sơ và câu hỏi, xác định đúng người phụ trách, không tự thay đổi điều trị.' : auraPracticeMode(source.number) === 'evidence' ? 'Kiểm tra nguồn gốc, mức phù hợp và độ chắc chắn; chưa tự thử sản phẩm chỉ vì có quảng cáo.' : 'Chọn một thay đổi nhỏ phù hợp, ghi dữ liệu tối thiểu, đặt ngày rà và nêu điều kiện dừng.',
      'Theo một thực đơn cứng trong thời gian dài mà không cần rà dữ liệu.',
      'Đổi nhiều biến cùng lúc để kết quả xuất hiện nhanh hơn.',
    ],
    correctIndex: 0,
    explanation: sentence(challenge?.days?.[0]?.reflection ?? 'Một thử nghiệm tốt cần giới hạn rõ, dữ liệu tối thiểu và mốc rà để biết nên giữ, chỉnh hay dừng.', 500),
    remediationCardIds: [card('decision'), card('reflection')],
  }
  return [...original, ...conceptQuestions, ...misconceptionQuestions, ...scenarioQuestions, ...caseQuestions, challengeQuestion]
}
