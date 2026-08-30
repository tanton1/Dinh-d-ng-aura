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
  exercise('aura_women_thigh_abductor_machine', 'Thigh_Abductor', {
    nameVi: 'Dạng đùi máy', nameEn: 'Thigh Abductor Machine', aliasesVi: ['Máy đùi ngoài', 'Máy dạng hông'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Mông nhỡ', 'Đùi ngoài'], secondaryMuscles: ['Mông nhỏ', 'Core'], equipment: ['Máy dạng đùi'], difficulty: 'beginner',
    instructionsVi: ['Chỉnh ghế và biên độ khởi đầu để hai gối không bị ép quá sâu vào trong.', 'Ngồi sát tựa lưng, đặt hai chân đúng bệ và giữ hông cân bằng.', 'Mở hai đùi sang hai bên bằng lực mông ngoài, không bật người.', 'Dừng một nhịp ở biên độ chủ động rồi khép chân về chậm.'],
    cuesVi: ['Mở gối bằng mông', 'Hông luôn áp ghế', 'Chiều về chậm hơn chiều mở'], commonMistakesVi: ['Dùng quán tính để bật gối', 'Nhấc hông khỏi ghế', 'Chọn mức tạ làm mất biên độ'],
    breathingVi: 'Thở ra khi mở đùi, hít vào khi khép về.', defaultPrescription: { sets: 3, reps: '12–20', restSeconds: 45, rpe: 8 },
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
  exercise('aura_women_platform_hamstring_slide', 'Platform_Hamstring_Slides', {
    nameVi: 'Trượt gót tập đùi sau', nameEn: 'Platform Hamstring Slides', aliasesVi: ['Hamstring Slide', 'Cuốn đùi sau trượt gót'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Đùi sau'], secondaryMuscles: ['Mông', 'Core'], equipment: ['Đĩa trượt', 'Thảm tập'], difficulty: 'intermediate', environment: ['home', 'gym'],
    instructionsVi: ['Nằm ngửa, đặt hai gót lên đĩa trượt và co gối khoảng 90 độ.', 'Siết bụng, nâng hông để vai, hông và gối tạo thành đường thẳng.', 'Trượt hai gót ra xa chậm trong khi giữ hông không rơi xuống.', 'Kéo gót về bằng lực đùi sau, giữ xương chậu ổn định suốt lần lặp.'],
    cuesVi: ['Hông luôn được nâng', 'Kéo bằng gót chân', 'Chiều duỗi thật chậm'], commonMistakesVi: ['Để hông chạm sàn', 'Co lưng dưới để bù lực', 'Trượt quá xa làm mất kiểm soát'],
    breathingVi: 'Hít khi trượt chân ra, thở ra khi kéo gót về.', defaultPrescription: { sets: 3, reps: '8–12', restSeconds: 60, rpe: 8 },
  }),
  exercise('aura_women_adductor_machine', 'Adductor', {
    nameVi: 'Khép đùi máy', nameEn: 'Adductor Machine', aliasesVi: ['Máy đùi trong'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Đùi trong', 'Cơ khép'], secondaryMuscles: ['Core'], equipment: ['Máy khép đùi'], difficulty: 'beginner',
    instructionsVi: ['Chỉnh ghế và biên độ mở để hông không bị kéo căng quá mức.', 'Ngồi sát lưng ghế, bàn chân đặt đúng bệ và giữ tay cầm.', 'Khép hai đùi vào nhau bằng lực đùi trong.', 'Dừng ngắn rồi mở chân về chậm, không để chồng tạ va.'],
    cuesVi: ['Hông luôn áp ghế', 'Khép bằng đùi trong', 'Chiều mở chậm'], commonMistakesVi: ['Mở biên độ quá rộng', 'Dùng quán tính', 'Nhấc hông khỏi ghế'],
    breathingVi: 'Thở ra khi khép chân, hít vào khi mở.', defaultPrescription: { sets: 3, reps: '12–15', restSeconds: 45, rpe: 8 },
  }),
  exercise('aura_women_cable_pull_through', 'Pull_Through', {
    nameVi: 'Cable Pull Through', nameEn: 'Cable Pull Through', aliasesVi: ['Kéo cáp qua chân', 'Hip Hinge với cáp'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Mông lớn'], secondaryMuscles: ['Đùi sau', 'Core'], equipment: ['Máy cáp', 'Dây thừng'], difficulty: 'beginner',
    instructionsVi: ['Gắn dây thừng vào cáp thấp, quay lưng với máy và cầm dây qua giữa hai chân.', 'Bước ra đủ xa để cáp luôn căng, đứng rộng bằng hông và chùng gối nhẹ.', 'Đẩy hông ra sau, giữ cột sống trung lập và để dây đi sát thân.', 'Siết mông đưa hông về trước đến khi đứng cao, không ngửa lưng.'],
    cuesVi: ['Đẩy hông ra sau', 'Cẳng chân gần thẳng đứng', 'Kết thúc bằng siết mông'], commonMistakesVi: ['Biến động tác thành squat', 'Ưỡn lưng ở cuối', 'Kéo dây bằng tay'],
    breathingVi: 'Hít khi đẩy hông ra sau, thở ra khi đứng lên.', defaultPrescription: { sets: 3, reps: '12–15', restSeconds: 60, rpe: 8 },
  }),
  exercise('aura_women_seated_leg_curl', 'Seated_Leg_Curl', {
    nameVi: 'Cuốn đùi sau máy ngồi', nameEn: 'Seated Leg Curl', aliasesVi: ['Leg Curl ngồi'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Đùi sau'], secondaryMuscles: ['Bắp chân'], equipment: ['Máy cuốn đùi sau'], difficulty: 'beginner',
    instructionsVi: ['Chỉnh trục máy ngang khớp gối, đệm dưới nằm trên gót và đệm trên giữ chắc đùi.', 'Ngồi sát lưng ghế, duỗi chân tự nhiên và giữ tay cầm.', 'Cuốn gót xuống dưới ghế bằng lực đùi sau, không nhấc hông.', 'Siết ngắn ở đáy rồi duỗi gối về chậm mà không để chồng tạ va.'],
    cuesVi: ['Gối thẳng trục máy', 'Hông giữ sát ghế', 'Chiều duỗi có kiểm soát'], commonMistakesVi: ['Nhấc hông khi kéo', 'Thả tạ rơi nhanh', 'Co bàn chân quá mức để lấy lực bắp chân'],
    breathingVi: 'Thở ra khi cuốn chân, hít vào khi duỗi về.', defaultPrescription: { sets: 3, reps: '10–15', restSeconds: 60, rpe: 8 },
  }),
  exercise('aura_women_single_leg_calf_raise', 'Calf_Raise_On_A_Dumbbell', {
    nameVi: 'Nhón bắp chân một chân', nameEn: 'Single-Leg Calf Raise', aliasesVi: ['Calf Raise một chân'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Bắp chân'], secondaryMuscles: ['Cổ chân', 'Core'], equipment: ['Tạ đơn', 'Bục thấp'], difficulty: 'beginner',
    instructionsVi: ['Đặt nửa trước một bàn chân lên mép bục và vịn chắc.', 'Hạ gót xuống vừa đủ để bắp chân được kéo dài.', 'Đẩy qua ngón cái và nhón gót lên cao có kiểm soát.', 'Giữ một nhịp ở đỉnh rồi hạ chậm trước khi lặp lại.'],
    cuesVi: ['Cổ chân đi thẳng', 'Đẩy qua ngón cái', 'Dừng rõ ở đỉnh'], commonMistakesVi: ['Bật nảy ở đáy', 'Lật cổ chân ra ngoài', 'Biên độ quá ngắn'],
    breathingVi: 'Thở ra khi nhón gót, hít vào khi hạ.', defaultPrescription: { sets: 3, reps: '12–20 mỗi bên', restSeconds: 45, rpe: 8 },
  }),
  exercise('aura_women_chest_supported_dumbbell_row', 'Dumbbell_Incline_Row', {
    nameVi: 'Kéo tạ đơn tựa ngực ghế dốc', nameEn: 'Chest-Supported Dumbbell Row', aliasesVi: ['Dumbbell Incline Row'], bodyParts: ['Thân trên'],
    targetMuscles: ['Lưng giữa', 'Cơ xô'], secondaryMuscles: ['Vai sau', 'Tay trước'], equipment: ['Ghế dốc', 'Tạ đơn'], difficulty: 'beginner',
    instructionsVi: ['Chỉnh ghế dốc khoảng 30–45 độ và nằm sấp sao cho ngực được nâng đỡ.', 'Giữ hai tạ dưới vai, chân bám sàn và vai hạ xa tai.', 'Kéo hai khuỷu tay về sau, hướng tạ về hai bên thân.', 'Siết lưng ngắn rồi hạ tạ chậm đến khi bả vai mở tự nhiên.'],
    cuesVi: ['Ngực luôn chạm ghế', 'Khuỷu kéo về hông', 'Vai không nhún'], commonMistakesVi: ['Nhấc ngực khỏi ghế', 'Kéo tạ bằng cổ tay', 'Thả tạ quá nhanh'],
    breathingVi: 'Thở ra khi kéo tạ, hít vào khi hạ.', defaultPrescription: { sets: 3, reps: '10–12', restSeconds: 60, rpe: 8 },
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
  exercise('aura_women_arnold_dumbbell_press', 'Arnold_Dumbbell_Press', {
    nameVi: 'Arnold Press với tạ đơn', nameEn: 'Arnold Dumbbell Press', aliasesVi: ['Arnold Press'], bodyParts: ['Thân trên'],
    targetMuscles: ['Vai trước', 'Vai giữa'], secondaryMuscles: ['Tay sau', 'Core'], equipment: ['Tạ đơn', 'Ghế tựa'], difficulty: 'intermediate',
    instructionsVi: ['Ngồi sát ghế tựa, giữ hai tạ trước ngực với lòng bàn tay hướng vào người.', 'Siết bụng và hạ vai, giữ cổ tay thẳng trên khuỷu.', 'Xoay lòng bàn tay ra ngoài đồng thời đẩy tạ lên qua đầu.', 'Hạ tạ theo đúng đường ngược lại, đưa khuỷu về trước có kiểm soát.'],
    cuesVi: ['Xương sườn giữ khép', 'Xoay và đẩy liền mạch', 'Vai luôn xa tai'], commonMistakesVi: ['Ưỡn lưng để đẩy tạ', 'Va hai tạ trên đỉnh', 'Xoay cổ tay quá sớm'],
    breathingVi: 'Thở ra khi đẩy tạ lên, hít vào khi hạ về.', defaultPrescription: { sets: 3, reps: '8–12', restSeconds: 60, rpe: 8 },
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
  exercise('aura_women_cable_wood_chop', 'Standing_Cable_Wood_Chop', {
    nameVi: 'Wood Chop với cáp', nameEn: 'Standing Cable Wood Chop', aliasesVi: ['Xoay chéo bụng với cáp'], bodyParts: ['Core'],
    targetMuscles: ['Cơ xiên', 'Cơ bụng sâu'], secondaryMuscles: ['Vai', 'Mông'], equipment: ['Máy cáp', 'Tay cầm đơn'], difficulty: 'intermediate',
    instructionsVi: ['Đặt cáp cao hơn vai, đứng nghiêng với máy và nắm tay cầm bằng hai tay.', 'Mở chân vững, hơi chùng gối và giữ xương sườn trên xương chậu.', 'Kéo tay chéo xuống qua thân bằng cách xoay lồng ngực có kiểm soát.', 'Dừng khi tay gần hông đối diện rồi trở về chậm, chống lực kéo của cáp.'],
    cuesVi: ['Xoay từ lồng ngực', 'Hông giữ ổn định', 'Tay chỉ là móc nối'], commonMistakesVi: ['Kéo hoàn toàn bằng tay', 'Vặn gối theo cáp', 'Ưỡn lưng khi trở về'],
    breathingVi: 'Thở ra khi kéo chéo xuống, hít vào khi trở về.', defaultPrescription: { sets: 3, reps: '10–12 mỗi bên', restSeconds: 45, rpe: 7 },
  }),
  exercise('aura_women_stomach_vacuum', 'Stomach_Vacuum', {
    nameVi: 'Stomach Vacuum kiểm soát bụng sâu', nameEn: 'Stomach Vacuum', aliasesVi: ['Hút bụng', 'Kích hoạt cơ ngang bụng'], bodyParts: ['Core'],
    targetMuscles: ['Cơ bụng sâu'], secondaryMuscles: ['Cơ hoành', 'Sàn chậu'], equipment: ['Không dụng cụ'], difficulty: 'beginner', environment: ['home', 'gym'],
    instructionsVi: ['Đứng hoặc quỳ với cột sống trung lập, hai tay tựa nhẹ để thả lỏng vai.', 'Hít vào bằng mũi rồi thở ra dài cho đến khi lồng ngực hạ tự nhiên.', 'Nhẹ nhàng kéo bụng dưới vào trong như kéo khóa quần, không gồng vai.', 'Giữ trong thời gian quy định, sau đó thả bụng và hít vào từ từ.'],
    cuesVi: ['Kéo bụng vào chứ không nín ép', 'Vai và cổ thả lỏng', 'Giữ lưng trung lập'], commonMistakesVi: ['Nín thở quá sức', 'Hóp ngực và gù lưng', 'Gồng bụng cứng thay vì kéo bụng sâu'],
    breathingVi: 'Thở ra hết trước khi giữ; dừng ngay nếu chóng mặt và trở lại nhịp thở bình thường.', defaultPrescription: { sets: 3, reps: '15–25 giây', restSeconds: 45, rpe: 5 },
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
