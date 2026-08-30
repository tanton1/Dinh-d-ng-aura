const path = require('node:path')
const { runCatalogImport } = require('./import-aura-women-exercise-catalog.cjs')

const RELEASE = 'aura-women-specialized-20-v2'
const CONFIRMATION = 'IMPORT_AURA_WOMEN_SPECIALIZED_20_V2'
const SOURCE_REPO = 'https://github.com/yuhonas/free-exercise-db'
const SOURCE_MEDIA_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/'
const REPORT = path.resolve('.migration-private', 'aura-women-specialized-20-report.json')

function media(sourceId) {
  const base = `${SOURCE_MEDIA_BASE}${encodeURIComponent(sourceId)}`
  return { startImageUrl: `${base}/0.jpg`, endImageUrl: `${base}/1.jpg`, posterUrl: `${base}/0.jpg`, animationUrl: '', mimeType: 'image/jpeg', checksum: '' }
}

function exercise(id, sourceExerciseId, fields) {
  return {
    id,
    schemaVersion: 1,
    revision: 1,
    status: 'published',
    catalogRelease: RELEASE,
    environment: ['gym'],
    aliasesVi: [],
    goals: ['Tăng sức mạnh', 'Săn chắc vóc dáng', 'Kiểm soát vận động'],
    media: media(sourceExerciseId),
    source: { provider: 'free-exercise-db', sourceExerciseId, sourceVersion: 'main-2026-08-30', license: 'Unlicense' },
    sourceAttribution: `Free Exercise DB · Unlicense · ${SOURCE_REPO}`,
    ...fields,
  }
}

const ITEMS = [
  exercise('aura_women_monster_walk', 'Monster_Walk', {
    nameVi: 'Monster Walk với dây kháng lực', nameEn: 'Monster Walk', aliasesVi: ['Đi ngang dây kháng lực'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Mông nhỡ', 'Mông nhỏ'], secondaryMuscles: ['Đùi ngoài', 'Core'], equipment: ['Dây kháng lực'], difficulty: 'beginner', environment: ['home', 'gym'],
    instructionsVi: ['Đặt dây quanh đùi trên gối hoặc quanh cổ chân tùy trình độ.', 'Hạ hông nhẹ, giữ bàn chân song song và tạo căng dây.', 'Bước chéo ra trước từng bước ngắn, không để hai chân chạm nhau.', 'Đi đủ số bước rồi đổi hướng, giữ hông ổn định suốt hiệp.'],
    cuesVi: ['Gối mở theo mũi chân', 'Bước ngắn nhưng luôn căng dây', 'Hông giữ ngang'], commonMistakesVi: ['Kéo lê bàn chân', 'Đứng thẳng mất lực mông', 'Gối đổ vào trong'],
    breathingVi: 'Thở đều, thở ra ở mỗi bước mở chân.', defaultPrescription: { sets: 3, reps: '12–16 bước mỗi hướng', restSeconds: 45, rpe: 7 },
  }),
  exercise('aura_women_barbell_glute_bridge', 'Barbell_Glute_Bridge', {
    nameVi: 'Cầu mông đòn tạ trên sàn', nameEn: 'Barbell Glute Bridge', aliasesVi: ['Barbell Glute Bridge'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Mông lớn'], secondaryMuscles: ['Đùi sau', 'Core'], equipment: ['Đòn tạ', 'Đệm đòn', 'Thảm tập'], difficulty: 'beginner',
    instructionsVi: ['Nằm ngửa, đặt đòn tạ có đệm ngang nếp gấp hông.', 'Co gối, đặt bàn chân rộng bằng hông và gần mông vừa đủ.', 'Siết bụng rồi đẩy qua gót chân để nâng hông.', 'Siết mông ở đỉnh một nhịp và hạ xuống chậm.'],
    cuesVi: ['Xương sườn khép', 'Đẩy qua gót chân', 'Dừng bằng siết mông'], commonMistakesVi: ['Ưỡn lưng ở đỉnh', 'Bàn chân đặt quá xa', 'Bật nảy đòn tạ'],
    breathingVi: 'Hít khi hạ hông, thở ra khi nâng và siết mông.', defaultPrescription: { sets: 4, reps: '10–15', restSeconds: 75, rpe: 8 },
  }),
  exercise('aura_women_band_hip_extension', 'Hip_Extension_with_Bands', {
    nameVi: 'Duỗi hông với dây kháng lực', nameEn: 'Hip Extension with Bands', aliasesVi: ['Band Hip Extension'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Mông lớn'], secondaryMuscles: ['Đùi sau', 'Core'], equipment: ['Dây kháng lực', 'Điểm neo'], difficulty: 'beginner', environment: ['home', 'gym'],
    instructionsVi: ['Neo dây thấp và đặt dây chắc quanh cổ chân.', 'Đứng thẳng, vịn điểm cố định và hơi chùng chân trụ.', 'Đưa chân làm việc ra sau từ khớp hông mà không nghiêng người.', 'Siết mông rồi đưa chân về chậm, vẫn giữ căng dây.'],
    cuesVi: ['Hông hướng thẳng trước', 'Biên độ không làm ưỡn lưng', 'Chân về có kiểm soát'], commonMistakesVi: ['Vung chân', 'Mở xoay hông', 'Dồn chuyển động vào lưng dưới'],
    breathingVi: 'Thở ra khi đưa chân ra sau, hít vào khi trở về.', defaultPrescription: { sets: 3, reps: '12–15 mỗi bên', restSeconds: 45, rpe: 7 },
  }),
  exercise('aura_women_bulgarian_split_squat', 'Barbell_Side_Split_Squat', {
    nameVi: 'Bulgarian Split Squat', nameEn: 'Bulgarian Split Squat', aliasesVi: ['Squat một chân kê sau'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Mông', 'Đùi trước'], secondaryMuscles: ['Đùi sau', 'Core'], equipment: ['Ghế tập', 'Tạ đơn'], difficulty: 'intermediate',
    instructionsVi: ['Đứng cách ghế một bước dài, đặt mu bàn chân sau lên ghế.', 'Giữ chân trước bám chắc, nghiêng thân nhẹ về phía trước.', 'Hạ gối sau hướng xuống sàn trong khi gối trước theo mũi chân.', 'Đẩy qua cả bàn chân trước để đứng lên và giữ hông cân bằng.'],
    cuesVi: ['Lực chính ở chân trước', 'Hai hông hướng thẳng', 'Gối theo mũi chân'], commonMistakesVi: ['Đứng quá gần ghế', 'Dùng chân sau đẩy mạnh', 'Gối trước đổ vào trong'],
    breathingVi: 'Hít khi hạ, thở ra khi đẩy người lên.', defaultPrescription: { sets: 3, reps: '8–12 mỗi bên', restSeconds: 75, rpe: 8 },
  }),
  exercise('aura_women_dumbbell_reverse_lunge', 'Dumbbell_Rear_Lunge', {
    nameVi: 'Reverse Lunge với tạ đơn', nameEn: 'Dumbbell Rear Lunge', aliasesVi: ['Chùng chân bước lùi'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Mông', 'Đùi trước'], secondaryMuscles: ['Đùi sau', 'Core'], equipment: ['Tạ đơn'], difficulty: 'beginner',
    instructionsVi: ['Đứng thẳng, giữ tạ dọc hai bên thân và siết nhẹ bụng.', 'Bước một chân ra sau đủ dài, tiếp đất bằng mũi chân.', 'Hạ gối sau xuống gần sàn, giữ chân trước ổn định.', 'Đẩy qua bàn chân trước để trở về đứng rồi đổi bên.'],
    cuesVi: ['Bước lùi trên hai đường ray', 'Thân người ổn định', 'Đẩy bằng chân trước'], commonMistakesVi: ['Bước quá ngắn', 'Gối trước đổ vào trong', 'Đạp mạnh bằng chân sau'],
    breathingVi: 'Hít khi bước lùi và hạ, thở khi trở về đứng.', defaultPrescription: { sets: 3, reps: '10–12 mỗi bên', restSeconds: 60, rpe: 7 },
  }),
  exercise('aura_women_adductor_machine', 'Adductor', {
    nameVi: 'Khép đùi máy', nameEn: 'Adductor Machine', aliasesVi: ['Máy đùi trong'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Đùi trong', 'Cơ khép'], secondaryMuscles: ['Core'], equipment: ['Máy khép đùi'], difficulty: 'beginner',
    instructionsVi: ['Chỉnh ghế và biên độ mở để hông không bị kéo căng quá mức.', 'Ngồi sát lưng ghế, bàn chân đặt đúng bệ và giữ tay cầm.', 'Khép hai đùi vào nhau bằng lực đùi trong.', 'Dừng ngắn rồi mở chân về chậm, không để chồng tạ va.'],
    cuesVi: ['Hông luôn áp ghế', 'Khép bằng đùi trong', 'Chiều mở chậm'], commonMistakesVi: ['Mở biên độ quá rộng', 'Dùng quán tính', 'Nhấc hông khỏi ghế'],
    breathingVi: 'Thở ra khi khép chân, hít vào khi mở.', defaultPrescription: { sets: 3, reps: '12–15', restSeconds: 45, rpe: 8 },
  }),
  exercise('aura_women_cable_hip_adduction', 'Cable_Hip_Adduction', {
    nameVi: 'Khép hông với cáp', nameEn: 'Cable Hip Adduction', aliasesVi: ['Khép chân cáp thấp'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Đùi trong', 'Cơ khép'], secondaryMuscles: ['Mông', 'Core'], equipment: ['Máy cáp', 'Dây cổ chân'], difficulty: 'intermediate',
    instructionsVi: ['Gắn dây cổ chân vào cáp thấp và đứng nghiêng với máy.', 'Chân làm việc ở phía gần máy, chân trụ hơi chùng.', 'Kéo chân làm việc qua trước chân trụ bằng lực đùi trong.', 'Dừng ngắn rồi trả chân về chậm mà không xoay hông.'],
    cuesVi: ['Hông giữ vuông', 'Thân người không nghiêng', 'Chuyển động từ khớp hông'], commonMistakesVi: ['Vung chân qua nhanh', 'Xoay bàn chân và hông', 'Chọn tạ quá nặng'],
    breathingVi: 'Thở ra khi khép chân, hít vào khi mở về.', defaultPrescription: { sets: 3, reps: '12–15 mỗi bên', restSeconds: 45, rpe: 7 },
  }),
  exercise('aura_women_hack_squat', 'Hack_Squat', {
    nameVi: 'Hack Squat máy', nameEn: 'Hack Squat', aliasesVi: ['Squat máy trượt'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Đùi trước', 'Mông'], secondaryMuscles: ['Đùi sau', 'Bắp chân'], equipment: ['Máy Hack Squat'], difficulty: 'intermediate',
    instructionsVi: ['Đặt vai dưới đệm, lưng áp tựa và bàn chân rộng bằng hông.', 'Mở khóa máy, siết bụng và hạ xe trượt có kiểm soát.', 'Hạ đến độ sâu vẫn giữ gót chân và lưng áp máy.', 'Đẩy đều cả bàn chân để đứng lên, không khóa cứng gối.'],
    cuesVi: ['Lưng áp tựa', 'Gối theo mũi chân', 'Đẩy cả bàn chân'], commonMistakesVi: ['Khóa cứng gối', 'Gối đổ vào trong', 'Hạ sâu làm cuộn hông'],
    breathingVi: 'Hít và giữ bụng khi hạ, thở ra khi đẩy lên.', defaultPrescription: { sets: 4, reps: '8–12', restSeconds: 90, rpe: 8 },
  }),
  exercise('aura_women_single_leg_calf_raise', 'Calf_Raise_On_A_Dumbbell', {
    nameVi: 'Nhón bắp chân một chân', nameEn: 'Single-Leg Calf Raise', aliasesVi: ['Calf Raise một chân'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Bắp chân'], secondaryMuscles: ['Cổ chân', 'Core'], equipment: ['Tạ đơn', 'Bục thấp'], difficulty: 'beginner',
    instructionsVi: ['Đặt nửa trước một bàn chân lên mép bục và vịn chắc.', 'Hạ gót xuống vừa đủ để bắp chân được kéo dài.', 'Đẩy qua ngón cái và nhón gót lên cao có kiểm soát.', 'Giữ một nhịp ở đỉnh rồi hạ chậm trước khi lặp lại.'],
    cuesVi: ['Cổ chân đi thẳng', 'Đẩy qua ngón cái', 'Dừng rõ ở đỉnh'], commonMistakesVi: ['Bật nảy ở đáy', 'Lật cổ chân ra ngoài', 'Biên độ quá ngắn'],
    breathingVi: 'Thở ra khi nhón gót, hít vào khi hạ.', defaultPrescription: { sets: 3, reps: '12–20 mỗi bên', restSeconds: 45, rpe: 8 },
  }),
  exercise('aura_women_one_arm_dumbbell_row', 'One-Arm_Dumbbell_Row', {
    nameVi: 'Kéo tạ đơn một tay', nameEn: 'One-Arm Dumbbell Row', aliasesVi: ['Dumbbell Row một tay'], bodyParts: ['Thân trên'],
    targetMuscles: ['Cơ xô', 'Lưng giữa'], secondaryMuscles: ['Vai sau', 'Tay trước', 'Core'], equipment: ['Tạ đơn', 'Ghế tập'], difficulty: 'beginner',
    instructionsVi: ['Chống một tay và gối cùng bên lên ghế, chân còn lại đứng vững.', 'Giữ lưng trung lập, vai làm việc hạ xa tai.', 'Kéo khuỷu tay về phía hông để nâng tạ sát thân.', 'Siết lưng ngắn rồi hạ tạ chậm đến khi tay duỗi tự nhiên.'],
    cuesVi: ['Kéo khuỷu về hông', 'Vai không nhún', 'Hông không xoay'], commonMistakesVi: ['Vặn thân để lấy đà', 'Kéo tạ lên vai', 'Gập lưng'],
    breathingVi: 'Thở ra khi kéo tạ, hít vào khi hạ.', defaultPrescription: { sets: 3, reps: '10–12 mỗi bên', restSeconds: 60, rpe: 8 },
  }),
  exercise('aura_women_close_grip_lat_pulldown', 'Close-Grip_Front_Lat_Pulldown', {
    nameVi: 'Kéo xô tay hẹp', nameEn: 'Close-Grip Front Lat Pulldown', aliasesVi: ['Lat Pulldown tay hẹp'], bodyParts: ['Thân trên'],
    targetMuscles: ['Cơ xô'], secondaryMuscles: ['Lưng giữa', 'Tay trước'], equipment: ['Máy kéo xô', 'Tay cầm hẹp'], difficulty: 'beginner',
    instructionsVi: ['Ngồi cố định đùi dưới đệm và nắm tay cầm hẹp.', 'Nâng ngực nhẹ, giữ xương sườn ổn định và hạ vai.', 'Kéo khuỷu tay xuống sát thân, đưa tay cầm về ngực trên.', 'Dừng ngắn rồi duỗi tay lên chậm để cơ xô được kéo dài.'],
    cuesVi: ['Khuỷu kéo xuống', 'Vai tránh nhún', 'Thân không ngả quá nhiều'], commonMistakesVi: ['Kéo bằng tay trước', 'Giật người ra sau', 'Thả tạ quá nhanh'],
    breathingVi: 'Thở ra khi kéo xuống, hít vào khi duỗi lên.', defaultPrescription: { sets: 3, reps: '10–12', restSeconds: 75, rpe: 8 },
  }),
  exercise('aura_women_cable_lateral_raise', 'Cable_Seated_Lateral_Raise', {
    nameVi: 'Nâng vai ngang với cáp', nameEn: 'Cable Lateral Raise', aliasesVi: ['Cable Lateral Raise'], bodyParts: ['Thân trên'],
    targetMuscles: ['Vai giữa'], secondaryMuscles: ['Vai trước', 'Cơ thang'], equipment: ['Máy cáp', 'Tay cầm đơn'], difficulty: 'intermediate',
    instructionsVi: ['Đặt cáp thấp, đứng nghiêng và cầm tay cầm bằng tay xa máy.', 'Giữ khuỷu hơi gập, vai hạ và thân người ổn định.', 'Nâng cánh tay sang ngang đến gần ngang vai.', 'Dừng ngắn rồi hạ tay chậm, duy trì lực căng cáp.'],
    cuesVi: ['Dẫn chuyển động bằng khuỷu', 'Vai tránh nhún', 'Cổ tay trung lập'], commonMistakesVi: ['Nâng tay quá cao', 'Vung người', 'Chọn tạ quá nặng'],
    breathingVi: 'Thở ra khi nâng tay, hít vào khi hạ.', defaultPrescription: { sets: 3, reps: '12–15 mỗi bên', restSeconds: 45, rpe: 8 },
  }),
  exercise('aura_women_cable_rear_delt_fly', 'Cable_Rear_Delt_Fly', {
    nameVi: 'Ép vai sau với cáp', nameEn: 'Cable Rear Delt Fly', aliasesVi: ['Cable Rear Delt Fly'], bodyParts: ['Thân trên'],
    targetMuscles: ['Vai sau'], secondaryMuscles: ['Lưng trên', 'Cơ xoay vai'], equipment: ['Máy cáp đôi'], difficulty: 'intermediate',
    instructionsVi: ['Đặt hai ròng rọc ngang vai và bắt chéo tay cầm.', 'Lùi nhẹ, giữ ngực mở, khuỷu mềm và vai hạ.', 'Mở hai tay sang hai bên bằng lực vai sau.', 'Dừng khi tay thẳng hàng thân rồi trở về chậm.'],
    cuesVi: ['Mở bằng khuỷu tay', 'Vai không nhún', 'Thân người đứng yên'], commonMistakesVi: ['Kéo quá xa ra sau', 'Co khuỷu thành động tác row', 'Dùng lưng dưới lấy đà'],
    breathingVi: 'Thở ra khi mở tay, hít vào khi khép về.', defaultPrescription: { sets: 3, reps: '12–15', restSeconds: 45, rpe: 7 },
  }),
  exercise('aura_women_rope_overhead_triceps_extension', 'Cable_Rope_Overhead_Triceps_Extension', {
    nameVi: 'Duỗi tay sau qua đầu với dây thừng', nameEn: 'Cable Rope Overhead Triceps Extension', aliasesVi: ['Overhead Triceps Extension'], bodyParts: ['Thân trên'],
    targetMuscles: ['Tay sau'], secondaryMuscles: ['Vai', 'Core'], equipment: ['Máy cáp', 'Dây thừng'], difficulty: 'intermediate',
    instructionsVi: ['Quay lưng với cáp, cầm dây và bước ra tạo lực căng.', 'Đưa khuỷu lên hai bên đầu, hơi nghiêng thân và siết bụng.', 'Duỗi khuỷu để đưa hai đầu dây ra trước và tách nhẹ.', 'Dừng khi tay gần thẳng rồi gập khuỷu về chậm.'],
    cuesVi: ['Khuỷu hướng trước', 'Cánh tay trên giữ yên', 'Xương sườn khép'], commonMistakesVi: ['Xòe khuỷu quá rộng', 'Ưỡn lưng', 'Di chuyển vai thay vì khuỷu'],
    breathingVi: 'Thở ra khi duỗi tay, hít vào khi gập về.', defaultPrescription: { sets: 3, reps: '10–15', restSeconds: 60, rpe: 8 },
  }),
  exercise('aura_women_alternate_hammer_curl', 'Alternate_Hammer_Curl', {
    nameVi: 'Cuốn tạ búa luân phiên', nameEn: 'Alternate Hammer Curl', aliasesVi: ['Hammer Curl'], bodyParts: ['Thân trên'],
    targetMuscles: ['Tay trước'], secondaryMuscles: ['Cẳng tay'], equipment: ['Tạ đơn'], difficulty: 'beginner',
    instructionsVi: ['Đứng thẳng, giữ hai tạ bên thân với lòng bàn tay hướng vào nhau.', 'Siết bụng và giữ khuỷu sát thân.', 'Gập một khuỷu để nâng tạ về vai mà không xoay cổ tay.', 'Hạ tạ chậm rồi đổi bên, giữ thân người không đung đưa.'],
    cuesVi: ['Khuỷu giữ tại chỗ', 'Cổ tay trung lập', 'Chiều hạ chậm'], commonMistakesVi: ['Vung hông', 'Đưa khuỷu ra trước', 'Gập cổ tay'],
    breathingVi: 'Thở ra khi cuốn tạ, hít vào khi hạ.', defaultPrescription: { sets: 3, reps: '10–12 mỗi bên', restSeconds: 45, rpe: 8 },
  }),
  exercise('aura_women_cable_chest_press', 'Cable_Chest_Press', {
    nameVi: 'Đẩy ngực với cáp', nameEn: 'Cable Chest Press', aliasesVi: ['Cable Press'], bodyParts: ['Thân trên'],
    targetMuscles: ['Ngực'], secondaryMuscles: ['Vai trước', 'Tay sau', 'Core'], equipment: ['Máy cáp đôi'], difficulty: 'intermediate',
    instructionsVi: ['Đặt tay cầm ngang ngực, bước lên tư thế chân trước chân sau.', 'Giữ tay cầm hai bên ngực, khuỷu thấp hơn vai nhẹ.', 'Đẩy hai tay ra trước đến khi gần thẳng mà không nhún vai.', 'Khép ngực ngắn rồi đưa tay về chậm, giữ thân ổn định.'],
    cuesVi: ['Xương sườn khép', 'Vai hạ xa tai', 'Đẩy theo đường ngang ngực'], commonMistakesVi: ['Ưỡn lưng', 'Khuỷu mở ngang vai', 'Để cáp kéo giật về sau'],
    breathingVi: 'Thở ra khi đẩy, hít vào khi thu tay.', defaultPrescription: { sets: 3, reps: '10–12', restSeconds: 75, rpe: 8 },
  }),
  exercise('aura_women_cable_crossover', 'Cable_Crossover', {
    nameVi: 'Ép ngực cáp đứng', nameEn: 'Cable Crossover', aliasesVi: ['Cable Fly'], bodyParts: ['Thân trên'],
    targetMuscles: ['Ngực'], secondaryMuscles: ['Vai trước', 'Core'], equipment: ['Máy cáp đôi'], difficulty: 'intermediate',
    instructionsVi: ['Đặt cáp cao hơn vai nhẹ, cầm hai tay và bước lên trước.', 'Hơi nghiêng thân, giữ khuỷu cong nhẹ và vai hạ.', 'Khép hai cánh tay theo vòng cung về trước ngực.', 'Siết ngực rồi mở tay về chậm đến khi ngực căng vừa đủ.'],
    cuesVi: ['Khuỷu giữ góc cố định', 'Khép bằng ngực', 'Vai không trôi ra trước'], commonMistakesVi: ['Biến thành động tác đẩy', 'Mở tay quá sâu', 'Dùng thân người lấy đà'],
    breathingVi: 'Thở ra khi khép tay, hít vào khi mở.', defaultPrescription: { sets: 3, reps: '12–15', restSeconds: 60, rpe: 7 },
  }),
  exercise('aura_women_cable_reverse_crunch', 'Cable_Reverse_Crunch', {
    nameVi: 'Cuộn bụng ngược với cáp', nameEn: 'Cable Reverse Crunch', aliasesVi: ['Reverse Crunch cáp'], bodyParts: ['Core'],
    targetMuscles: ['Cơ bụng dưới', 'Cơ bụng sâu'], secondaryMuscles: ['Gập hông'], equipment: ['Máy cáp', 'Dây cổ chân', 'Thảm tập'], difficulty: 'intermediate',
    instructionsVi: ['Nằm ngửa quay chân về cáp thấp và gắn dây chắc quanh cổ chân.', 'Nâng chân, gập hông gối khoảng 90 độ và ép lưng xuống thảm.', 'Cuộn xương chậu về phía ngực để nhấc nhẹ hông khỏi sàn.', 'Hạ hông và chân về chậm mà không để lưng dưới võng.'],
    cuesVi: ['Cuộn xương chậu', 'Lưng dưới giữ ổn định', 'Không đá chân lấy đà'], commonMistakesVi: ['Chỉ gập hông', 'Vung chân', 'Hạ quá xa làm võng lưng'],
    breathingVi: 'Thở hết khi cuộn hông lên, hít vào khi hạ chậm.', defaultPrescription: { sets: 3, reps: '10–15', restSeconds: 60, rpe: 8 },
  }),
  exercise('aura_women_mountain_climber', 'Mountain_Climbers', {
    nameVi: 'Mountain Climber kiểm soát', nameEn: 'Mountain Climbers', aliasesVi: ['Leo núi tại chỗ'], bodyParts: ['Core', 'Toàn thân'],
    targetMuscles: ['Cơ bụng sâu'], secondaryMuscles: ['Vai', 'Gập hông', 'Đùi trước'], equipment: ['Thảm tập'], difficulty: 'beginner', environment: ['home', 'gym'],
    instructionsVi: ['Vào tư thế plank tay cao, hai tay dưới vai và chân duỗi.', 'Siết bụng, đẩy sàn và giữ hông ngang.', 'Kéo một gối về gần ngực mà không làm lưng cong.', 'Đổi chân theo nhịp kiểm soát, duy trì thân trên ổn định.'],
    cuesVi: ['Hông không nảy lên xuống', 'Vai nằm trên cổ tay', 'Kéo gối bằng bụng'], commonMistakesVi: ['Chạy quá nhanh mất kỹ thuật', 'Võng lưng', 'Dồn vai ra sau tay'],
    breathingVi: 'Thở đều theo nhịp đổi chân, không nín thở.', defaultPrescription: { sets: 3, reps: '30–40 giây', restSeconds: 45, rpe: 7 },
  }),
  exercise('aura_women_hanging_leg_raise', 'Hanging_Leg_Raise', {
    nameVi: 'Treo người nâng chân', nameEn: 'Hanging Leg Raise', aliasesVi: ['Hanging Knee Raise'], bodyParts: ['Core'],
    targetMuscles: ['Cơ bụng dưới', 'Cơ bụng sâu'], secondaryMuscles: ['Gập hông', 'Cẳng tay'], equipment: ['Xà đơn'], difficulty: 'advanced',
    instructionsVi: ['Nắm xà chắc, treo người với vai chủ động và chân khép.', 'Siết bụng, thu nhẹ xương chậu để hạn chế đung đưa.', 'Nâng gối hoặc chân về trước bằng cách cuộn xương chậu.', 'Hạ chân chậm về thẳng người trước lần lặp tiếp theo.'],
    cuesVi: ['Bắt đầu bằng cuộn hông', 'Không đung đưa', 'Vai luôn chủ động'], commonMistakesVi: ['Đá chân lấy đà', 'Thả rơi chân', 'Chỉ dùng cơ gập hông'],
    breathingVi: 'Thở ra khi nâng chân, hít vào khi hạ chậm.', defaultPrescription: { sets: 3, reps: '8–12', restSeconds: 75, rpe: 8 },
  }),
]

function validateItems(items) {
  if (items.length !== 20) throw new Error(`Expected exactly 20 specialized exercises, received ${items.length}.`)
  const ids = new Set()
  for (const item of items) {
    if (!/^aura_women_[a-z0-9_]+$/.test(item.id) || ids.has(item.id)) throw new Error(`Invalid or duplicate id: ${item.id}`)
    ids.add(item.id)
    if (item.status !== 'published' || !item.nameVi || !item.nameEn) throw new Error(`Identity is incomplete: ${item.id}`)
    if (item.instructionsVi.length < 4 || item.cuesVi.length < 3 || item.commonMistakesVi.length < 3) throw new Error(`Coaching content is incomplete: ${item.id}`)
    if (!item.breathingVi || !item.media.startImageUrl || !item.media.endImageUrl) throw new Error(`Media or breathing is incomplete: ${item.id}`)
    if (!item.targetMuscles.length || !item.equipment.length) throw new Error(`Classification is incomplete: ${item.id}`)
    if (item.defaultPrescription.sets < 1 || !item.defaultPrescription.reps || item.defaultPrescription.rpe < 1) throw new Error(`Prescription is incomplete: ${item.id}`)
  }
}

if (require.main === module) runCatalogImport({
  sourceItems: ITEMS,
  release: RELEASE,
  confirmation: CONFIRMATION,
  reportPath: REPORT,
  categories: { lowerBody: 9, upperBody: 8, core: 3 },
  validate: validateItems,
}).catch((error) => { console.error(error.message); process.exitCode = 1 })

module.exports = { ITEMS, RELEASE, validateItems }
