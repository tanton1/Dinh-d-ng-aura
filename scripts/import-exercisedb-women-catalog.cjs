const fs = require('node:fs')
const path = require('node:path')
const { runCatalogImport } = require('./import-aura-women-exercise-catalog.cjs')

const RELEASE = 'exercisedb-women-120-v3'
const CONFIRMATION = 'IMPORT_EXERCISEDB_WOMEN_120_V3'
const SOURCE_API = 'https://oss.exercisedb.dev/api/v1/exercises'
const SOURCE_PAGE_SIZE = 25
const SOURCE_LIMIT = 1_500
const SOURCE_CACHE = path.resolve('.migration-private', 'exercisedb-women-source-v1.json')
const REPORT = path.resolve('.migration-private', 'exercisedb-women-150-report.json')
const SOURCE_ATTRIBUTION = 'ExerciseDB Free · https://exercisedb.dev'

const quotas = Object.freeze({
  glutes: 25,
  quadriceps: 14,
  hamstrings: 7,
  innerOuterThigh: 0,
  core: 25,
  back: 15,
  shoulders: 10,
  chestArms: 14,
  calves: 5,
  mobility: 5,
})

const muscleVi = Object.freeze({
  abs: 'Cơ bụng', abductors: 'Đùi ngoài', adductors: 'Đùi trong', biceps: 'Tay trước', calves: 'Bắp chân',
  cardiovascular_system: 'Tim mạch', delts: 'Vai', forearms: 'Cẳng tay', glutes: 'Mông', hamstrings: 'Đùi sau',
  lats: 'Cơ xô', levator_scapulae: 'Cơ nâng vai', pectorals: 'Ngực', quads: 'Đùi trước', quadriceps: 'Đùi trước',
  serratus_anterior: 'Cơ răng trước', spine: 'Lưng dưới', traps: 'Cơ thang', triceps: 'Tay sau',
  upper_back: 'Lưng trên', hip_flexors: 'Cơ gập hông', obliques: 'Cơ liên sườn',
})

const equipmentVi = Object.freeze({
  assisted: 'Máy hỗ trợ', band: 'Dây kháng lực', barbell: 'Tạ đòn', body_weight: 'Trọng lượng cơ thể',
  bosu_ball: 'Bóng Bosu', cable: 'Máy cáp', dumbbell: 'Tạ đơn', ez_barbell: 'Thanh EZ',
  hammer: 'Búa tập', kettlebell: 'Tạ ấm', 'leverage machine': 'Máy tập', medicine_ball: 'Bóng tạ',
  olympic_barbell: 'Tạ đòn Olympic', resistance_band: 'Dây kháng lực', roller: 'Con lăn',
  rope: 'Dây thừng', skiers_erg: 'Máy SkiErg', sled_machine: 'Xe trượt tạ', smith_machine: 'Máy Smith',
  stability_ball: 'Bóng thăng bằng', stationary_bike: 'Xe đạp tại chỗ', stepmill_machine: 'Máy leo cầu thang',
  tire: 'Lốp tập', trap_bar: 'Trap Bar', upper_body_ergometer: 'Máy quay tay', weighted: 'Tạ bổ sung',
  wheel_roller: 'Con lăn bụng', machine: 'Máy tập',
})

const bodyPartVi = Object.freeze({
  back: 'Lưng', cardio: 'Tim mạch', chest: 'Ngực', lower_arms: 'Cẳng tay', lower_legs: 'Cẳng chân',
  neck: 'Cổ', shoulders: 'Vai', upper_arms: 'Cánh tay', upper_legs: 'Thân dưới', waist: 'Core',
})

const replacementTerms = [
  ['romanian deadlift', 'Romanian Deadlift'], ['stiff leg deadlift', 'Deadlift chân thẳng'], ['single leg deadlift', 'Deadlift một chân'],
  ['hip thrust', 'Đẩy hông'], ['glute bridge', 'Cầu mông'], ['reverse hyperextension', 'Duỗi hông ngược'],
  ['bulgarian split squat', 'Squat Bulgaria'], ['split squat', 'Split Squat'], ['goblet squat', 'Goblet Squat'],
  ['hack squat', 'Hack Squat'], ['sumo squat', 'Sumo Squat'], ['front squat', 'Front Squat'], ['back squat', 'Back Squat'],
  ['leg press', 'Đạp đùi'], ['leg extension', 'Duỗi đùi trước'], ['leg curl', 'Cuốn đùi sau'],
  ['walking lunge', 'Chùng chân bước đi'], ['reverse lunge', 'Chùng chân lùi'], ['lateral lunge', 'Chùng chân ngang'],
  ['rear lunge', 'Chùng chân lùi'], ['forward lunge', 'Chùng chân tới'], ['step up', 'Bước bục'], ['step-up', 'Bước bục'],
  ['glute kickback', 'Đá mông'], ['hip extension', 'Duỗi hông'], ['hip abduction', 'Dạng hông'], ['hip adduction', 'Khép hông'],
  ['thigh abductor', 'Dạng đùi'], ['thigh adductor', 'Khép đùi'], ['calf raise', 'Nhón bắp chân'],
  ['lat pulldown', 'Kéo xô'], ['pulldown', 'Kéo xô'], ['pull-up', 'Hít xà'], ['pull up', 'Hít xà'],
  ['seated row', 'Kéo lưng ngồi'], ['bent over row', 'Kéo lưng cúi người'], ['inverted row', 'Kéo người ngược'],
  ['one arm row', 'Kéo lưng một tay'], ['face pull', 'Kéo cáp về mặt'], ['reverse fly', 'Mở vai sau'],
  ['shoulder press', 'Đẩy vai'], ['overhead press', 'Đẩy tạ qua đầu'], ['lateral raise', 'Nâng vai ngang'],
  ['front raise', 'Nâng vai trước'], ['rear delt', 'Vai sau'], ['chest press', 'Đẩy ngực'], ['bench press', 'Đẩy ngực ghế'],
  ['push-up', 'Chống đẩy'], ['push up', 'Chống đẩy'], ['chest fly', 'Ép ngực'], ['pec deck', 'Ép ngực máy'],
  ['hammer curl', 'Cuốn tạ búa'], ['biceps curl', 'Cuốn tay trước'], ['bicep curl', 'Cuốn tay trước'],
  ['triceps pushdown', 'Đẩy cáp tay sau'], ['tricep pushdown', 'Đẩy cáp tay sau'], ['triceps extension', 'Duỗi tay sau'],
  ['tricep extension', 'Duỗi tay sau'], ['bench dip', 'Dip ghế'], ['assisted dip', 'Dip có hỗ trợ'],
  ['hanging knee raise', 'Nâng gối treo người'], ['hanging leg raise', 'Nâng chân treo người'], ['leg raise', 'Nâng chân'],
  ['reverse crunch', 'Gập bụng ngược'], ['bicycle crunch', 'Gập bụng đạp xe'], ['cable crunch', 'Gập bụng với cáp'],
  ['crunch', 'Gập bụng'], ['sit-up', 'Ngồi dậy'], ['sit up', 'Ngồi dậy'], ['dead bug', 'Dead Bug'],
  ['mountain climber', 'Leo núi tại chỗ'], ['russian twist', 'Xoay bụng kiểu Nga'], ['wood chop', 'Bổ củi'],
  ['pallof press', 'Pallof Press'], ['bird dog', 'Bird Dog'], ['side plank', 'Plank nghiêng'], ['plank', 'Plank'],
  ['back extension', 'Duỗi lưng'], ['hyperextension', 'Duỗi lưng'], ['good morning', 'Good Morning'],
  ['upward facing dog', 'Chó ngửa mặt'], ['downward facing dog', 'Chó úp mặt'], ['cat cow', 'Mèo bò'],
  ['hamstring stretch', 'Giãn đùi sau'], ['quadriceps stretch', 'Giãn đùi trước'], ['hip flexor stretch', 'Giãn cơ gập hông'],
  ['glute stretch', 'Giãn cơ mông'], ['child pose', 'Tư thế em bé'],
  ['squat', 'Squat'], ['deadlift', 'Deadlift'], ['lunge', 'Chùng chân'], ['row', 'Kéo lưng'], ['fly', 'Mở tay'],
  ['curl', 'Cuốn'], ['extension', 'Duỗi'], ['raise', 'Nâng'], ['press', 'Đẩy'], ['stretch', 'Giãn cơ'],
  ['single arm', 'một tay'], ['one arm', 'một tay'], ['single leg', 'một chân'], ['one leg', 'một chân'],
  ['alternate', 'luân phiên'], ['alternating', 'luân phiên'], ['standing', 'đứng'], ['seated', 'ngồi'], ['lying', 'nằm'],
  ['incline', 'ghế dốc'], ['decline', 'ghế dốc xuống'], ['assisted', 'có hỗ trợ'], ['weighted', 'có tạ'],
  ['cable', 'với cáp'], ['dumbbell', 'với tạ đơn'], ['barbell', 'với tạ đòn'], ['kettlebell', 'với tạ ấm'],
  ['band', 'với dây kháng lực'], ['machine', 'với máy'], ['bodyweight', 'trọng lượng cơ thể'],
]

const supportedMovement = /(squat|deadlift|lunge|step.?up|hip thrust|glute bridge|kickback|hip (abduction|adduction|extension)|thigh (abductor|adductor)|leg (press|curl|extension|raise)|calf raise|good morning|hyperextension|back extension|row|pulldown|pull.?up|face pull|reverse fly|rear delt|shoulder press|overhead press|lateral raise|front raise|chest press|bench press|push.?up|chest fly|pec deck|biceps? curl|hammer curl|triceps? (pushdown|extension)|bench dip|assisted dip|crunch|sit.?up|dead bug|mountain climber|russian twist|wood chop|pallof press|bird dog|plank|upward facing dog|downward facing dog|cat cow|stretch|child pose)/i
const excludedMovement = /(neck|wrist|finger|olympic|snatch|clean and jerk|muscle.?up|impossible|pistol squat|handstand|backflip|front lever|planche|behind the neck|jump|burpee|plyo|clap push|one arm push)/i

function normalizedKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[()]/g, ' ').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function unique(values) { return [...new Set(values.filter(Boolean))] }

function translateList(values, dictionary) {
  return unique((Array.isArray(values) ? values : []).map((value) => dictionary[normalizedKey(value)] || String(value || '').trim()).filter(Boolean))
}

function translateName(value) {
  const source = String(value || '').trim().toLowerCase().replace(/\s*\((female|male)\)\s*/gi, ' ').replace(/\bv\.?\s*\d+\b/g, '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
  if (!source) return 'Bài tập toàn thân'
  const modifiers = []
  if (/single leg|one leg/.test(source)) modifiers.push('Một chân')
  else if (/single arm|one arm/.test(source)) modifiers.push('Một tay')
  else if (/alternate|alternating/.test(source)) modifiers.push('Luân phiên')
  if (/standing/.test(source)) modifiers.push('Đứng')
  else if (/seated/.test(source)) modifiers.push('Ngồi')
  else if (/lying/.test(source)) modifiers.push('Nằm')
  if (/incline/.test(source)) modifiers.push('ghế dốc')
  else if (/decline/.test(source)) modifiers.push('ghế dốc xuống')
  if (/assisted/.test(source)) modifiers.push('có hỗ trợ')
  const basePatterns = [
    [/hip thrust/, 'Đẩy hông'], [/glute bridge|hip raise/, 'Cầu mông'], [/deadlift|good morning/, 'Deadlift'],
    [/bulgarian split squat|split squat/, 'Split Squat'], [/squat/, 'Squat'], [/lunge/, 'Chùng chân'],
    [/step.?up/, 'Bước bục'], [/kickback|hip extension/, 'Đá mông'], [/hip abduction|thigh abductor|abductor/, 'Dạng hông'],
    [/hip adduction|thigh adductor|adductor/, 'Khép hông'], [/leg press/, 'Đạp đùi'], [/leg curl/, 'Cuốn đùi sau'],
    [/leg extension/, 'Duỗi đùi trước'], [/calf raise/, 'Nhón bắp chân'], [/pulldown|pull.?up/, 'Kéo xô'],
    [/row|face pull|reverse fly|rear delt/, 'Kéo lưng'], [/shoulder press|overhead press|bradford press/, 'Đẩy vai'],
    [/lateral raise/, 'Nâng vai ngang'], [/front raise/, 'Nâng vai trước'], [/chest press|bench press|push.?up|dip/, 'Đẩy ngực'],
    [/chest fly|pec deck|fly/, 'Ép ngực'], [/hammer curl/, 'Cuốn tạ búa'], [/biceps? curl|curl/, 'Cuốn tay trước'],
    [/triceps? pushdown/, 'Đẩy cáp tay sau'], [/triceps? extension|french press/, 'Duỗi tay sau'],
    [/hanging knee raise|knee raise/, 'Nâng gối'], [/hanging leg raise|leg raise/, 'Nâng chân'],
    [/reverse crunch/, 'Gập bụng ngược'], [/bicycle crunch/, 'Gập bụng đạp xe'], [/cable crunch|crunch/, 'Gập bụng'],
    [/sit.?up/, 'Ngồi dậy'], [/dead bug/, 'Dead Bug'], [/mountain climber/, 'Leo núi tại chỗ'],
    [/russian twist/, 'Xoay bụng kiểu Nga'], [/wood chop/, 'Bổ củi'], [/pallof press/, 'Pallof Press'],
    [/bird dog/, 'Bird Dog'], [/side plank/, 'Plank nghiêng'], [/plank/, 'Plank'],
    [/back extension|hyperextension/, 'Duỗi lưng'], [/upward facing dog/, 'Chó ngửa mặt'], [/downward facing dog/, 'Chó úp mặt'],
    [/cat cow/, 'Mèo bò'], [/child pose/, 'Tư thế em bé'], [/stretch/, 'Giãn cơ'],
  ]
  const base = basePatterns.find(([pattern]) => pattern.test(source))?.[1] || 'Bài tập toàn thân'
  const equipment = Object.entries(equipmentVi).find(([key]) => source.includes(key.replace(/_/g, ' ')))?.[1]
  const equipmentSuffix = equipment && !['Trọng lượng cơ thể', 'Máy hỗ trợ'].includes(equipment) && !base.includes(equipment) ? ` với ${equipment.toLocaleLowerCase('vi')}` : ''
  const result = [...modifiers, base].join(' ').replace(/\s+ghế/g, ' ghế') + equipmentSuffix
  return result.charAt(0).toLocaleUpperCase('vi') + result.slice(1)
}

function targetGroup(exercise) {
  const muscles = [...(exercise.targetMuscles || []), ...(exercise.secondaryMuscles || [])].map(normalizedKey)
  const name = String(exercise.name || '').toLowerCase()
  if (/stretch|facing dog|cat cow|child pose/.test(name)) return 'mobility'
  if (muscles.includes('glutes')) return 'glutes'
  if (muscles.some((value) => ['abductors', 'adductors'].includes(value))) return 'innerOuterThigh'
  if (muscles.includes('quadriceps') || muscles.includes('quads')) return 'quadriceps'
  if (muscles.includes('hamstrings')) return 'hamstrings'
  if (muscles.includes('calves')) return 'calves'
  if (muscles.some((value) => ['abs', 'obliques', 'spine'].includes(value)) || (exercise.bodyParts || []).some((value) => normalizedKey(value) === 'waist')) return 'core'
  if (muscles.some((value) => ['lats', 'traps', 'upper_back', 'levator_scapulae'].includes(value)) || /row|pulldown|pull.?up|face pull/.test(name)) return 'back'
  if (muscles.includes('delts') || (exercise.bodyParts || []).some((value) => normalizedKey(value) === 'shoulders')) return 'shoulders'
  if (muscles.some((value) => ['pectorals', 'biceps', 'triceps'].includes(value))) return 'chestArms'
  return ''
}

function popularityScore(exercise) {
  const name = String(exercise.name || '').toLowerCase()
  const equipment = (exercise.equipments || []).map(normalizedKey)
  let score = 0
  if (/(hip thrust|glute bridge|squat|romanian deadlift|lunge|step.?up|kickback|leg press|leg curl|leg extension|row|pulldown|shoulder press|lateral raise|plank|dead bug|crunch)/.test(name)) score += 80
  if (/(single|one arm|one leg|alternate|assisted)/.test(name)) score += 12
  if (equipment.some((value) => ['body_weight', 'dumbbell', 'cable', 'band', 'resistance_band', 'leverage_machine', 'smith_machine', 'kettlebell', 'barbell'].includes(value))) score += 25
  if ((exercise.instructions || []).length >= 4) score += 15
  if ((exercise.secondaryMuscles || []).length) score += 5
  if (/(female)/i.test(exercise.name || '')) score += 8
  if (/(bosu|roller|sled|tire|ergometer)/.test(equipment.join(' '))) score -= 20
  return score
}

function movementFamily(name) {
  const value = String(name || '').toLowerCase()
  if (/hip thrust|glute bridge/.test(value)) return 'bridge'
  if (/deadlift|good morning/.test(value)) return 'hinge'
  if (/squat|leg press/.test(value)) return 'squat'
  if (/lunge|split squat|step.?up/.test(value)) return 'lunge'
  if (/kickback|hip extension/.test(value)) return 'kickback'
  if (/abduction|abductor/.test(value)) return 'abduction'
  if (/adduction|adductor/.test(value)) return 'adduction'
  if (/leg curl/.test(value)) return 'legCurl'
  if (/leg extension/.test(value)) return 'legExtension'
  if (/calf raise/.test(value)) return 'calf'
  if (/row|face pull|reverse fly|rear delt/.test(value)) return 'row'
  if (/pulldown|pull.?up/.test(value)) return 'pulldown'
  if (/press|push.?up|dip/.test(value)) return 'press'
  if (/raise|fly/.test(value)) return 'raise'
  if (/curl|triceps|extension/.test(value)) return 'arms'
  if (/plank|dead bug|bird dog|pallof/.test(value)) return 'stability'
  if (/crunch|sit.?up|leg raise|knee raise/.test(value)) return 'coreFlexion'
  if (/twist|wood chop|mountain climber/.test(value)) return 'rotation'
  if (/stretch|facing dog|cat cow|child pose/.test(value)) return 'mobility'
  if (/back extension|hyperextension/.test(value)) return 'backExtension'
  return 'general'
}

function coachingContent(exercise, targetMusclesVi, equipment) {
  const family = movementFamily(exercise.name)
  const target = targetMusclesVi.join(' và ') || 'nhóm cơ mục tiêu'
  const tool = equipment.join(', ') || 'dụng cụ phù hợp'
  const profiles = {
    bridge: [['Chuẩn bị ghế hoặc thảm và đặt tải chắc chắn ngang hông nếu bài có dùng tạ.', 'Đặt bàn chân vững, siết bụng và giữ xương sườn không bật lên.', 'Đẩy qua gót chân, nâng hông bằng lực mông đến khi thân người ổn định.', 'Siết mông một nhịp rồi hạ xuống chậm, không thả rơi tải.'], ['Cằm thu nhẹ', 'Đẩy bằng gót chân', 'Kết thúc bằng siết mông'], ['Ưỡn lưng ở điểm cao nhất', 'Đặt chân quá xa hoặc quá gần', 'Hạ người quá nhanh']],
    hinge: [['Đứng vững, giữ tải sát thân và chùng gối nhẹ.', 'Đẩy hông ra sau trong khi giữ cột sống trung lập và vai hạ.', `Hạ đến khi cảm nhận rõ ${target}, không cố lấy thêm biên độ bằng lưng.`, 'Đẩy sàn và đưa hông về trước để đứng lên, giữ tải sát chân.'], ['Hông đi ra sau', 'Lưng giữ trung lập', 'Tải luôn sát cơ thể'], ['Biến động tác thành squat', 'Cong lưng khi hạ', 'Ngửa người quá mức khi đứng lên']],
    squat: [['Đặt chân vững, chỉnh máy hoặc giữ tải cân bằng trước khi bắt đầu.', 'Siết bụng, mở gối cùng hướng mũi chân và giữ trọng tâm giữa bàn chân.', 'Hạ hông trong biên độ kiểm soát, giữ gót chân tiếp xúc chắc.', 'Đạp sàn đứng lên và siết mông, không khóa gối đột ngột.'], ['Gối theo mũi chân', 'Cả bàn chân bám sàn', 'Thân người luôn có kiểm soát'], ['Gối đổ vào trong', 'Nhấc gót chân', 'Rơi nhanh ở chiều xuống']],
    lunge: [['Chọn khoảng bước đủ rộng và giữ hai chân trên hai đường ray song song.', 'Siết bụng, giữ hông hướng trước và dồn lực chủ yếu vào chân làm việc.', 'Hạ gối sau theo hướng xuống sàn trong khi gối trước đi theo mũi chân.', 'Đẩy qua cả bàn chân trước để trở về, giữ thăng bằng trước lần tiếp theo.'], ['Hai hông hướng thẳng', 'Lực ở chân trước', 'Bước chắc, không quá hẹp'], ['Gối trước đổ vào trong', 'Dùng chân sau đẩy quá nhiều', 'Mất thăng bằng vì bước trên một đường thẳng']],
    kickback: [['Cố định dây hoặc máy, chọn tải cho phép giữ hông cân bằng.', 'Giữ thân ổn định, chân trụ hơi chùng và bụng được siết.', 'Đưa chân ra sau từ khớp hông bằng lực mông, không vung người.', 'Dừng ngắn rồi đưa chân về chậm, vẫn duy trì lực căng.'], ['Hông hướng thẳng trước', 'Biên độ đến từ khớp hông', 'Chiều về chậm'], ['Ưỡn lưng để đá cao', 'Xoay mở hông', 'Dùng quán tính']],
    abduction: [['Chỉnh dây hoặc máy vừa tầm và chọn biên độ bắt đầu thoải mái.', 'Giữ xương chậu cân bằng, bụng siết và chân trụ ổn định.', 'Mở chân hoặc hai gối bằng lực mông ngoài, không nghiêng người lấy đà.', 'Trở về chậm đến khi vẫn còn lực căng trước lần lặp tiếp theo.'], ['Mở bằng mông ngoài', 'Hông giữ ngang', 'Biên độ có kiểm soát'], ['Nghiêng thân để lấy đà', 'Xoay mũi chân quá nhiều', 'Thả tải va mạnh']],
    adduction: [['Chỉnh dây hoặc máy để hông không bị kéo quá căng ở vị trí mở.', 'Giữ thân ổn định và đặt chân đúng điểm tựa.', 'Khép chân bằng lực đùi trong, giữ xương chậu không xoay.', 'Dừng ngắn rồi mở về chậm trong biên độ thoải mái.'], ['Khép bằng đùi trong', 'Hông giữ cố định', 'Chiều mở chậm'], ['Mở biên độ quá rộng', 'Dùng quán tính', 'Xoay hông theo tải']],
    legCurl: [['Chỉnh trục máy thẳng với khớp gối và cố định phần đệm chắc chắn.', 'Giữ hông sát ghế hoặc băng tập, bàn chân ở tư thế tự nhiên.', 'Cuốn gót bằng lực đùi sau đến biên độ chủ động.', 'Siết ngắn rồi duỗi gối về chậm, không để chồng tạ va.'], ['Gối đúng trục máy', 'Hông luôn cố định', 'Kiểm soát chiều duỗi'], ['Nhấc hông để lấy lực', 'Co bàn chân quá mức', 'Thả tạ nhanh']],
    legExtension: [['Chỉnh trục máy ngang khớp gối và đệm dưới nằm trên cổ chân.', 'Ngồi sát ghế, giữ tay cầm và hướng mũi chân tự nhiên.', 'Duỗi gối bằng lực đùi trước nhưng không khóa khớp đột ngột.', 'Dừng ngắn ở trên rồi hạ tải chậm về vị trí đầu.'], ['Lưng sát ghế', 'Duỗi bằng đùi trước', 'Hạ tải chậm'], ['Đá tạ bằng quán tính', 'Nhấc hông khỏi ghế', 'Khóa gối quá mạnh']],
    calf: [['Đặt nửa trước bàn chân chắc trên bệ và giữ cổ chân thẳng.', 'Hạ gót chậm để bắp chân được kéo dài trong biên độ thoải mái.', 'Đẩy qua ngón cái và nhón gót lên cao bằng lực bắp chân.', 'Giữ một nhịp ở đỉnh rồi hạ xuống có kiểm soát.'], ['Đẩy qua ngón cái', 'Cổ chân đi thẳng', 'Dừng rõ ở đỉnh'], ['Bật nảy ở đáy', 'Lật cổ chân ra ngoài', 'Biên độ quá ngắn']],
    row: [['Ổn định thân người, hạ vai và giữ tay nắm chắc nhưng không gồng cổ.', 'Bắt đầu bằng cách kéo bả vai về sau, sau đó dẫn khuỷu theo hướng thân người.', `Kéo đến khi cảm nhận ${target}, không ngửa lưng để lấy thêm biên độ.`, 'Duỗi tay về chậm để bả vai mở tự nhiên mà vai không nhún.'], ['Dẫn chuyển động bằng khuỷu', 'Vai luôn xa tai', 'Thân người ổn định'], ['Kéo chủ yếu bằng tay trước', 'Nhún vai', 'Giật người ra sau']],
    pulldown: [['Chỉnh ghế hoặc điểm hỗ trợ chắc chắn và nắm tay cầm phù hợp.', 'Nâng ngực nhẹ, siết bụng và hạ vai trước khi kéo.', `Kéo khuỷu xuống bằng lực ${target}, giữ cổ và cổ tay trung lập.`, 'Duỗi tay lên chậm để cơ lưng được kéo dài mà vai không nhún.'], ['Khuỷu kéo xuống', 'Vai xa tai', 'Không đung đưa thân'], ['Kéo sau gáy', 'Giật người lấy đà', 'Chỉ dùng tay trước']],
    press: [['Chỉnh ghế hoặc tư thế chống đỡ để vai và bàn chân được ổn định.', `Giữ ${tool} chắc chắn, siết bụng và đặt khuỷu ở góc thoải mái.`, 'Đẩy bằng lực ngực, vai hoặc tay sau theo đúng đường chuyển động.', 'Dừng trước khi khóa khớp rồi hạ về chậm, giữ vai không trôi ra trước.'], ['Xương sườn giữ ổn định', 'Vai hạ xa tai', 'Cổ tay thẳng'], ['Ưỡn lưng quá mức', 'Mở khuỷu ngang vai', 'Thả tải quá nhanh']],
    raise: [['Đứng hoặc ngồi vững, giữ tải nhẹ và khuỷu hơi mềm.', 'Hạ vai, siết bụng và giữ cổ tay trung lập.', 'Nâng tay bằng nhóm cơ mục tiêu đến biên độ không làm vai nhún.', 'Dừng ngắn rồi hạ chậm, không để tải kéo rơi cánh tay.'], ['Dẫn bằng khuỷu tay', 'Vai luôn xa tai', 'Tải vừa đủ kiểm soát'], ['Vung người', 'Nâng quá cao', 'Chọn tạ quá nặng']],
    arms: [['Ổn định thân người và giữ vai hạ, khuỷu ở đúng vị trí.', `Cầm ${tool} với cổ tay trung lập và siết bụng.`, `Co hoặc duỗi khuỷu bằng lực ${target}, không dùng thân người lấy đà.`, 'Trở về chậm đến biên độ đầy đủ trước lần lặp tiếp theo.'], ['Khuỷu giữ ổn định', 'Cổ tay trung lập', 'Chiều về chậm'], ['Vung hông', 'Đưa khuỷu chạy theo tải', 'Gập cổ tay']],
    stability: [['Vào tư thế chắc chắn, đặt vai và hông cân bằng trước khi bắt đầu.', 'Siết bụng như chuẩn bị nhận một lực đẩy và duy trì nhịp thở đều.', 'Giữ hoặc di chuyển tay chân chậm mà cột sống và xương chậu không xoay.', 'Kết thúc hiệp khi không còn giữ được tư thế chuẩn.'], ['Thở đều', 'Xương sườn khép', 'Hông giữ cân bằng'], ['Nín thở', 'Võng lưng', 'Cố giữ quá lâu khi tư thế đã hỏng']],
    coreFlexion: [['Nằm hoặc treo người chắc chắn, đưa xương chậu về vị trí trung lập.', 'Thở ra và siết bụng trước khi bắt đầu chuyển động.', 'Cuộn thân hoặc nâng chân bằng cơ bụng, tránh giật hông lấy đà.', 'Hạ về chậm trong khi vẫn giữ lưng và xương chậu được kiểm soát.'], ['Thở ra khi cuộn bụng', 'Chuyển động chậm', 'Cổ giữ thư giãn'], ['Kéo cổ bằng tay', 'Vung chân', 'Thả người rơi nhanh']],
    rotation: [['Đặt chân và thân người ổn định, siết bụng trước khi di chuyển.', 'Giữ tay chắc và bắt đầu chuyển động từ thân giữa hoặc hông theo đúng bài.', 'Xoay có kiểm soát trong biên độ không làm lưng dưới bị kéo vặn.', 'Trở về chậm, giữ lực căng và đổi bên cân bằng.'], ['Xoay có kiểm soát', 'Hông không lệch', 'Thở ra khi dùng lực'], ['Vung tay lấy đà', 'Xoay quá sâu bằng lưng dưới', 'Mất trụ chân']],
    mobility: [['Vào tư thế từ từ trên mặt phẳng chắc chắn và không ép cơ thể vào đau.', `Điều chỉnh đến khi cảm nhận độ căng nhẹ ở ${target}.`, 'Giữ nhịp thở chậm, thả lỏng vai và hàm trong toàn bộ thời gian.', 'Thoát tư thế từ từ; giảm biên độ nếu có đau nhói hoặc tê.'], ['Căng nhẹ, không đau', 'Thở chậm', 'Không bật nảy'], ['Ép biên độ quá sâu', 'Nín thở', 'Giữ tư thế khi có đau nhói']],
    backExtension: [['Chỉnh đệm ngang hông và cố định bàn chân chắc chắn.', 'Giữ cột sống trung lập, siết bụng và khoanh tay hoặc giữ tải sát ngực.', 'Gập từ hông rồi dùng mông và lưng sau đưa thân trở lại đường thẳng.', 'Dừng ở vị trí trung lập, không ngửa lưng vượt quá thân người.'], ['Gập từ khớp hông', 'Cổ theo cột sống', 'Dừng ở đường thẳng'], ['Ưỡn lưng quá mức', 'Rơi người nhanh', 'Đặt đệm quá cao']],
    general: [[`Chuẩn bị ${tool} và kiểm tra không gian tập an toàn.`, 'Vào tư thế cân bằng, siết bụng và giữ các khớp ở vị trí tự nhiên.', `Thực hiện chuyển động chậm bằng lực ${target}, không dùng quán tính.`, 'Trở về vị trí đầu có kiểm soát và dừng nếu xuất hiện đau nhói.'], ['Giữ tư thế ổn định', 'Di chuyển có kiểm soát', 'Thở đều'], ['Chọn tải quá nặng', 'Dùng quán tính', 'Cố tập khi có đau nhói']],
  }
  const [instructionsVi, cuesVi, commonMistakesVi] = profiles[family] || profiles.general
  return {
    instructionsVi,
    cuesVi,
    commonMistakesVi,
    breathingVi: family === 'mobility' || family === 'stability'
      ? 'Hít thở chậm và đều; thở ra để siết bụng hoặc thả lỏng sâu hơn mà không nín thở.'
      : 'Hít vào ở chiều trở về hoặc hạ tải; thở ra khi thực hiện pha dùng lực chính.',
  }
}

function difficulty(exercise) {
  const name = String(exercise.name || '').toLowerCase()
  if (/(single leg|one leg|bulgarian|hanging|pistol|barbell|deadlift|renegade|decline)/.test(name)) return 'intermediate'
  if (/(assisted|machine|body weight|stretch|bridge|plank|crunch)/.test(`${name} ${(exercise.equipments || []).join(' ')}`)) return 'beginner'
  return 'intermediate'
}

function curate(source) {
  const candidates = source.filter((exercise) => exercise?.exerciseId && exercise?.name && exercise?.gifUrl
      && supportedMovement.test(exercise.name) && !excludedMovement.test(exercise.name) && targetGroup(exercise))
    .sort((left, right) => popularityScore(right) - popularityScore(left) || left.name.localeCompare(right.name))
  const selected = []
  const names = new Set()
  for (const [group, quota] of Object.entries(quotas)) {
    for (const exercise of candidates.filter((item) => targetGroup(item) === group)) {
      if (selected.filter((entry) => entry.group === group).length >= quota) break
      const nameKey = normalizedKey(exercise.name.replace(/\b(left|right|male|female)\b/gi, ''))
      if (names.has(nameKey)) continue
      names.add(nameKey)
      selected.push({ group, exercise })
    }
  }
  const missing = Object.entries(quotas).filter(([group, quota]) => selected.filter((entry) => entry.group === group).length !== quota)
  if (missing.length) throw new Error(`Không đủ bài an toàn cho nhóm: ${missing.map(([group, quota]) => `${group} ${selected.filter((entry) => entry.group === group).length}/${quota}`).join(', ')}`)
  if (selected.length !== 120) throw new Error(`Expected 120 curated exercises, received ${selected.length}.`)
  return selected.map(({ group, exercise }, index) => {
    const id = `edb_women_${normalizedKey(exercise.exerciseId)}`
    const targetMuscles = translateList(exercise.targetMuscles, muscleVi)
    const secondaryMuscles = translateList(exercise.secondaryMuscles, muscleVi)
    const equipment = translateList(exercise.equipments, equipmentVi)
    const bodyParts = translateList(exercise.bodyParts, bodyPartVi)
    const coaching = coachingContent(exercise, targetMuscles, equipment)
    return {
      id,
      schemaVersion: 1,
      revision: 1,
      status: 'published',
      catalogRelease: RELEASE,
      sortPriority: 200 + index,
      popularForWomen: true,
      nameVi: translateName(exercise.name),
      nameEn: String(exercise.name).trim().replace(/\b\w/g, (letter) => letter.toUpperCase()),
      aliasesVi: [],
      bodyParts: bodyParts.length ? bodyParts : ['Toàn thân'],
      targetMuscles: targetMuscles.length ? targetMuscles : ['Toàn thân'],
      secondaryMuscles,
      equipment: equipment.length ? equipment : ['Trọng lượng cơ thể'],
      environment: (exercise.equipments || []).some((value) => normalizedKey(value) === 'body_weight') ? ['home', 'gym'] : ['gym'],
      difficulty: difficulty(exercise),
      goals: group === 'mobility' ? ['Linh hoạt', 'Phục hồi'] : ['Săn chắc vóc dáng', 'Tăng sức mạnh', 'Kiểm soát vận động'],
      ...coaching,
      sourceInstructionsEn: (exercise.instructions || []).slice(0, 20),
      media: {
        startImageUrl: exercise.gifUrl,
        endImageUrl: '',
        posterUrl: exercise.gifUrl,
        posterImageId: '',
        images: [],
        videos: [{
          id: `exercisedb-${exercise.exerciseId}`,
          provider: 'exercisedb',
          externalId: exercise.exerciseId,
          url: exercise.gifUrl,
          posterUrl: exercise.gifUrl,
          tag: 'animation',
          presenter: /\(female\)/i.test(exercise.name) ? 'female' : 'neutral',
          format: 'gif',
          isPrimary: true,
        }],
        animationUrl: exercise.gifUrl,
        mimeType: 'image/gif',
        checksum: '',
      },
      // Keep the plan digest stable between dry-run and apply on the same source cache.
      externalMedia: { provider: 'exercisedb', exerciseId: exercise.exerciseId, syncedAt: '2026-09-01' },
      defaultPrescription: { sets: 3, reps: group === 'mobility' ? '30–45 giây' : '10–15', restSeconds: group === 'mobility' ? 30 : 60, rpe: group === 'mobility' ? 5 : 7 },
      source: { provider: 'exercisedb', sourceExerciseId: exercise.exerciseId, sourceVersion: 'api-v1-2026-09-01', license: 'External-provider' },
      sourceAttribution: SOURCE_ATTRIBUTION,
    }
  })
}

function validate(items) {
  if (items.length !== 120) throw new Error(`Expected exactly 120 exercises, received ${items.length}.`)
  const ids = new Set()
  for (const item of items) {
    if (!/^edb_women_[a-z0-9_]+$/.test(item.id) || ids.has(item.id)) throw new Error(`Invalid or duplicate id: ${item.id}`)
    ids.add(item.id)
    if (item.status !== 'published' || !item.nameVi || !item.nameEn) throw new Error(`Identity is incomplete: ${item.id}`)
    if (item.instructionsVi.length < 4 || item.cuesVi.length < 3 || item.commonMistakesVi.length < 3) throw new Error(`Coaching content is incomplete: ${item.id}`)
    if (!item.media.videos?.[0]?.url || item.media.videos[0].format !== 'gif') throw new Error(`GIF media is incomplete: ${item.id}`)
    if (item.sourceAttribution !== SOURCE_ATTRIBUTION || item.source.provider !== 'exercisedb') throw new Error(`Attribution is incomplete: ${item.id}`)
    if (!item.targetMuscles.length || !item.equipment.length) throw new Error(`Classification is incomplete: ${item.id}`)
  }
}

async function fetchAllExercises() {
  const rows = []
  const seen = new Set()
  let after = ''
  while (rows.length < SOURCE_LIMIT) {
    const url = new URL(SOURCE_API)
    url.searchParams.set('limit', String(SOURCE_PAGE_SIZE))
    if (after) url.searchParams.set('after', after)
    let response
    for (let attempt = 0; attempt < 5; attempt += 1) {
      response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'AuraFitnessExerciseCatalogMigration/1.0' } })
      if (response.status !== 429) break
      await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)))
    }
    if (!response.ok) throw new Error(`ExerciseDB source request failed (${response.status}).`)
    const payload = await response.json()
    const page = Array.isArray(payload.data) ? payload.data : []
    for (const exercise of page) {
      if (!exercise?.exerciseId || seen.has(exercise.exerciseId)) continue
      seen.add(exercise.exerciseId)
      rows.push(exercise)
    }
    if (!payload.meta?.hasNextPage || !payload.meta?.nextCursor || !page.length) break
    after = payload.meta.nextCursor
    // The free endpoint is intentionally rate-limited. A small delay keeps the
    // migration polite and makes the dry-run reproducible.
    await new Promise((resolve) => setTimeout(resolve, 750))
  }
  if (rows.length < 1_000) throw new Error(`ExerciseDB source is unexpectedly incomplete (${rows.length} rows).`)
  fs.mkdirSync(path.dirname(SOURCE_CACHE), { recursive: true })
  fs.writeFileSync(SOURCE_CACHE, `${JSON.stringify({ fetchedAt: new Date().toISOString(), rows }, null, 2)}\n`)
  return rows
}

async function loadSource(mode) {
  if (mode === 'dry-run' && fs.existsSync(SOURCE_CACHE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(SOURCE_CACHE, 'utf8'))
      if (Array.isArray(cached.rows) && cached.rows.length >= 1_000) return cached.rows
    } catch { /* refresh the cache below */ }
  }
  if (mode === 'dry-run') return fetchAllExercises()
  if (!fs.existsSync(SOURCE_CACHE)) throw new Error('Chưa có source cache từ dry-run. Chạy dry-run trước khi apply hoặc verify.')
  const payload = JSON.parse(fs.readFileSync(SOURCE_CACHE, 'utf8'))
  if (!Array.isArray(payload.rows) || payload.rows.length < 1_000) throw new Error('Source cache không hợp lệ.')
  return payload.rows
}

async function main() {
  const mode = process.argv.find((argument) => argument.startsWith('--mode='))?.slice(7) || 'dry-run'
  const source = await loadSource(mode)
  const items = curate(source)
  await runCatalogImport({
    sourceItems: items,
    release: RELEASE,
    confirmation: CONFIRMATION,
    reportPath: REPORT,
    categories: quotas,
    validate,
    allowOwnedUpdates: true,
    previousRelease: 'exercisedb-women-120-v2',
  })
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
module.exports = { RELEASE, SOURCE_ATTRIBUTION, curate, quotas, translateName, targetGroup, validate }
