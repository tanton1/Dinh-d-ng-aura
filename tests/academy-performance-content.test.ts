import assert from 'node:assert/strict'
import test from 'node:test'
import { getAcademyLearningDraft } from '../content/academy/learning-drafts'
import { getAcademyLearningCheckpoint } from '../content/academy/learning-checkpoints'
import { getAcademyPerformanceCheckpoint } from '../content/academy/performance-checkpoints'

const unit = (chapter: number) => getAcademyLearningDraft(chapter)!.unit
function answer(chapter: number, includes: string) {
  const item = getAcademyLearningCheckpoint(chapter)!.find((question) => question.question.includes(includes))
  assert.ok(item, `missing question ${chapter}: ${includes}`)
  return item.options[item.correctIndex!]
}
const round = (value: number, digits = 2) => Number(value.toFixed(digits))

test('chapter 11 checks timeline, label denominators and fluid-loss rate independently', () => {
  const examples = unit(11).workedExamples
  assert.equal(18 - 12, 6)
  assert.equal(20 - 19, 1)
  assert.match(examples[0].answer, /6 giờ.*1 giờ.*cần làm rõ/)
  assert.equal(6 * 500 / 100, 30)
  assert.equal(120 * 500 / 250, 240)
  assert.match(examples[1].answer, /30 g carbohydrate.*240 mg sodium/)
  assert.match(examples[1].steps.join(' '), /không tự đổi thành cùng khối lượng muối/)
  assert.equal(round((70 - 69.4 + 0.4) / 1), 1)
  assert.match(examples[2].answer, /1,0 lít.*không phải chỉ 0,6/)
  assert.match(examples[2].steps.join(' '), /Không đặt lượng bắt buộc uống.*sodium/)
  assert.equal(17 * 60 - (12 * 60 + 30), 270)
  assert.match(answer(11, '17:00–18:00'), /4 giờ 30 phút và 1 giờ/)
  assert.equal(8 * 375 / 100, 30)
  assert.match(answer(11, '375 ml'), /^30 g.*chưa biết/)
  assert.equal(round((60 - 59.5 + 0.4 - 0.15) / 1.5), 0.5)
  assert.match(answer(11, '90 phút tập'), /0,5 L\/giờ.*không là toa/)
})

test('chapter 12 distinguishes EA, total energy balance and sleep opportunity without diagnosing from arithmetic', () => {
  const examples = unit(12).workedExamples
  assert.equal(13 - 10, 3)
  assert.match(examples[0].steps.join(' '), /3 giờ.*24 giờ/)
  assert.equal((2400 - 600) / 50, 36)
  assert.equal(2400 - 2600, -200)
  assert.match(examples[1].answer, /36 kcal\/kg khối không mỡ\/ngày.*−200 kcal\/ngày/)
  assert.match(examples[1].steps.join(' '), /Không gọi 36 là xác nhận an toàn hay REDs/)
  assert.equal(8 * 60 - 30 - 45, 405)
  assert.match(examples[2].answer, /8 giờ.*6 giờ 45 phút.*chưa xác định/)
  assert.equal((2200 - 400) / 45, 40)
  assert.match(answer(12, '2.200 kcal'), /40 kcal\/kg khối không mỡ\/ngày.*chưa kết luận/)
  assert.equal(7.5 * 60 - 20 - 40, 390)
  assert.match(answer(12, '7 giờ 30 phút'), /6 giờ 30 phút.*không đo được chất lượng/)
  assert.match(unit(12).sections[1].paragraphs.join(' '), /không dùng cùng mẫu số.*Không có một kết quả EA đơn lẻ/)
  assert.match(unit(12).sections[2].paragraphs.join(' '), /18–60 tuổi.*ít nhất bảy giờ.*không là một mức chính xác/)
})

test('chapter 13 sensitivity ranges are not confidence intervals and opposite endpoint/trend comparisons are correct', () => {
  const examples = unit(13).workedExamples
  assert.equal(2400 - 2100, 300)
  assert.deepEqual([2200 - 2200, 2600 - 2000], [0, 600])
  assert.match(examples[0].answer, /300 kcal\/ngày.*0–600 kcal\/ngày/)
  assert.match(examples[0].given.join(' '), /không phải số đo hay khoảng tin cậy/)
  const a = [70.6, 70.8, 70.4, 70.7, 70.5, 70.9, 70.3]
  const b = [70.3, 70.5, 70.1, 70.4, 70.2, 70.0, 70.6]
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
  assert.equal(round(sum(a)), 494.2)
  assert.equal(round(sum(b)), 492.1)
  assert.equal(round(sum(b) / 7 - sum(a) / 7), -0.3)
  assert.equal(round(b[6] - a[6]), 0.3)
  assert.match(examples[1].answer, /giảm 0,3 kg.*điểm cuối tăng 0,3 kg.*cân tổng/)
  assert.deepEqual([2100 - 2100, 2500 - 1900], [0, 600])
  assert.match(answer(13, '2.100–2.500'), /0–600.*không là khoảng tin cậy/)
  assert.equal(round((59.7 + 59.9 + 59.8) / 3), 59.8)
  assert.match(answer(13, 'Hai mẫu cân'), /60,0 xuống 59,8.*0,2 kg cân tổng.*chưa đo mỡ/)
})

test('chapter 14 protein, density and performance percentages keep units and inference boundaries', () => {
  const examples = unit(14).workedExamples
  assert.equal(70 * 1.4, 98)
  assert.equal(70 * 2, 140)
  assert.match(examples[0].answer, /98–140 g protein\/ngày.*chưa phải mục tiêu/)
  assert.match(examples[0].steps.join(' '), /không phải gram thịt, bột/)
  assert.equal(90 * 300 / 100, 270)
  assert.equal(270 / 180 * 100, 150)
  assert.match(examples[1].answer, /300 g A và 150 g B.*270 kcal.*chỉ khớp năng lượng/)
  assert.equal((24 - 20) / 20 * 100, 20)
  assert.equal(round((60.6 - 60) / 60 * 100), 1)
  assert.match(examples[2].answer, /20%.*1%.*chưa xác định phần cơ/)
  assert.match(answer(14, '60 kg'), /84–120 g protein\/ngày.*chưa chọn mục tiêu/)
  assert.equal(100 * 250 / 100 / 200 * 100, 125)
  assert.match(answer(14, 'A giả định'), /125 g.*chưa khớp/)
  assert.equal((25 - 20) / 20 * 100, 25)
  assert.equal(round((80.8 - 80) / 80 * 100), 1)
  assert.match(answer(14, '20→25 kg'), /25%.*1%.*chưa xác định lượng cơ/)
})

test('research is scoped to population, duration, method and outcome rather than universal prescriptions', () => {
  const protein = getAcademyLearningDraft(14)!
  assert.match(protein.unit.sections[0].paragraphs.join(' '), /Helms.*2023.*17 người.*tám tuần.*không xác định lượng dư tối ưu/)
  assert.match(protein.unit.sections[1].paragraphs.join(' '), /1,4–2,0 g\/kg\/ngày.*khỏe mạnh.*không tự áp/)
  assert.match(protein.unit.sections[1].paragraphs.join(' '), /Điểm gãy hồi quy.*không là trần sinh học/)
  const surplusSource = protein.sources.find((item) => item.id === 'helms-surplus-2023')!
  assert.match(surplusSource.limitations, /21 người.*17 hoàn thành.*ngắn hạn/)
  const fatLoss = getAcademyLearningDraft(13)!
  assert.match(fatLoss.unit.sections[2].paragraphs.join(' '), /24 vận động viên.*không phải.*mọi người.*khối nạc.*không đồng nghĩa riêng cơ/)
  assert.match(fatLoss.sources.find((item) => item.id === 'garthe-loss-2011')!.limitations, /bản tóm tắt/)
  assert.match(fatLoss.unit.sections[3].paragraphs.join(' '), /không là thủ thuật bảo đảm đặt lại chuyển hóa/)
  assert.match(unit(12).sections[3].paragraphs.join(' '), /không phải thang phân loại y khoa hay công cụ IOC CAT2/)
})

test('safety gates cover overdrinking, delayed care, coercion and applying healthy-adult targets to disease', () => {
  const expectedGates: Record<number, number> = { 11: 2, 12: 2, 13: 3, 14: 2 }
  for (const [chapter, count] of Object.entries(expectedGates)) {
    const bank = getAcademyPerformanceCheckpoint(Number(chapter))!
    assert.equal(bank.filter((item) => item.mustPass).length, count)
    for (const item of bank) assert.equal(item.difficulty, item.mustPass ? 3 : 2)
    assert.equal(bank.length, 8)
    assert.equal(new Set(bank.map((item) => item.id)).size, 8)
  }
  assert.match(answer(11, 'lú lẫn'), /trợ giúp khẩn cấp.*không tự chẩn đoán/)
  assert.match(answer(11, 'hạn chế dịch'), /Giữ hướng dẫn riêng.*người phụ trách/)
  assert.match(answer(12, 'chưa thấy nước tiểu sẫm'), /tìm chăm sóc ngay.*không tự gọi DOMS/)
  assert.match(unit(12).cases[1].safeNextStep, /ngay; không chờ coach hoặc tự điều trị bằng dịch/)
  assert.match(answer(13, 'không chọn giảm cân thật'), /ca giả định/)
  assert.match(answer(13, 'sụt cân không chủ ý'), /đánh giá phù hợp trước/)
  assert.match(answer(14, 'bệnh thận'), /Không; giữ hướng dẫn chăm sóc/)
  assert.match(unit(14).cases[2].safeNextStep, /đánh giá y tế.*sớm/)
  for (const chapter of [0, 3, 10, 15, 16, 20, 11.1, NaN, Infinity, '11'] as number[]) assert.equal(getAcademyPerformanceCheckpoint(chapter), null)
})
