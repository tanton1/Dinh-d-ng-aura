const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
})
const RELEASE = 'aura-women-30-v2'
const CONFIRMATION = 'REPLACE_INVALID_120_WITH_AURA_WOMEN_30_V2'
const SOURCE_REPO = 'https://github.com/yuhonas/free-exercise-db'
const SOURCE_MEDIA_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/'
const REPORT = path.resolve('.migration-private', 'replace-invalid-exercise-catalog-report.json')

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex') }
function media(sourceId) {
  const base = `${SOURCE_MEDIA_BASE}${encodeURIComponent(sourceId)}`
  return { startImageUrl: `${base}/0.jpg`, endImageUrl: `${base}/1.jpg`, posterUrl: `${base}/0.jpg`, animationUrl: '', mimeType: 'image/jpeg', checksum: '' }
}
function exercise(id, sourceExerciseId, fields) {
  return {
    id, schemaVersion: 1, revision: 1, status: 'published', catalogRelease: RELEASE,
    environment: ['gym'], aliasesVi: [], goals: ['Săn chắc vóc dáng', 'Tăng sức mạnh', 'Cải thiện kỹ thuật'],
    media: media(sourceExerciseId),
    source: { provider: 'free-exercise-db', sourceExerciseId, sourceVersion: 'main-2026-08-22', license: 'Unlicense' },
    sourceAttribution: `Free Exercise DB · Unlicense · ${SOURCE_REPO}`,
    ...fields,
  }
}

const ITEMS = [
  exercise('aura_women_barbell_glute_bridge', 'Barbell_Glute_Bridge', {
    nameVi: 'Cầu mông với đòn tạ', nameEn: 'Barbell Glute Bridge', bodyParts: ['Mông', 'Thân dưới'], targetMuscles: ['Mông lớn'], secondaryMuscles: ['Đùi sau', 'Cơ khép đùi', 'Core'], equipment: ['Đòn tạ', 'Đệm đòn', 'Thảm'], difficulty: 'beginner',
    instructionsVi: ['Nằm ngửa, co gối và đặt đòn tạ ngang nếp gấp hông.', 'Đặt chân rộng bằng hông để cẳng chân gần thẳng đứng ở đỉnh.', 'Siết bụng rồi đẩy hông lên bằng lực gót chân.', 'Siết mông một nhịp ở đỉnh và hạ chậm về sàn.'], cuesVi: ['Xương sườn khép', 'Đẩy qua gót chân', 'Hông lên nhờ cơ mông'], commonMistakesVi: ['Ưỡn lưng ở đỉnh', 'Đặt chân quá xa', 'Bật nảy khỏi sàn'], breathingVi: 'Hít khi hạ hông, thở ra khi đẩy và siết mông.', defaultPrescription: { sets: 4, reps: '10–15', restSeconds: 75, rpe: 8 },
  }),
  exercise('aura_women_cable_hip_adduction', 'Cable_Hip_Adduction', {
    nameVi: 'Khép đùi với cáp', nameEn: 'Cable Hip Adduction', bodyParts: ['Đùi trong', 'Thân dưới'], targetMuscles: ['Cơ khép đùi'], secondaryMuscles: ['Mông nhỡ', 'Core', 'Chân trụ'], equipment: ['Máy cáp', 'Dây cổ chân'], difficulty: 'beginner',
    instructionsVi: ['Gắn cáp thấp vào cổ chân phía gần máy và đứng nghiêng.', 'Vịn khung máy, giữ chân trụ hơi chùng và thân thẳng.', 'Kéo chân làm việc đi qua trước chân trụ bằng cơ đùi trong.', 'Dừng ngắn rồi đưa chân về chậm, không để tạ va.'], cuesVi: ['Hông luôn hướng trước', 'Thân người không nghiêng', 'Chiều về có kiểm soát'], commonMistakesVi: ['Vung chân lấy đà', 'Xoay hông theo cáp', 'Chọn tạ quá nặng'], breathingVi: 'Thở ra khi khép chân, hít vào khi mở về.', defaultPrescription: { sets: 3, reps: '12–15 mỗi bên', restSeconds: 45, rpe: 7 },
  }),
  exercise('aura_women_dumbbell_step_ups', 'Dumbbell_Step_Ups', {
    nameVi: 'Bước bục với tạ đơn', nameEn: 'Dumbbell Step Ups', bodyParts: ['Mông', 'Đùi'], targetMuscles: ['Mông lớn', 'Đùi trước'], secondaryMuscles: ['Đùi sau', 'Bắp chân', 'Core'], equipment: ['Tạ đơn', 'Bục tập'], difficulty: 'intermediate',
    instructionsVi: ['Cầm tạ hai bên và đặt toàn bộ một bàn chân lên bục.', 'Nghiêng thân nhẹ về trước nhưng giữ lưng trung lập.', 'Đẩy qua gót chân trên bục để bước lên đứng thẳng.', 'Hạ xuống chậm bằng chân làm việc rồi lặp lại.'], cuesVi: ['Không bật bằng chân dưới', 'Gối theo mũi chân', 'Hông giữ cân bằng'], commonMistakesVi: ['Bục quá cao', 'Chỉ đặt nửa bàn chân', 'Rơi nhanh khi bước xuống'], breathingVi: 'Thở ra khi bước lên, hít vào khi hạ xuống.', defaultPrescription: { sets: 3, reps: '8–12 mỗi bên', restSeconds: 60, rpe: 8 },
  }),
  exercise('aura_women_dumbbell_reverse_lunge', 'Dumbbell_Rear_Lunge', {
    nameVi: 'Chùng chân lùi với tạ đơn', nameEn: 'Dumbbell Rear Lunge', bodyParts: ['Mông', 'Đùi'], targetMuscles: ['Mông lớn', 'Đùi trước'], secondaryMuscles: ['Đùi sau', 'Mông nhỡ', 'Bắp chân'], equipment: ['Tạ đơn'], difficulty: 'beginner',
    instructionsVi: ['Đứng thẳng, cầm tạ hai bên và siết bụng.', 'Bước một chân ra sau đủ xa rồi hạ gối hướng xuống.', 'Giữ phần lớn lực trên bàn chân trước và thân ổn định.', 'Đẩy qua chân trước để trở lại đứng thẳng.'], cuesVi: ['Hai chân trên hai đường ray', 'Gối trước theo mũi chân', 'Đẩy bằng chân trước'], commonMistakesVi: ['Bước lùi quá ngắn', 'Gối trước đổ vào trong', 'Dồn lực vào chân sau'], breathingVi: 'Hít khi lùi và hạ, thở khi đứng lên.', defaultPrescription: { sets: 3, reps: '10–12 mỗi bên', restSeconds: 60, rpe: 7 },
  }),
  exercise('aura_women_smith_machine_squat', 'Smith_Machine_Squat', {
    nameVi: 'Squat máy Smith', nameEn: 'Smith Machine Squat', bodyParts: ['Đùi', 'Mông'], targetMuscles: ['Đùi trước', 'Mông lớn'], secondaryMuscles: ['Đùi sau', 'Cơ khép đùi', 'Core'], equipment: ['Máy Smith'], difficulty: 'beginner',
    instructionsVi: ['Đặt thanh trên cơ cầu vai, chân hơi bước trước thanh.', 'Mở khóa máy, siết bụng và ngồi hông xuống có kiểm soát.', 'Hạ đến độ sâu vẫn giữ lưng trung lập và gót chân bám sàn.', 'Đẩy đều cả bàn chân để đứng lên rồi khóa an toàn.'], cuesVi: ['Gối theo mũi chân', 'Ba điểm bàn chân bám sàn', 'Ngực và hông lên cùng nhau'], commonMistakesVi: ['Chân đặt quá gần thanh', 'Gối đổ vào trong', 'Khóa cứng gối'], breathingVi: 'Hít và tạo áp lực bụng khi hạ, thở khi đứng lên.', defaultPrescription: { sets: 4, reps: '8–12', restSeconds: 90, rpe: 8 },
  }),
  exercise('aura_women_hack_squat', 'Hack_Squat', {
    nameVi: 'Hack Squat máy', nameEn: 'Hack Squat', bodyParts: ['Đùi', 'Mông'], targetMuscles: ['Đùi trước'], secondaryMuscles: ['Mông lớn', 'Đùi sau', 'Bắp chân'], equipment: ['Máy Hack Squat'], difficulty: 'intermediate',
    instructionsVi: ['Áp lưng và vai vào đệm, đặt chân rộng bằng hông trên bàn đạp.', 'Mở khóa an toàn và hạ xe trượt bằng cách gập gối.', 'Dừng ở độ sâu không làm xương chậu cuộn khỏi đệm.', 'Đẩy qua toàn bàn chân để trở lên, không khóa cứng gối.'], cuesVi: ['Lưng áp đệm', 'Gối theo mũi chân', 'Hạ chậm hơn đẩy'], commonMistakesVi: ['Đặt chân quá thấp làm nhấc gót', 'Gối đổ vào trong', 'Hạ quá sâu mất trung lập'], breathingVi: 'Hít khi hạ, thở ra khi đẩy xe trượt lên.', defaultPrescription: { sets: 4, reps: '10–12', restSeconds: 90, rpe: 8 },
  }),
  exercise('aura_women_standing_calf_raise', 'Standing_Calf_Raises', {
    nameVi: 'Nhón bắp chân đứng máy', nameEn: 'Standing Calf Raise', bodyParts: ['Bắp chân'], targetMuscles: ['Cơ bụng chân'], secondaryMuscles: ['Cơ dép', 'Cổ chân'], equipment: ['Máy nhón bắp chân'], difficulty: 'beginner',
    instructionsVi: ['Đặt nửa trước bàn chân lên bục và vai dưới đệm máy.', 'Giữ gối gần thẳng, hạ gót xuống đến khi bắp chân căng.', 'Đẩy qua ngón cái và ngón trỏ để nhón người lên cao.', 'Dừng ở đỉnh rồi hạ gót chậm hết biên độ.'], cuesVi: ['Cổ chân đi thẳng', 'Giữ một nhịp ở đỉnh', 'Biên độ đầy đủ'], commonMistakesVi: ['Nảy nhanh ở đáy', 'Lăn cổ chân ra ngoài', 'Co gối quá nhiều'], breathingVi: 'Hít khi hạ gót, thở khi nhón lên.', defaultPrescription: { sets: 4, reps: '12–20', restSeconds: 45, rpe: 8 },
  }),
  exercise('aura_women_seated_calf_raise', 'Seated_Calf_Raise', {
    nameVi: 'Nhón bắp chân ngồi máy', nameEn: 'Seated Calf Raise', bodyParts: ['Bắp chân'], targetMuscles: ['Cơ dép'], secondaryMuscles: ['Cơ bụng chân', 'Cổ chân'], equipment: ['Máy nhón bắp chân ngồi'], difficulty: 'beginner',
    instructionsVi: ['Ngồi chắc, đặt nửa trước bàn chân lên bục và đệm trên đùi.', 'Mở khóa máy rồi hạ gót xuống chậm.', 'Nhón gót cao bằng cách ép mũi chân xuống bục.', 'Dừng ở đỉnh rồi trở về hết biên độ.'], cuesVi: ['Gối giữ cố định', 'Đẩy đều qua bàn chân', 'Không bật nảy'], commonMistakesVi: ['Biên độ quá ngắn', 'Thả tạ rơi nhanh', 'Xoay cổ chân'], breathingVi: 'Hít khi hạ, thở khi nhón gót.', defaultPrescription: { sets: 4, reps: '15–20', restSeconds: 45, rpe: 8 },
  }),
  exercise('aura_women_front_squat', 'Front_Barbell_Squat', {
    nameVi: 'Front Squat đòn tạ', nameEn: 'Front Barbell Squat', bodyParts: ['Đùi', 'Core'], targetMuscles: ['Đùi trước'], secondaryMuscles: ['Mông lớn', 'Cơ khép đùi', 'Core', 'Lưng trên'], equipment: ['Đòn tạ', 'Giá Squat'], difficulty: 'advanced',
    instructionsVi: ['Đặt thanh trên vai trước, nâng khuỷu để tạo giá đỡ chắc.', 'Đứng rộng bằng vai, hít sâu và siết toàn bộ thân giữa.', 'Ngồi xuống giữa hai chân trong khi khuỷu luôn hướng trước.', 'Đẩy sàn để đứng lên, giữ ngực và hông lên cùng nhau.'], cuesVi: ['Khuỷu luôn cao', 'Thân người thẳng', 'Gối theo mũi chân'], commonMistakesVi: ['Để khuỷu rơi', 'Thanh đè lên cổ', 'Gót chân nhấc'], breathingVi: 'Hít sâu và giữ áp lực trước khi hạ, thở sau điểm khó.', defaultPrescription: { sets: 4, reps: '6–10', restSeconds: 120, rpe: 8 },
  }),
  exercise('aura_women_back_extension', 'Hyperextensions_Back_Extensions', {
    nameVi: 'Gập duỗi hông trên ghế 45 độ', nameEn: '45-Degree Back Extension', bodyParts: ['Mông', 'Đùi sau'], targetMuscles: ['Mông lớn', 'Đùi sau'], secondaryMuscles: ['Lưng dưới', 'Core'], equipment: ['Ghế Hyperextension'], difficulty: 'beginner',
    instructionsVi: ['Chỉnh đệm dưới nếp gấp hông và cố định bàn chân.', 'Hơi cong lưng trên, gập người xuống bằng chuyển động ở hông.', 'Đẩy hông vào đệm và siết mông để nâng thân.', 'Dừng khi thân thẳng với chân, không ngửa quá cao.'], cuesVi: ['Gập tại hông', 'Cằm thu nhẹ', 'Siết mông ở đỉnh'], commonMistakesVi: ['Ưỡn lưng quá mức', 'Đệm đặt quá cao', 'Dùng quán tính'], breathingVi: 'Hít khi hạ thân, thở khi nâng lên.', defaultPrescription: { sets: 3, reps: '12–15', restSeconds: 60, rpe: 7 },
  }),
  exercise('aura_women_band_good_morning', 'Band_Good_Morning', {
    nameVi: 'Good Morning với dây kháng lực', nameEn: 'Band Good Morning', bodyParts: ['Đùi sau', 'Mông'], targetMuscles: ['Đùi sau'], secondaryMuscles: ['Mông lớn', 'Lưng dưới', 'Core'], equipment: ['Dây kháng lực dài'], difficulty: 'beginner', environment: ['home', 'gym'],
    instructionsVi: ['Đứng lên giữa dây và vòng dây qua sau vai.', 'Hơi chùng gối, siết bụng và giữ cột sống trung lập.', 'Đẩy hông ra sau đến khi đùi sau căng rõ.', 'Đẩy hông về trước để đứng lên và siết mông.'], cuesVi: ['Hông đi ra sau', 'Ống chân gần thẳng đứng', 'Lưng giữ trung lập'], commonMistakesVi: ['Ngồi xuống như squat', 'Cong lưng', 'Ngửa người ở đỉnh'], breathingVi: 'Hít khi gập hông, thở khi đứng lên.', defaultPrescription: { sets: 3, reps: '12–15', restSeconds: 45, rpe: 7 },
  }),
  exercise('aura_women_kettlebell_single_leg_deadlift', 'Kettlebell_One-Legged_Deadlift', {
    nameVi: 'Romanian Deadlift một chân với tạ chuông', nameEn: 'Kettlebell One-Legged Deadlift', bodyParts: ['Mông', 'Đùi sau'], targetMuscles: ['Mông lớn', 'Đùi sau'], secondaryMuscles: ['Mông nhỡ', 'Core', 'Cổ chân'], equipment: ['Tạ chuông'], difficulty: 'intermediate',
    instructionsVi: ['Đứng trên một chân, cầm tạ ở tay đối diện hoặc hai tay.', 'Hơi chùng gối trụ rồi đẩy hông ra sau.', 'Duỗi chân còn lại ra sau, giữ hông cân bằng và lưng trung lập.', 'Đẩy qua bàn chân trụ để đứng lên và siết mông.'], cuesVi: ['Hai điểm hông hướng xuống sàn', 'Tạ đi sát chân trụ', 'Chân sau dài ra'], commonMistakesVi: ['Mở xoay hông', 'Khóa cứng gối trụ', 'Vươn tạ bằng cách cong lưng'], breathingVi: 'Hít khi gập hông, thở khi trở lại đứng.', defaultPrescription: { sets: 3, reps: '8–12 mỗi bên', restSeconds: 60, rpe: 7 },
  }),
  exercise('aura_women_dumbbell_bench_press', 'Dumbbell_Bench_Press', {
    nameVi: 'Đẩy ngực ghế phẳng với tạ đơn', nameEn: 'Dumbbell Bench Press', bodyParts: ['Ngực', 'Thân trên'], targetMuscles: ['Ngực lớn'], secondaryMuscles: ['Vai trước', 'Tay sau', 'Core'], equipment: ['Tạ đơn', 'Ghế phẳng'], difficulty: 'beginner',
    instructionsVi: ['Nằm trên ghế, chân bám sàn và tạ ở hai bên ngực.', 'Kéo bả vai về sau, giữ cổ tay trên khuỷu.', 'Đẩy hai tạ lên trên ngực đến gần thẳng tay.', 'Hạ tạ chậm với khuỷu mở khoảng 30–45 độ.'], cuesVi: ['Bả vai giữ trên ghế', 'Cổ tay thẳng', 'Chân bám sàn'], commonMistakesVi: ['Khuỷu mở ngang vai', 'Đập tạ vào nhau', 'Nhấc mông khỏi ghế'], breathingVi: 'Hít khi hạ tạ, thở khi đẩy lên.', defaultPrescription: { sets: 3, reps: '8–12', restSeconds: 75, rpe: 8 },
  }),
  exercise('aura_women_dumbbell_fly', 'Dumbbell_Flyes', {
    nameVi: 'Ép ngực tạ đơn trên ghế phẳng', nameEn: 'Dumbbell Fly', bodyParts: ['Ngực', 'Thân trên'], targetMuscles: ['Ngực lớn'], secondaryMuscles: ['Vai trước', 'Cơ răng trước'], equipment: ['Tạ đơn', 'Ghế phẳng'], difficulty: 'intermediate',
    instructionsVi: ['Nằm chắc trên ghế, giữ tạ phía trên ngực với khuỷu hơi cong.', 'Kéo bả vai về sau và mở hai tay theo hình vòng cung.', 'Hạ đến khi ngực căng nhưng vai vẫn ổn định.', 'Siết ngực để đưa tạ về trên ngực theo đường cũ.'], cuesVi: ['Khuỷu cong cố định', 'Ôm một thân cây lớn', 'Vai tránh nhô ra trước'], commonMistakesVi: ['Dùng tạ quá nặng', 'Hạ tay quá sâu', 'Biến thành động tác đẩy ngực'], breathingVi: 'Hít khi mở tay, thở khi ép tạ về giữa.', defaultPrescription: { sets: 3, reps: '10–15', restSeconds: 60, rpe: 7 },
  }),
  exercise('aura_women_one_arm_dumbbell_row', 'One-Arm_Dumbbell_Row', {
    nameVi: 'Kéo lưng một tay với tạ đơn', nameEn: 'One-Arm Dumbbell Row', bodyParts: ['Lưng', 'Thân trên'], targetMuscles: ['Cơ xô', 'Lưng giữa'], secondaryMuscles: ['Vai sau', 'Tay trước', 'Core'], equipment: ['Tạ đơn', 'Ghế tập'], difficulty: 'beginner',
    instructionsVi: ['Chống một tay và gối cùng bên lên ghế, lưng trung lập.', 'Tay còn lại cầm tạ thẳng dưới vai, giữ vai xa tai.', 'Kéo khuỷu tay về phía hông cho tạ sát thân.', 'Siết lưng rồi hạ tạ chậm đến khi tay duỗi.'], cuesVi: ['Khuỷu hướng về hông', 'Hông và vai không xoay', 'Cổ dài'], commonMistakesVi: ['Xoay thân để lấy đà', 'Nhún vai', 'Kéo tạ lên ngực'], breathingVi: 'Thở khi kéo tạ, hít khi hạ.', defaultPrescription: { sets: 3, reps: '10–12 mỗi bên', restSeconds: 60, rpe: 8 },
  }),
  exercise('aura_women_band_assisted_pull_up', 'Band_Assisted_Pull-Up', {
    nameVi: 'Hít xà có dây hỗ trợ', nameEn: 'Band Assisted Pull-Up', bodyParts: ['Lưng', 'Thân trên'], targetMuscles: ['Cơ xô'], secondaryMuscles: ['Lưng giữa', 'Tay trước', 'Cẳng tay', 'Core'], equipment: ['Xà đơn', 'Dây kháng lực'], difficulty: 'intermediate',
    instructionsVi: ['Móc dây chắc vào xà và đặt chân hoặc gối vào dây.', 'Nắm xà rộng hơn vai nhẹ, siết bụng và hạ vai khỏi tai.', 'Kéo khuỷu xuống để đưa ngực về phía xà.', 'Hạ người chậm đến khi tay duỗi mà vai vẫn kiểm soát.'], cuesVi: ['Kéo khuỷu xuống', 'Thân người chắc', 'Không đạp dây lấy đà'], commonMistakesVi: ['Rung lắc cơ thể', 'Rướn cằm', 'Thả rơi ở chiều xuống'], breathingVi: 'Thở khi kéo lên, hít khi hạ xuống.', defaultPrescription: { sets: 3, reps: '6–10', restSeconds: 90, rpe: 8 },
  }),
  exercise('aura_women_straight_arm_pulldown', 'Straight-Arm_Pulldown', {
    nameVi: 'Kéo cáp tay thẳng', nameEn: 'Straight-Arm Pulldown', bodyParts: ['Lưng', 'Thân trên'], targetMuscles: ['Cơ xô'], secondaryMuscles: ['Cơ tròn lớn', 'Tay sau', 'Core'], equipment: ['Máy cáp', 'Thanh thẳng'], difficulty: 'beginner',
    instructionsVi: ['Đặt cáp cao, cầm thanh và lùi lại một bước.', 'Hơi gập hông, giữ khuỷu cong rất nhẹ và vai hạ.', 'Kéo thanh theo vòng cung xuống sát đùi bằng cơ xô.', 'Dừng ngắn rồi đưa tay lên chậm đến khi cơ xô kéo dài.'], cuesVi: ['Cánh tay gần thẳng', 'Xương sườn khép', 'Kéo từ nách xuống'], commonMistakesVi: ['Gập duỗi khuỷu nhiều', 'Dùng thân người lấy đà', 'Nhún vai'], breathingVi: 'Thở khi kéo xuống, hít khi đưa tay lên.', defaultPrescription: { sets: 3, reps: '12–15', restSeconds: 45, rpe: 7 },
  }),
  exercise('aura_women_band_lateral_raise', 'Lateral_Raise_-_With_Bands', {
    nameVi: 'Nâng vai ngang với dây kháng lực', nameEn: 'Band Lateral Raise', bodyParts: ['Vai', 'Thân trên'], targetMuscles: ['Vai giữa'], secondaryMuscles: ['Vai trước', 'Cơ trên gai', 'Core'], equipment: ['Dây kháng lực'], difficulty: 'beginner', environment: ['home', 'gym'],
    instructionsVi: ['Đứng lên giữa dây, cầm hai đầu và giữ khuỷu hơi cong.', 'Siết bụng, hạ vai và giữ cổ tay trung lập.', 'Nâng hai tay sang bên đến gần ngang vai.', 'Dừng ngắn rồi hạ tay chậm chống lại lực dây.'], cuesVi: ['Dẫn động bằng khuỷu', 'Vai xa tai', 'Tay hơi chếch trước thân'], commonMistakesVi: ['Nhún vai', 'Vung người', 'Nâng tay quá cao'], breathingVi: 'Thở khi nâng tay, hít khi hạ.', defaultPrescription: { sets: 3, reps: '12–20', restSeconds: 45, rpe: 7 },
  }),
  exercise('aura_women_front_dumbbell_raise', 'Front_Dumbbell_Raise', {
    nameVi: 'Nâng vai trước với tạ đơn', nameEn: 'Front Dumbbell Raise', bodyParts: ['Vai', 'Thân trên'], targetMuscles: ['Vai trước'], secondaryMuscles: ['Vai giữa', 'Ngực trên', 'Core'], equipment: ['Tạ đơn'], difficulty: 'beginner',
    instructionsVi: ['Đứng vững, cầm tạ trước đùi và hơi chùng gối.', 'Siết bụng, giữ xương sườn khép và vai hạ.', 'Nâng một hoặc hai tạ ra trước đến ngang vai.', 'Hạ tạ chậm về đùi mà không đung đưa.'], cuesVi: ['Cánh tay nâng từ vai', 'Thân người đứng yên', 'Cổ tay trung lập'], commonMistakesVi: ['Ngả lưng lấy đà', 'Nâng cao quá vai', 'Nhún vai'], breathingVi: 'Thở khi nâng tạ, hít khi hạ.', defaultPrescription: { sets: 3, reps: '10–15', restSeconds: 45, rpe: 7 },
  }),
  exercise('aura_women_rope_triceps_pushdown', 'Triceps_Pushdown_-_Rope_Attachment', {
    nameVi: 'Duỗi tay sau với dây thừng', nameEn: 'Rope Triceps Pushdown', bodyParts: ['Tay sau', 'Thân trên'], targetMuscles: ['Cơ tam đầu cánh tay'], secondaryMuscles: ['Cẳng tay', 'Core'], equipment: ['Máy cáp', 'Dây thừng'], difficulty: 'beginner',
    instructionsVi: ['Đặt cáp cao, cầm dây và giữ khuỷu sát hai bên thân.', 'Hơi nghiêng người, siết bụng và cố định vai.', 'Duỗi khuỷu kéo dây xuống, tách hai đầu dây ở cuối.', 'Siết tay sau rồi đưa dây lên chậm đến khoảng 90 độ khuỷu.'], cuesVi: ['Khuỷu đứng yên', 'Vai xa tai', 'Tách dây ở đáy'], commonMistakesVi: ['Đẩy khuỷu ra trước sau', 'Dùng thân người ép cáp', 'Thả tạ va nhau'], breathingVi: 'Thở khi duỗi tay, hít khi gập khuỷu.', defaultPrescription: { sets: 3, reps: '10–15', restSeconds: 45, rpe: 8 },
  }),
  exercise('aura_women_dumbbell_biceps_curl', 'Dumbbell_Bicep_Curl', {
    nameVi: 'Cuốn tay trước với tạ đơn', nameEn: 'Dumbbell Biceps Curl', bodyParts: ['Tay trước', 'Thân trên'], targetMuscles: ['Cơ nhị đầu cánh tay'], secondaryMuscles: ['Cơ cánh tay', 'Cẳng tay'], equipment: ['Tạ đơn'], difficulty: 'beginner',
    instructionsVi: ['Đứng thẳng, cầm tạ hai bên với lòng bàn tay hướng trước.', 'Giữ khuỷu sát thân, vai hạ và bụng chắc.', 'Gập khuỷu đưa tạ lên mà cánh tay trên không di chuyển.', 'Siết tay trước rồi hạ tạ chậm đến gần thẳng tay.'], cuesVi: ['Khuỷu ở cạnh sườn', 'Cổ tay thẳng', 'Chiều hạ có kiểm soát'], commonMistakesVi: ['Vung hông', 'Đưa khuỷu ra trước', 'Gập cổ tay'], breathingVi: 'Thở khi cuốn tạ, hít khi hạ.', defaultPrescription: { sets: 3, reps: '10–15', restSeconds: 45, rpe: 8 },
  }),
  exercise('aura_women_reverse_fly', 'Reverse_Flyes', {
    nameVi: 'Dang vai sau với tạ đơn', nameEn: 'Dumbbell Reverse Fly', bodyParts: ['Vai sau', 'Lưng trên'], targetMuscles: ['Vai sau'], secondaryMuscles: ['Cơ trám', 'Cơ thang giữa', 'Cơ xoay vai'], equipment: ['Tạ đơn'], difficulty: 'beginner',
    instructionsVi: ['Cầm tạ, gập hông và giữ lưng trung lập gần song song sàn.', 'Giữ khuỷu hơi cong, vai hạ và tạ dưới ngực.', 'Dang hai tay sang bên bằng vai sau và lưng trên.', 'Dừng ngắn rồi hạ tạ chậm về giữa.'], cuesVi: ['Dẫn động bằng khuỷu', 'Bả vai trượt về nhau', 'Cổ giữ trung lập'], commonMistakesVi: ['Nhún vai', 'Dùng tạ quá nặng', 'Vung thân'], breathingVi: 'Thở khi dang tay, hít khi hạ.', defaultPrescription: { sets: 3, reps: '12–15', restSeconds: 45, rpe: 7 },
  }),
  exercise('aura_women_rope_overhead_triceps_extension', 'Triceps_Overhead_Extension_with_Rope', {
    nameVi: 'Duỗi tay sau qua đầu với dây thừng', nameEn: 'Rope Overhead Triceps Extension', bodyParts: ['Tay sau', 'Thân trên'], targetMuscles: ['Đầu dài cơ tam đầu'], secondaryMuscles: ['Vai', 'Core'], equipment: ['Máy cáp', 'Dây thừng'], difficulty: 'intermediate',
    instructionsVi: ['Quay lưng về máy cáp thấp, đưa dây qua đầu.', 'Đứng chân trước sau, siết bụng và giữ khuỷu hướng trước.', 'Duỗi khuỷu đưa hai đầu dây ra trước và lên trên.', 'Siết tay sau rồi gập khuỷu chậm để dây trở về sau đầu.'], cuesVi: ['Khuỷu hướng trước', 'Xương sườn khép', 'Chỉ cẳng tay di chuyển'], commonMistakesVi: ['Ưỡn lưng', 'Khuỷu mở quá rộng', 'Dùng thân người lấy đà'], breathingVi: 'Thở khi duỗi tay, hít khi gập khuỷu.', defaultPrescription: { sets: 3, reps: '10–15', restSeconds: 45, rpe: 8 },
  }),
  exercise('aura_women_hammer_curl', 'Hammer_Curls', {
    nameVi: 'Hammer Curl với tạ đơn', nameEn: 'Dumbbell Hammer Curl', bodyParts: ['Tay trước', 'Cẳng tay'], targetMuscles: ['Cơ cánh tay', 'Cơ cánh tay quay'], secondaryMuscles: ['Cơ nhị đầu', 'Cẳng tay'], equipment: ['Tạ đơn'], difficulty: 'beginner',
    instructionsVi: ['Đứng thẳng, cầm tạ với hai lòng bàn tay hướng vào nhau.', 'Giữ khuỷu cạnh sườn, vai hạ và bụng chắc.', 'Gập khuỷu đưa tạ lên trong khi cổ tay giữ trung tính.', 'Dừng ngắn rồi hạ tạ chậm đến gần thẳng tay.'], cuesVi: ['Ngón cái hướng lên', 'Khuỷu đứng yên', 'Không vung hông'], commonMistakesVi: ['Ngả người lấy đà', 'Đưa khuỷu ra trước', 'Hạ tạ quá nhanh'], breathingVi: 'Thở khi cuốn tạ, hít khi hạ.', defaultPrescription: { sets: 3, reps: '10–12', restSeconds: 45, rpe: 8 },
  }),
  exercise('aura_women_cable_crunch', 'Cable_Crunch', {
    nameVi: 'Gập bụng quỳ với cáp', nameEn: 'Kneeling Cable Crunch', bodyParts: ['Core', 'Bụng'], targetMuscles: ['Cơ thẳng bụng'], secondaryMuscles: ['Cơ bụng sâu', 'Cơ xiên'], equipment: ['Máy cáp', 'Dây thừng'], difficulty: 'intermediate',
    instructionsVi: ['Quỳ trước cáp cao, giữ hai đầu dây cạnh thái dương.', 'Cố định hông, siết bụng và giữ cằm thu nhẹ.', 'Cuộn xương sườn về phía xương chậu để gập thân.', 'Siết bụng ở đáy rồi mở thân chậm mà không kéo bằng tay.'], cuesVi: ['Xương sườn về xương chậu', 'Hông gần cố định', 'Tay chỉ giữ dây'], commonMistakesVi: ['Gập tại hông', 'Kéo dây bằng tay', 'Ưỡn lưng ở đỉnh'], breathingVi: 'Thở hết khi gập bụng, hít khi mở thân.', defaultPrescription: { sets: 3, reps: '12–15', restSeconds: 45, rpe: 8 },
  }),
  exercise('aura_women_russian_twist', 'Russian_Twist', {
    nameVi: 'Russian Twist', nameEn: 'Russian Twist', bodyParts: ['Core', 'Bụng'], targetMuscles: ['Cơ xiên bụng'], secondaryMuscles: ['Cơ thẳng bụng', 'Cơ bụng sâu', 'Gập hông'], equipment: ['Thảm', 'Tạ tùy chọn'], difficulty: 'beginner', environment: ['home', 'gym'],
    instructionsVi: ['Ngồi co gối, ngả thân nhẹ và giữ lưng dài.', 'Siết bụng, chắp tay trước ngực hoặc cầm tạ nhẹ.', 'Xoay lồng ngực sang một bên mà hông vẫn ổn định.', 'Quay qua giữa rồi đổi bên với nhịp chậm.'], cuesVi: ['Xoay từ lồng ngực', 'Xương sống giữ dài', 'Bụng luôn căng'], commonMistakesVi: ['Chỉ đưa tay qua lại', 'Cong lưng', 'Xoay quá nhanh'], breathingVi: 'Thở ra khi xoay sang mỗi bên, hít khi qua giữa.', defaultPrescription: { sets: 3, reps: '10–15 mỗi bên', restSeconds: 45, rpe: 7 },
  }),
  exercise('aura_women_mountain_climber', 'Mountain_Climbers', {
    nameVi: 'Mountain Climber', nameEn: 'Mountain Climber', bodyParts: ['Core', 'Toàn thân'], targetMuscles: ['Cơ bụng sâu', 'Gập hông'], secondaryMuscles: ['Vai', 'Đùi trước', 'Ngực', 'Mông'], equipment: ['Thảm'], difficulty: 'beginner', environment: ['home', 'gym'],
    instructionsVi: ['Vào tư thế plank cao, bàn tay dưới vai và thân thành đường thẳng.', 'Siết bụng, đẩy sàn và đưa một gối về phía ngực.', 'Đổi chân liên tục trong khi hông giữ thấp và ổn định.', 'Duy trì nhịp phù hợp mà kỹ thuật không bị phá vỡ.'], cuesVi: ['Vai ở trên cổ tay', 'Hông ít dao động', 'Chân đổi dưới thân'], commonMistakesVi: ['Nâng hông quá cao', 'Dậm chân mất kiểm soát', 'Võng lưng'], breathingVi: 'Thở đều theo nhịp chân, không nín thở.', defaultPrescription: { sets: 3, reps: '30–45 giây', restSeconds: 45, rpe: 8 },
  }),
  exercise('aura_women_superman', 'Superman', {
    nameVi: 'Superman trên thảm', nameEn: 'Superman', bodyParts: ['Lưng dưới', 'Core'], targetMuscles: ['Cơ dựng sống'], secondaryMuscles: ['Mông lớn', 'Đùi sau', 'Vai sau'], equipment: ['Thảm'], difficulty: 'beginner', environment: ['home', 'gym'],
    instructionsVi: ['Nằm sấp, duỗi tay trước và chân thẳng phía sau.', 'Thu nhẹ cằm, siết bụng và mông trước khi nâng.', 'Nâng tay cùng chân khỏi sàn trong biên độ thoải mái.', 'Giữ ngắn rồi hạ chậm mà không thả rơi.'], cuesVi: ['Kéo dài người thay vì nâng quá cao', 'Mắt nhìn xuống', 'Siết mông'], commonMistakesVi: ['Ngửa cổ', 'Ưỡn lưng quá mức', 'Nâng giật nhanh'], breathingVi: 'Thở khi nâng, hít khi hạ xuống.', defaultPrescription: { sets: 3, reps: '10–15', restSeconds: 45, rpe: 6 },
  }),
  exercise('aura_women_hanging_leg_raise', 'Hanging_Leg_Raise', {
    nameVi: 'Nâng chân treo xà', nameEn: 'Hanging Leg Raise', bodyParts: ['Core', 'Bụng'], targetMuscles: ['Cơ thẳng bụng', 'Cơ bụng dưới'], secondaryMuscles: ['Gập hông', 'Cẳng tay', 'Cơ xô'], equipment: ['Xà đơn'], difficulty: 'advanced',
    instructionsVi: ['Treo người chắc trên xà, hạ vai và giữ chân khép.', 'Siết bụng để hạn chế cơ thể đung đưa.', 'Cuộn xương chậu rồi nâng gối hoặc chân về phía ngực.', 'Hạ chân chậm đến vị trí đầu mà không mất kiểm soát.'], cuesVi: ['Cuộn xương chậu trước', 'Không đung đưa', 'Vai tránh sát tai'], commonMistakesVi: ['Đá chân lấy đà', 'Chỉ gập hông', 'Thả chân rơi nhanh'], breathingVi: 'Thở mạnh khi nâng chân, hít khi hạ.', defaultPrescription: { sets: 3, reps: '8–12', restSeconds: 75, rpe: 8 },
  }),
  exercise('aura_women_overhead_crunch', 'Crunch_-_Hands_Overhead', {
    nameVi: 'Gập bụng tay qua đầu', nameEn: 'Crunch with Hands Overhead', bodyParts: ['Core', 'Bụng'], targetMuscles: ['Cơ thẳng bụng'], secondaryMuscles: ['Cơ bụng sâu', 'Cơ xiên'], equipment: ['Thảm'], difficulty: 'beginner', environment: ['home', 'gym'],
    instructionsVi: ['Nằm ngửa, co gối, bàn chân bám sàn và tay duỗi qua đầu.', 'Thở ra, ép nhẹ lưng dưới xuống thảm và siết bụng.', 'Cuộn xương sườn lên khỏi sàn trong khi cổ thả lỏng.', 'Dừng ngắn rồi hạ từng đốt sống xuống chậm.'], cuesVi: ['Xương sườn về xương chậu', 'Cằm cách ngực một nắm tay', 'Không kéo bằng cổ'], commonMistakesVi: ['Ngồi bật cả thân', 'Nín thở', 'Ưỡn lưng khi hạ'], breathingVi: 'Thở hết khi gập lên, hít khi hạ xuống.', defaultPrescription: { sets: 3, reps: '12–20', restSeconds: 45, rpe: 7 },
  }),
]

function canonicalItems() {
  if (ITEMS.length !== 30) throw new Error(`Expected exactly 30 exercises, received ${ITEMS.length}.`)
  const ids = new Set()
  return ITEMS.map((item) => {
    if (!/^aura_women_[a-z0-9_]+$/.test(item.id) || ids.has(item.id)) throw new Error(`Invalid or duplicate id: ${item.id}`)
    ids.add(item.id)
    if (item.status !== 'published' || !item.nameVi || !item.nameEn) throw new Error(`Identity is incomplete: ${item.id}`)
    if (item.instructionsVi.length < 4 || item.cuesVi.length < 3 || item.commonMistakesVi.length < 3) throw new Error(`Coaching content is incomplete: ${item.id}`)
    if (!item.targetMuscles.length || item.secondaryMuscles.length < 2 || !item.bodyParts.length) throw new Error(`Muscle classification is incomplete: ${item.id}`)
    if (!item.media.startImageUrl || !item.media.endImageUrl || !item.breathingVi) throw new Error(`Media or breathing is incomplete: ${item.id}`)
    return { ...item, contentDigest: sha256(JSON.stringify(item)) }
  })
}

function parseArgs() {
  const result = { mode: 'dry-run' }
  process.argv.slice(2).forEach((argument) => {
    if (argument.startsWith('--mode=')) result.mode = argument.slice(7)
    else if (argument.startsWith('--project=')) result.projectId = argument.slice(10)
    else if (argument.startsWith('--database=')) result.databaseId = argument.slice(11)
    else if (argument.startsWith('--digest=')) result.digest = argument.slice(9)
    else if (argument.startsWith('--confirm=')) result.confirm = argument.slice(10)
    else throw new Error(`Unknown argument: ${argument.split('=')[0]}`)
  })
  if (!['dry-run', 'apply', 'verify'].includes(result.mode)) throw new Error('Mode must be dry-run, apply, or verify.')
  if (result.mode === 'apply') {
    if (result.projectId !== TARGET.projectId || result.databaseId !== TARGET.databaseId) throw new Error('Apply requires the exact production target.')
    if (result.confirm !== CONFIRMATION) throw new Error('Apply confirmation is missing or incorrect.')
    if (!/^[a-f0-9]{64}$/.test(result.digest || '')) throw new Error('Apply requires the dry-run digest.')
  }
  return result
}

function firebaseCliAuth() {
  const cliLib = path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'firebase-tools', 'lib')
  const auth = require(path.join(cliLib, 'auth.js'))
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI is not signed in.')
  return { auth, account }
}
async function accessToken() {
  const { auth, account } = firebaseCliAuth()
  const result = await auth.getAccessToken(account.tokens.refresh_token, [])
  if (!result?.access_token) throw new Error('Unable to obtain Firebase access token.')
  return result.access_token
}
function firestoreBase() { return `https://firestore.googleapis.com/v1/projects/${TARGET.projectId}/databases/${encodeURIComponent(TARGET.databaseId)}` }
function resourceBase() { return `projects/${TARGET.projectId}/databases/${TARGET.databaseId}` }
async function requestJson(token, endpoint, options = {}) {
  const response = await fetch(`${firestoreBase()}${endpoint}`, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) } })
  const raw = await response.text()
  if (!response.ok) throw new Error(`Firestore request failed (${response.status}) at ${endpoint.split('?')[0]}: ${raw.slice(0, 300)}`)
  return raw ? JSON.parse(raw) : null
}
function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } }
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item)])) } }
}
function encodeFields(value) { return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item)])) }
function decodeValue(value) {
  if ('stringValue' in value) return value.stringValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return value.doubleValue
  if ('booleanValue' in value) return value.booleanValue
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue)
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decodeValue(item)]))
  return null
}
async function loadCatalog(token) {
  const rows = await requestJson(token, '/documents:runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'exercises' }], limit: 500 } }) })
  return (rows || []).flatMap((row) => row.document ? [{
    id: row.document.name.split('/').pop(), updateTime: row.document.updateTime,
    data: Object.fromEntries(Object.entries(row.document.fields || {}).map(([key, value]) => [key, decodeValue(value)])),
  }] : [])
}
function invalidLegacyDocuments(documents) {
  return documents.filter((document) => document.id.startsWith('fedb_') && document.data.status === 'review')
    .sort((a, b) => a.id.localeCompare(b.id))
}
function replacementPlan(documents, items) {
  const legacy = invalidLegacyDocuments(documents)
  if (legacy.length !== 120) throw new Error(`Safety stop: expected exactly 120 legacy review documents, found ${legacy.length}.`)
  const existing = new Map(documents.map((document) => [document.id, document]))
  const conflicts = items.filter((item) => existing.has(item.id) && existing.get(item.id).data.contentDigest !== item.contentDigest)
  if (conflicts.length) throw new Error(`Safety stop: ${conflicts.length} new exercise IDs already contain different data.`)
  const create = items.filter((item) => !existing.has(item.id))
  const digestInput = { remove: legacy.map(({ id, updateTime }) => ({ id, updateTime })), create: create.map(({ id, contentDigest }) => ({ id, contentDigest })) }
  return { legacy, create, exactExisting: items.length - create.length, digest: sha256(JSON.stringify(digestInput)) }
}
async function applyPlan(token, plan) {
  const writes = plan.legacy.map((document) => ({
    delete: `${resourceBase()}/documents/exercises/${document.id}`,
    currentDocument: { updateTime: document.updateTime },
  }))
  plan.create.forEach((item) => {
    const { id, ...fields } = item
    const root = `${resourceBase()}/documents/exercises/${id}`
    writes.push({ update: { name: root, fields: encodeFields(fields) }, currentDocument: { exists: false } })
    writes.push({ update: { name: `${root}/revisions/1`, fields: encodeFields({ ...fields, exerciseId: id, revisionType: 'catalog_import', createdBy: RELEASE }) }, currentDocument: { exists: false } })
  })
  if (writes.length > 500) throw new Error(`Safety stop: Firestore commit contains ${writes.length} writes.`)
  await requestJson(token, '/documents:commit', { method: 'POST', body: JSON.stringify({ writes }) })
  return writes.length
}
async function loadRevision(token, id) {
  const response = await fetch(`${firestoreBase()}/documents/exercises/${id}/revisions/1`, { headers: { Authorization: `Bearer ${token}` } })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Unable to verify revision for ${id} (${response.status}).`)
  const document = await response.json()
  return Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, decodeValue(value)]))
}

async function main() {
  const args = parseArgs()
  const items = canonicalItems()
  const report = { schemaVersion: 1, release: RELEASE, mode: args.mode, selectedCount: items.length, writesPerformed: false }
  const token = await accessToken()
  const metadata = await requestJson(token, '')
  if (metadata?.name !== `projects/${TARGET.projectId}/databases/${TARGET.databaseId}`) throw new Error('Connected database is not the approved target.')
  let documents = await loadCatalog(token)
  if (args.mode === 'verify') {
    const legacy = invalidLegacyDocuments(documents)
    const byId = new Map(documents.map((document) => [document.id, document.data]))
    const revisions = await Promise.all(items.map((item) => loadRevision(token, item.id)))
    report.legacyRemaining = legacy.length
    report.present = items.filter((item) => byId.get(item.id)?.contentDigest === item.contentDigest && byId.get(item.id)?.status === 'published').length
    report.presentRevisions = items.filter((item, index) => revisions[index]?.contentDigest === item.contentDigest && revisions[index]?.exerciseId === item.id).length
    report.totalPublished = documents.filter((document) => document.data.status === 'published').length
    if (report.legacyRemaining || report.present !== items.length || report.presentRevisions !== items.length) process.exitCode = 2
  } else {
    const plan = replacementPlan(documents, items)
    report.planDigest = plan.digest
    report.removeCount = plan.legacy.length
    report.createCount = plan.create.length
    report.exactExisting = plan.exactExisting
    if (args.mode === 'apply') {
      if (args.digest !== plan.digest) throw new Error('Live plan digest no longer matches the approved dry run.')
      report.writeCount = await applyPlan(token, plan)
      report.writesPerformed = true
    }
  }
  fs.mkdirSync(path.dirname(REPORT), { recursive: true })
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
module.exports = { ITEMS, RELEASE, canonicalItems, invalidLegacyDocuments, replacementPlan }
