import assert from 'node:assert/strict'
import test from 'node:test'
import { getAcademyLearningDraft } from '../content/academy/learning-drafts'
import { getAcademyLearningCheckpoint } from '../content/academy/learning-checkpoints'
import { getAcademyMasteryCheckpoint } from '../content/academy/mastery-checkpoints'

const unit = (chapter: number) => getAcademyLearningDraft(chapter)!.unit
const round = (value: number, digits = 2) => Number(value.toFixed(digits))
function answer(chapter: number, includes: string) {
  const question = getAcademyLearningCheckpoint(chapter)!.find((item) => item.question.includes(includes))
  assert.ok(question, `missing question ${chapter}: ${includes}`)
  return question.options[question.correctIndex!]
}

test('recomp arithmetic keeps estimated compartments distinct from muscle and confidence intervals', () => {
  const examples = unit(15).workedExamples
  assert.deepEqual([70 * 0.3, round(70 * 0.28)], [21, 19.6])
  assert.deepEqual([70 - 21, 70 - 19.6], [49, 50.4])
  assert.equal(round(19.6 - 21), -1.4)
  assert.match(examples[0].answer, /−1,4 kg mỡ.*\+1,4 kg không mỡ.*chưa xác nhận/)
  assert.equal(round(70 * (0.32 - 0.28)), 2.8)
  assert.match(examples[1].answer, /19,6; 21,0; 22,4.*2,8 kg/)
  assert.match(examples[1].steps.join(' '), /không phải khoảng tin cậy 95%/)
  assert.equal((22 - 20) / 20 * 100, 10)
  assert.match(examples[2].answer, /10% về tải ngoài.*chưa đủ.*tăng cơ.*giảm mỡ/)
  assert.equal(round(80 * (0.25 - 0.23)), 1.6)
  assert.match(answer(15, 'cùng 80 kg'), /−1,6.*\+1,6.*chưa xác nhận riêng cơ/)
  assert.equal(round(80 * (0.27 - 0.23)), 3.2)
  assert.match(answer(15, 'ba kịch bản'), /3,2 kg.*không là khoảng tin cậy/)
  assert.match(unit(15).sections[1].paragraphs.join(' '), /bốn tuần.*40 nam trẻ.*10 nam trẻ.*mười tuần/s)
  assert.match(unit(15).sections[2].paragraphs.join(' '), /4–8 tuần.*lựa chọn tổ chức học tập.*không phải thời gian tối thiểu/s)
})

test('life-stage folate inventory neither double counts DFE nor becomes a personal prescription', () => {
  const example = unit(16).workedExamples[0]
  assert.equal(400 + 200, 600)
  assert.equal(600 / 1000, 0.6)
  assert.equal(680 + 400 + 200, 1280)
  assert.match(example.answer, /600 mcg folic acid = 0,6 mg.*không phải 1\.280.*chưa phải liều/)
  assert.match(example.steps.join(' '), /Không cộng 680 \+ 400.*chưa cộng folate từ thực phẩm/)
  assert.equal(200 + 100, 300)
  assert.match(answer(16, '340 mcg DFE'), /300 mcg = 0,3 mg.*chưa kết luận/)
  assert.match(answer(16, 'Tham chiếu CDC'), /Không.*phạm vi.*không tự chọn liều cao hay ngừng thuốc/)
  assert.match(unit(16).sections.find((item) => item.id === 'ch16-folate-label')!.paragraphs.join(' '), /400 microgram.*phạm vi.*không.*mọi tình huống/s)
})

test('life-stage teaching includes distinct contexts, scoped cycle evidence and non-experimental coordination', () => {
  const chapter = unit(16)
  assert.equal(chapter.sections.length, 6)
  const all = chapter.sections.flatMap((item) => item.paragraphs).join(' ')
  for (const phrase of ['vị thành niên', 'chu kỳ', 'trước và đầu thai kỳ', 'cho con bú', 'mãn kinh', 'tuổi cao']) assert.ok(all.includes(phrase), phrase)
  assert.match(all, /McNulty.*2020.*không phải nghiên cứu thực đơn/s)
  assert.match(all, /không.*lịch.*khí hậu Anh cho Việt Nam/s)
  assert.match(all, /không.*triệu chứng của em bé.*thay bữa của mẹ/s)
  assert.match(all, /không chờ đủ mọi triệu chứng hoặc cuộc hẹn coach/)
  assert.match(chapter.practice.artifact, /giả định|phiếu/i)
  assert.match(chapter.practice.artifact, /không phải thử chế độ ăn/)
  assert.match(chapter.workedExamples[1].answer, /khẩn cấp ngay.*tám tuần/)
  assert.match(answer(16, 'mười tuần'), /khẩn cấp.*không chờ coach/)
  assert.match(answer(16, 'không khai chu kỳ'), /ca giả định.*tối thiểu/)
})

test('behaviour examples distinguish opportunity, observed adherence, missingness and automaticity', () => {
  const chapter = unit(19)
  const example = chapter.workedExamples[1]
  assert.equal(3 / 4 * 100, 75)
  assert.equal(round(4 / 6 * 100, 1), 66.7)
  assert.equal(3 / 6 * 100, 50)
  assert.equal(round(5 / 6 * 100, 1), 83.3)
  assert.match(example.answer, /75%.*66,7%.*50–83,3%/)
  assert.match(example.limitation, /không là khoảng tin cậy/)
  assert.equal(2 * 4, 8)
  assert.match(answer(19, 'hai ca mỗi tuần'), /8 cơ hội.*chưa biết/)
  assert.equal(round(5 / 6 * 100, 1), 83.3)
  assert.equal(6 / 10 * 100, 60)
  assert.match(answer(19, '10 cơ hội'), /83,3%.*60%.*bốn lượt chưa rõ/)
  const theory = chapter.sections.map((item) => item.paragraphs.join(' ')).join(' ')
  assert.match(theory, /96 tình nguyện viên.*12 tuần.*không phải thử nghiệm ngẫu nhiên.*không phải lời hứa.*21 hoặc 66/s)
  assert.match(theory, /6N.*không phải.*phương pháp đã được thử nghiệm riêng/s)
  assert.match(theory, /“Tối thiểu” không có nghĩa ăn ít nhất, bỏ bữa/)
  assert.match(chapter.workedExamples[2].answer, /tối thiểu chưa bằng một bữa đã ăn/)
})

test('capstone arithmetic and the six-step process preserve limits on causality and review coverage', () => {
  const chapter = unit(20)
  assert.equal(6 / 8 * 100, 75)
  assert.equal(8 / 10 * 100, 80)
  assert.match(chapter.workedExamples[0].answer, /75%.*80%.*chưa xác định quan hệ nhân quả/)
  assert.equal(round(6 / 9 * 100, 1), 66.7)
  assert.equal(9 / 12 * 100, 75)
  assert.match(answer(20, '12 cơ hội'), /66,7%.*75%.*chưa đủ kết luận nhân quả/)
  assert.equal(4 / 5 * 100, 80)
  assert.equal(3 / 5 * 100, 60)
  assert.match(chapter.workedExamples[1].answer, /5\/5.*4\/5.*không hiển thị 100%/)
  assert.match(answer(20, 'chỉ ba có nhận xét'), /5\/5.*3\/5 = 60%.*lịch sử giữ riêng/)
  assert.equal(3 * 4, 12)
  const sixSteps = chapter.sections[0].paragraphs[0]
  for (const phrase of ['Định hướng', 'Đọc', 'Đặt ưu tiên', 'Đưa vào đời sống', 'Đo', 'Đánh giá']) assert.ok(sixSteps.includes(phrase))
  assert.match(sixSteps, /không phải mô hình lâm sàng đã được kiểm định riêng/)
  assert.match(chapter.workedExamples[2].steps.join(' '), /không chờ hết bốn tháng nếu có triệu chứng/)
})

test('portfolio milestones have independent practice, exact-version evidence and no professional credential claim', () => {
  const recomp = unit(15)
  const capstone = unit(20)
  assert.match(recomp.sections[3].paragraphs.join(' '), /Sau khi đã nộp thực hành 11–15.*Không yêu cầu portfolio được duyệt để nộp chính bài 15/s)
  assert.match(capstone.sections[3].paragraphs.join(' '), /nộp độc lập.*năm bản nộp cố định.*16–20.*không bắt portfolio xong trước khi nộp bài 20/s)
  assert.match(capstone.sections[3].paragraphs.join(' '), /phiên bản cũ không tự phê duyệt bản mới/)
  assert.match(capstone.title, /^Tự chủ dinh dưỡng/)
  assert.match(capstone.scope, /không tạo bằng cấp chuyên môn/)
  assert.match(answer(20, 'Trình tự bài 20'), /Nộp thực hành 20 rồi ghép.*không là chứng chỉ chuyên môn/)
  assert.match(capstone.cases[2].safeNextStep, /không hứa đã xóa lịch sử.*chưa xác minh/)
  assert.doesNotMatch(recomp.prerequisites.join(','), /(^|,)15(,|$)/)
  assert.doesNotMatch(capstone.prerequisites.join(','), /(^|,)20(,|$)/)
})

test('mastery checkpoints gate clinical delay, coercion and compensation and reject non-chapter inputs', () => {
  const gates: Record<number, number> = { 15: 3, 16: 3, 19: 2, 20: 2 }
  for (const [chapter, count] of Object.entries(gates)) {
    const bank = getAcademyMasteryCheckpoint(Number(chapter))!
    assert.equal(bank.length, 8)
    assert.equal(bank.filter((item) => item.mustPass).length, count)
    assert.equal(new Set(bank.map((item) => item.id)).size, 8)
    for (const item of bank) assert.equal(item.difficulty, item.mustPass ? 3 : 2)
  }
  assert.match(answer(15, 'không muốn gửi ảnh'), /không ép ảnh/)
  assert.match(answer(16, 'Thiếu niên'), /hướng dẫn phù hợp lứa tuổi/)
  assert.match(answer(19, 'tội lỗi'), /Không bù trừ.*theo dõi gây hại/)
  assert.match(answer(20, 'Muốn ngừng thuốc'), /Không tự ngừng.*người kê thuốc/)
  for (const chapter of [0, -1, 14, 17, 18, 21, 15.1, NaN, Infinity, '15'] as number[]) assert.equal(getAcademyMasteryCheckpoint(chapter), null)
})
