const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
})
const RELEASE = 'aura-women-20-v1'
const CONFIRMATION = 'IMPORT_AURA_WOMEN_20_V1'
const SOURCE_REPO = 'https://github.com/yuhonas/free-exercise-db'
const SOURCE_MEDIA_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/'
const REPORT = path.resolve('.migration-private', 'aura-women-20-report.json')

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex') }
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
    goals: ['Tăng sức mạnh', 'Cải thiện vóc dáng', 'Kiểm soát vận động'],
    media: media(sourceExerciseId),
    source: { provider: 'free-exercise-db', sourceExerciseId, sourceVersion: 'main-2026-08-22', license: 'Unlicense' },
    sourceAttribution: `Free Exercise DB · Unlicense · ${SOURCE_REPO}`,
    ...fields,
  }
}

const ITEMS = [
  exercise('aura_women_barbell_hip_thrust', 'Barbell_Hip_Thrust', {
    nameVi: 'Hip Thrust đòn tạ', nameEn: 'Barbell Hip Thrust', aliasesVi: ['Đẩy hông đòn tạ'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Mông lớn'], secondaryMuscles: ['Đùi sau', 'Core'], equipment: ['Đòn tạ', 'Ghế tập', 'Đệm đòn'], difficulty: 'intermediate',
    instructionsVi: ['Tựa phần dưới xương bả vai lên mép ghế, đặt đòn tạ ngang nếp gấp hông.', 'Đặt bàn chân rộng bằng hông, cẳng chân gần thẳng đứng khi lên đỉnh.', 'Siết bụng, thu nhẹ cằm và đẩy hông lên bằng lực gót chân.', 'Dừng một nhịp ở đỉnh, siết mông rồi hạ hông có kiểm soát.'],
    cuesVi: ['Xương sườn khép, không ưỡn lưng', 'Đẩy qua gót chân', 'Siết mông ở đỉnh'], commonMistakesVi: ['Đặt chân quá xa hoặc quá gần', 'Ưỡn lưng thay vì duỗi hông', 'Bật nảy ở đáy'],
    breathingVi: 'Hít vào khi hạ hông, thở mạnh khi đẩy lên và siết mông.', defaultPrescription: { sets: 4, reps: '8–12', restSeconds: 90, rpe: 8 },
  }),
  exercise('aura_women_single_leg_glute_bridge', 'Single_Leg_Glute_Bridge', {
    nameVi: 'Cầu mông một chân', nameEn: 'Single Leg Glute Bridge', aliasesVi: ['Glute Bridge một chân'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Mông lớn'], secondaryMuscles: ['Đùi sau', 'Core'], equipment: ['Thảm tập'], difficulty: 'beginner', environment: ['home', 'gym'],
    instructionsVi: ['Nằm ngửa, co một gối và đặt bàn chân chắc trên sàn.', 'Nâng chân còn lại, giữ hai đùi gần song song.', 'Siết bụng rồi đẩy hông lên bằng gót chân trụ.', 'Giữ hông cân bằng, siết mông ở đỉnh và hạ chậm.'],
    cuesVi: ['Hông luôn cân bằng', 'Gót chân trụ bám sàn', 'Không đẩy bằng lưng'], commonMistakesVi: ['Xoay hông sang bên', 'Đẩy quá cao gây ưỡn lưng', 'Dùng quán tính'],
    breathingVi: 'Hít khi hạ, thở khi nâng hông.', defaultPrescription: { sets: 3, reps: '10–15 mỗi bên', restSeconds: 45, rpe: 7 },
  }),
  exercise('aura_women_cable_glute_kickback', 'One-Legged_Cable_Kickback', {
    nameVi: 'Đá mông cáp một chân', nameEn: 'One-Legged Cable Kickback', aliasesVi: ['Cable Glute Kickback'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Mông lớn'], secondaryMuscles: ['Đùi sau'], equipment: ['Máy cáp', 'Dây cổ chân'], difficulty: 'intermediate',
    instructionsVi: ['Gắn dây cổ chân vào cáp thấp và vịn chắc vào khung máy.', 'Hơi gập gối trụ, nghiêng thân nhẹ nhưng giữ lưng trung lập.', 'Đưa chân làm việc ra sau bằng chuyển động từ khớp hông.', 'Siết mông ở cuối biên độ rồi đưa chân về chậm, không để tạ va.'],
    cuesVi: ['Hông hướng thẳng phía trước', 'Biên độ vừa đủ để lưng không ưỡn', 'Kiểm soát chiều về'], commonMistakesVi: ['Vung chân quá mạnh', 'Mở xoay hông', 'Ưỡn thắt lưng'],
    breathingVi: 'Thở ra khi đá chân ra sau, hít vào khi thu chân.', defaultPrescription: { sets: 3, reps: '12–15 mỗi bên', restSeconds: 45, rpe: 8 },
  }),
  exercise('aura_women_goblet_squat', 'Goblet_Squat', {
    nameVi: 'Goblet Squat', nameEn: 'Goblet Squat', aliasesVi: ['Squat ôm tạ trước ngực'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Đùi trước', 'Mông'], secondaryMuscles: ['Đùi sau', 'Core'], equipment: ['Tạ chuông hoặc tạ đơn'], difficulty: 'beginner',
    instructionsVi: ['Ôm tạ sát trước ngực, đặt chân rộng hơn hông một chút.', 'Siết bụng, giữ ngực mở và bắt đầu ngồi hông xuống giữa hai chân.', 'Hạ đến độ sâu vẫn giữ được bàn chân bám sàn và lưng trung lập.', 'Đẩy đều cả bàn chân để đứng lên, siết mông ở cuối động tác.'],
    cuesVi: ['Gối hướng theo mũi chân', 'Ba điểm bàn chân bám sàn', 'Tạ luôn sát ngực'], commonMistakesVi: ['Gối đổ vào trong', 'Nhấc gót chân', 'Gập lưng ở đáy'],
    breathingVi: 'Hít và giữ bụng khi hạ, thở ra khi vượt qua điểm khó để đứng lên.', defaultPrescription: { sets: 4, reps: '8–12', restSeconds: 75, rpe: 7 },
  }),
  exercise('aura_women_romanian_deadlift', 'Romanian_Deadlift', {
    nameVi: 'Romanian Deadlift', nameEn: 'Romanian Deadlift', aliasesVi: ['RDL', 'Gập hông đòn tạ'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Đùi sau'], secondaryMuscles: ['Mông', 'Lưng dưới', 'Core'], equipment: ['Đòn tạ'], difficulty: 'intermediate',
    instructionsVi: ['Đứng thẳng, cầm đòn tạ trước đùi và hơi chùng gối.', 'Đẩy hông ra sau, giữ đòn tạ trượt sát chân.', 'Hạ đến khi cảm nhận căng rõ đùi sau mà lưng vẫn trung lập.', 'Đẩy hông về trước để đứng lên, siết mông và không ngả người ra sau.'],
    cuesVi: ['Hông đi ra sau', 'Đòn tạ sát chân', 'Cột sống giữ trung lập'], commonMistakesVi: ['Biến thành động tác squat', 'Hạ quá sâu làm cong lưng', 'Đòn tạ rời xa cơ thể'],
    breathingVi: 'Hít sâu và khóa bụng trước khi hạ, thở ra khi đứng lên.', defaultPrescription: { sets: 4, reps: '8–10', restSeconds: 90, rpe: 8 },
  }),
  exercise('aura_women_sumo_deadlift', 'Sumo_Deadlift', {
    nameVi: 'Sumo Deadlift', nameEn: 'Sumo Deadlift', aliasesVi: ['Deadlift chân rộng'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Mông', 'Đùi trong', 'Đùi sau'], secondaryMuscles: ['Đùi trước', 'Lưng', 'Core'], equipment: ['Đòn tạ'], difficulty: 'intermediate',
    instructionsVi: ['Đứng chân rộng, mũi chân mở vừa phải và đặt đòn tạ trên giữa bàn chân.', 'Hạ hông, nắm đòn trong hai gối và giữ ngực hướng lên.', 'Siết bụng, đạp sàn sang hai bên và kéo đòn lên sát người.', 'Khóa hông bằng cách siết mông, sau đó hạ đòn theo đường cũ.'],
    cuesVi: ['Gối hướng theo mũi chân', 'Đạp sàn ra hai bên', 'Đòn đi sát cơ thể'], commonMistakesVi: ['Hông bật lên trước vai', 'Gối đổ vào trong', 'Ngửa lưng ở đỉnh'],
    breathingVi: 'Hít sâu tạo áp lực bụng trước mỗi lần kéo, thở ra sau khi qua điểm khó.', defaultPrescription: { sets: 4, reps: '6–10', restSeconds: 120, rpe: 8 },
  }),
  exercise('aura_women_dumbbell_split_squat', 'Split_Squat_with_Dumbbells', {
    nameVi: 'Split Squat với tạ đơn', nameEn: 'Split Squat with Dumbbells', aliasesVi: ['Chùng chân tại chỗ'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Đùi trước', 'Mông'], secondaryMuscles: ['Đùi sau', 'Core'], equipment: ['Tạ đơn'], difficulty: 'beginner',
    instructionsVi: ['Đứng chân trước chân sau đủ rộng, cầm tạ dọc hai bên thân.', 'Giữ thân ổn định và hạ gối sau hướng xuống sàn.', 'Hạ đến khi chân trước chịu lực đều, gót chân không nhấc.', 'Đẩy qua bàn chân trước để trở lại vị trí ban đầu.'],
    cuesVi: ['Hai chân như đứng trên đường ray', 'Gối trước theo mũi chân', 'Lực chính ở chân trước'], commonMistakesVi: ['Hai chân đứng trên một đường gây mất thăng bằng', 'Bước quá ngắn', 'Dồn lực vào chân sau'],
    breathingVi: 'Hít khi hạ, thở khi đẩy người lên.', defaultPrescription: { sets: 3, reps: '8–12 mỗi bên', restSeconds: 60, rpe: 8 },
  }),
  exercise('aura_women_step_up_knee_raise', 'Step-up_with_Knee_Raise', {
    nameVi: 'Bước bục nâng gối', nameEn: 'Step-up with Knee Raise', aliasesVi: ['Step-up'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Mông', 'Đùi trước'], secondaryMuscles: ['Đùi sau', 'Core'], equipment: ['Bục tập'], difficulty: 'beginner', environment: ['home', 'gym'],
    instructionsVi: ['Đặt toàn bộ bàn chân làm việc lên bục có độ cao phù hợp.', 'Nghiêng thân nhẹ về trước và đẩy qua gót chân trên bục.', 'Đứng thẳng trên bục đồng thời nâng gối chân còn lại.', 'Giữ thăng bằng ngắn rồi hạ xuống chậm bằng chính chân làm việc.'],
    cuesVi: ['Không bật bằng chân dưới', 'Gối theo hướng mũi chân', 'Kiểm soát khi bước xuống'], commonMistakesVi: ['Chỉ đặt nửa bàn chân lên bục', 'Dùng chân dưới lấy đà', 'Bục quá cao làm lệch hông'],
    breathingVi: 'Thở ra khi bước lên, hít vào khi hạ xuống.', defaultPrescription: { sets: 3, reps: '10–12 mỗi bên', restSeconds: 60, rpe: 7 },
  }),
  exercise('aura_women_leg_press', 'Leg_Press', {
    nameVi: 'Đạp đùi máy', nameEn: 'Leg Press', aliasesVi: ['Leg Press'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Đùi trước', 'Mông'], secondaryMuscles: ['Đùi sau', 'Bắp chân'], equipment: ['Máy Leg Press'], difficulty: 'beginner',
    instructionsVi: ['Ngồi sát lưng ghế, đặt bàn chân rộng bằng hông trên bàn đạp.', 'Mở khóa an toàn và hạ bàn đạp bằng cách gập gối có kiểm soát.', 'Dừng trước khi xương chậu cuộn khỏi tựa lưng.', 'Đẩy đều cả bàn chân để duỗi gối, không khóa cứng khớp.'],
    cuesVi: ['Lưng và hông luôn áp ghế', 'Gối theo mũi chân', 'Không khóa cứng gối'], commonMistakesVi: ['Hạ quá sâu làm cuộn lưng', 'Gối đổ vào trong', 'Đẩy bằng mũi chân'],
    breathingVi: 'Hít khi hạ bàn đạp, thở khi đẩy lên.', defaultPrescription: { sets: 4, reps: '10–15', restSeconds: 90, rpe: 8 },
  }),
  exercise('aura_women_lying_leg_curl', 'Lying_Leg_Curls', {
    nameVi: 'Nằm gập đùi sau máy', nameEn: 'Lying Leg Curls', aliasesVi: ['Leg Curl nằm'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Đùi sau'], secondaryMuscles: ['Bắp chân'], equipment: ['Máy Leg Curl'], difficulty: 'beginner',
    instructionsVi: ['Chỉnh trục máy ngang khớp gối và đệm lăn nằm trên phần thấp cẳng chân.', 'Nằm áp hông xuống ghế, giữ tay cầm và siết nhẹ bụng.', 'Gập gối kéo đệm về phía mông trong biên độ không nhấc hông.', 'Siết đùi sau rồi duỗi chân về chậm, không để chồng tạ va nhau.'],
    cuesVi: ['Hông áp ghế', 'Kéo bằng đùi sau', 'Chiều về chậm hơn chiều kéo'], commonMistakesVi: ['Nhấc hông khỏi ghế', 'Dùng quán tính', 'Duỗi gối quá nhanh'],
    breathingVi: 'Thở khi gập gối, hít khi duỗi chân.', defaultPrescription: { sets: 3, reps: '10–15', restSeconds: 60, rpe: 8 },
  }),
  exercise('aura_women_leg_extension', 'Leg_Extensions', {
    nameVi: 'Duỗi đùi trước máy', nameEn: 'Leg Extensions', aliasesVi: ['Leg Extension'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Đùi trước'], secondaryMuscles: [], equipment: ['Máy Leg Extension'], difficulty: 'beginner',
    instructionsVi: ['Chỉnh trục máy ngang khớp gối, đệm lăn nằm trên cổ chân.', 'Ngồi áp lưng ghế, giữ tay cầm và siết bụng.', 'Duỗi gối đến gần thẳng chân, không khóa cứng khớp.', 'Siết đùi trước ngắn ở đỉnh rồi hạ tạ chậm về vị trí đầu.'],
    cuesVi: ['Gối thẳng trục máy', 'Hông không nhấc khỏi ghế', 'Kiểm soát chiều hạ'], commonMistakesVi: ['Dùng đà hất tạ', 'Khóa cứng gối', 'Chọn mức tạ làm mất kiểm soát'],
    breathingVi: 'Thở ra khi duỗi chân, hít vào khi hạ.', defaultPrescription: { sets: 3, reps: '12–15', restSeconds: 60, rpe: 8 },
  }),
  exercise('aura_women_walking_lunge', 'Bodyweight_Walking_Lunge', {
    nameVi: 'Walking Lunge', nameEn: 'Bodyweight Walking Lunge', aliasesVi: ['Chùng chân bước tới'], bodyParts: ['Thân dưới'],
    targetMuscles: ['Đùi trước', 'Mông'], secondaryMuscles: ['Đùi sau', 'Bắp chân', 'Core'], equipment: ['Trọng lượng cơ thể'], difficulty: 'beginner', environment: ['home', 'gym'],
    instructionsVi: ['Đứng thẳng, siết bụng và bước một bước vừa đủ về phía trước.', 'Hạ gối sau xuống gần sàn trong khi gối trước theo hướng mũi chân.', 'Đẩy qua bàn chân trước để đưa cơ thể tiến lên.', 'Tiếp tục đổi chân, giữ nhịp bước đều và thân người ổn định.'],
    cuesVi: ['Bước trên hai đường ray', 'Thân người cao và ổn định', 'Đẩy qua chân trước'], commonMistakesVi: ['Bước quá ngắn', 'Gối trước đổ vào trong', 'Lắc thân sang hai bên'],
    breathingVi: 'Hít khi hạ, thở khi đẩy người tiến lên.', defaultPrescription: { sets: 3, reps: '10–12 mỗi bên', restSeconds: 60, rpe: 7 },
  }),
  exercise('aura_women_wide_grip_lat_pulldown', 'Wide-Grip_Lat_Pulldown', {
    nameVi: 'Kéo xô tay rộng', nameEn: 'Wide-Grip Lat Pulldown', aliasesVi: ['Lat Pulldown'], bodyParts: ['Thân trên'],
    targetMuscles: ['Cơ xô'], secondaryMuscles: ['Lưng giữa', 'Tay trước', 'Vai sau'], equipment: ['Máy cáp', 'Thanh kéo xô'], difficulty: 'beginner',
    instructionsVi: ['Ngồi cố định đùi dưới đệm, nắm thanh rộng hơn vai vừa phải.', 'Nâng ngực nhẹ, hạ vai khỏi tai và giữ thân ổn định.', 'Kéo khuỷu tay xuống hai bên, đưa thanh về gần ngực trên.', 'Dừng ngắn rồi duỗi tay lên có kiểm soát để cơ xô được kéo dài.'],
    cuesVi: ['Kéo khuỷu tay xuống', 'Ngực mở, vai hạ', 'Không giật người ra sau'], commonMistakesVi: ['Kéo thanh sau gáy', 'Dùng quán tính', 'Chỉ kéo bằng tay trước'],
    breathingVi: 'Thở khi kéo thanh xuống, hít khi đưa thanh lên.', defaultPrescription: { sets: 3, reps: '10–12', restSeconds: 75, rpe: 8 },
  }),
  exercise('aura_women_seated_cable_row', 'Seated_Cable_Rows', {
    nameVi: 'Ngồi kéo cáp', nameEn: 'Seated Cable Rows', aliasesVi: ['Seated Row'], bodyParts: ['Thân trên'],
    targetMuscles: ['Lưng giữa'], secondaryMuscles: ['Cơ xô', 'Vai sau', 'Tay trước'], equipment: ['Máy cáp', 'Tay cầm chữ V'], difficulty: 'beginner',
    instructionsVi: ['Ngồi vững, hơi chùng gối và giữ cột sống trung lập.', 'Nắm tay cầm, mở ngực và kéo bả vai nhẹ về sau.', 'Kéo khuỷu tay sát thân cho tay cầm về gần bụng.', 'Dừng ngắn rồi duỗi tay về trước có kiểm soát, không gập lưng.'],
    cuesVi: ['Khuỷu tay đi sát thân', 'Ngực mở', 'Bả vai chuyển động trước cánh tay'], commonMistakesVi: ['Ngả người quá nhiều', 'Nhún vai', 'Giật cáp bằng lưng dưới'],
    breathingVi: 'Thở khi kéo về, hít khi duỗi tay.', defaultPrescription: { sets: 3, reps: '10–12', restSeconds: 75, rpe: 8 },
  }),
  exercise('aura_women_face_pull', 'Face_Pull', {
    nameVi: 'Face Pull với dây thừng', nameEn: 'Face Pull', aliasesVi: ['Kéo cáp về mặt'], bodyParts: ['Thân trên'],
    targetMuscles: ['Vai sau', 'Lưng trên'], secondaryMuscles: ['Cơ xoay vai'], equipment: ['Máy cáp', 'Dây thừng'], difficulty: 'intermediate',
    instructionsVi: ['Đặt cáp ngang mặt và nắm hai đầu dây bằng tay trung tính.', 'Lùi lại tạo căng cáp, giữ bụng chắc và vai hạ.', 'Kéo dây về hai bên mặt, đồng thời xoay bàn tay ra ngoài.', 'Siết vai sau rồi duỗi tay về chậm, giữ thân không đung đưa.'],
    cuesVi: ['Khuỷu tay mở ngang vai', 'Kéo dây tách sang hai bên', 'Vai tránh nhún lên'], commonMistakesVi: ['Chọn tạ quá nặng', 'Kéo dây xuống ngực', 'Ưỡn lưng để lấy đà'],
    breathingVi: 'Thở khi kéo dây về mặt, hít khi duỗi tay.', defaultPrescription: { sets: 3, reps: '12–15', restSeconds: 45, rpe: 7 },
  }),
  exercise('aura_women_dumbbell_shoulder_press', 'Dumbbell_Shoulder_Press', {
    nameVi: 'Đẩy vai tạ đơn', nameEn: 'Dumbbell Shoulder Press', aliasesVi: ['Shoulder Press'], bodyParts: ['Thân trên'],
    targetMuscles: ['Vai'], secondaryMuscles: ['Tay sau', 'Ngực trên'], equipment: ['Tạ đơn', 'Ghế tựa'], difficulty: 'intermediate',
    instructionsVi: ['Ngồi tựa ghế, đặt chân chắc trên sàn và đưa tạ lên ngang vai.', 'Siết bụng, giữ xương sườn không bật lên.', 'Đẩy tạ lên trên theo đường hơi hướng vào nhau.', 'Dừng trước khi khóa cứng khuỷu rồi hạ tạ chậm về ngang vai.'],
    cuesVi: ['Cổ dài, vai không nhún', 'Xương sườn khép', 'Cẳng tay gần thẳng đứng'], commonMistakesVi: ['Ưỡn lưng quá mức', 'Hạ khuỷu quá sâu', 'Đập hai tạ vào nhau'],
    breathingVi: 'Thở khi đẩy tạ lên, hít khi hạ xuống.', defaultPrescription: { sets: 3, reps: '8–12', restSeconds: 75, rpe: 8 },
  }),
  exercise('aura_women_incline_push_up', 'Incline_Push-Up', {
    nameVi: 'Chống đẩy trên bục cao', nameEn: 'Incline Push-Up', aliasesVi: ['Hít đất nâng cao tay'], bodyParts: ['Thân trên'],
    targetMuscles: ['Ngực'], secondaryMuscles: ['Vai', 'Tay sau', 'Core'], equipment: ['Ghế hoặc bục chắc'], difficulty: 'beginner', environment: ['home', 'gym'],
    instructionsVi: ['Đặt hai tay lên bục chắc rộng hơn vai nhẹ, bước chân ra sau.', 'Giữ cơ thể thành đường thẳng từ đầu đến gót và siết bụng.', 'Gập khuỷu khoảng 30–45 độ, hạ ngực về phía bục.', 'Đẩy bục ra xa để duỗi tay, giữ thân người liền khối.'],
    cuesVi: ['Thân người như tấm ván', 'Khuỷu không mở ngang', 'Ngực hướng vào giữa hai tay'], commonMistakesVi: ['Võng lưng', 'Cổ rướn về trước', 'Bục không ổn định'],
    breathingVi: 'Hít khi hạ ngực, thở khi đẩy lên.', defaultPrescription: { sets: 3, reps: '8–15', restSeconds: 60, rpe: 7 },
  }),
  exercise('aura_women_dead_bug', 'Dead_Bug', {
    nameVi: 'Dead Bug', nameEn: 'Dead Bug', aliasesVi: ['Bọ chết'], bodyParts: ['Core'],
    targetMuscles: ['Cơ bụng sâu'], secondaryMuscles: ['Gập hông'], equipment: ['Thảm tập'], difficulty: 'beginner', environment: ['home', 'gym'],
    instructionsVi: ['Nằm ngửa, nâng hông và gối 90 độ, hai tay hướng lên trần.', 'Thở ra, siết bụng để lưng dưới áp nhẹ xuống thảm.', 'Duỗi chậm một chân và tay đối diện mà không để lưng nhấc.', 'Thu về vị trí đầu rồi đổi bên, duy trì nhịp chậm.'],
    cuesVi: ['Lưng dưới giữ ổn định', 'Chuyển động chậm', 'Thở hết để siết bụng sâu'], commonMistakesVi: ['Duỗi quá xa làm võng lưng', 'Nín thở', 'Thực hiện quá nhanh'],
    breathingVi: 'Thở dài khi duỗi tay chân, hít khi trở về giữa.', defaultPrescription: { sets: 3, reps: '8–10 mỗi bên', restSeconds: 45, rpe: 6 },
  }),
  exercise('aura_women_pallof_press', 'Pallof_Press', {
    nameVi: 'Pallof Press', nameEn: 'Pallof Press', aliasesVi: ['Đẩy cáp chống xoay'], bodyParts: ['Core'],
    targetMuscles: ['Cơ bụng sâu', 'Cơ xiên'], secondaryMuscles: ['Vai', 'Mông'], equipment: ['Máy cáp hoặc dây kháng lực'], difficulty: 'beginner',
    instructionsVi: ['Đứng vuông góc với điểm neo, cầm tay cầm trước ngực.', 'Đứng vững, hơi chùng gối và siết mông cùng cơ bụng.', 'Đẩy hai tay thẳng ra trước mà không để thân xoay về phía cáp.', 'Giữ ngắn rồi kéo tay về ngực có kiểm soát.'],
    cuesVi: ['Hông và vai luôn hướng trước', 'Xương sườn chồng trên hông', 'Không để cáp kéo xoay người'], commonMistakesVi: ['Chọn tạ quá nặng', 'Xoay vai theo cáp', 'Khóa cứng gối'],
    breathingVi: 'Thở khi đẩy tay ra, hít khi thu về.', defaultPrescription: { sets: 3, reps: '10–12 mỗi bên', restSeconds: 45, rpe: 7 },
  }),
  exercise('aura_women_plank', 'Plank', {
    nameVi: 'Plank cẳng tay', nameEn: 'Plank', aliasesVi: ['Plank'], bodyParts: ['Core'],
    targetMuscles: ['Cơ bụng sâu'], secondaryMuscles: ['Vai', 'Mông'], equipment: ['Thảm tập'], difficulty: 'beginner', environment: ['home', 'gym'],
    instructionsVi: ['Chống hai cẳng tay dưới vai và duỗi chân ra sau.', 'Siết mông, đùi và bụng để tạo đường thẳng từ đầu đến gót.', 'Đẩy cẳng tay xuống sàn, giữ cổ trung lập và thở đều.', 'Dừng hiệp khi hông bắt đầu võng hoặc không giữ được kỹ thuật.'],
    cuesVi: ['Xương sườn khép', 'Siết mông', 'Đẩy sàn ra xa'], commonMistakesVi: ['Võng lưng', 'Nâng hông quá cao', 'Nín thở'],
    breathingVi: 'Hít thở ngắn và đều, mỗi lần thở ra siết bụng thêm.', defaultPrescription: { sets: 3, reps: '30–45 giây', restSeconds: 45, rpe: 7 },
  }),
]

function validateItems(items) {
  if (items.length !== 20) throw new Error(`Expected exactly 20 exercises, received ${items.length}.`)
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

function canonicalItems() {
  validateItems(ITEMS)
  return ITEMS.map((item) => ({ ...item, contentDigest: sha256(JSON.stringify(item)) }))
}

function parseArgs(confirmation = CONFIRMATION) {
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
    if (result.confirm !== confirmation) throw new Error('Apply confirmation is missing or incorrect.')
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
function firestoreResourceBase() { return `projects/${TARGET.projectId}/databases/${TARGET.databaseId}` }
async function requestJson(token, endpoint, options = {}) {
  const response = await fetch(`${firestoreBase()}${endpoint}`, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) } })
  const raw = await response.text()
  if (!response.ok) throw new Error(`Firestore request failed (${response.status}) at ${endpoint.split('?')[0]}.`)
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

async function loadExisting(token, items) {
  const documents = await Promise.all(items.map(async (item) => {
    const response = await fetch(`${firestoreBase()}/documents/exercises/${item.id}`, { headers: { Authorization: `Bearer ${token}` } })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Unable to inspect ${item.id} (${response.status}).`)
    return response.json()
  }))
  return new Map(documents.filter(Boolean).map((document) => [document.name.split('/').pop(), Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, decodeValue(value)]))]))
}

async function loadExistingRevisions(token, items) {
  const documents = await Promise.all(items.map(async (item) => {
    for (const revision of [3, 2, 1]) {
      const response = await fetch(`${firestoreBase()}/documents/exercises/${item.id}/revisions/${revision}`, { headers: { Authorization: `Bearer ${token}` } })
      if (response.status === 404) continue
      if (!response.ok) throw new Error(`Unable to inspect revision for ${item.id} (${response.status}).`)
      return response.json()
    }
    return null
  }))
  return new Map(documents.filter(Boolean).map((document) => {
    const segments = document.name.split('/')
    const exerciseId = segments[segments.length - 3]
    return [exerciseId, Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, decodeValue(value)]))]
  }))
}

async function createMissing(token, items, existing, release = RELEASE) {
  const writes = []
  for (const item of items) {
    if (existing.has(item.id)) continue
    const { id, ...fields } = item
    const documentName = `${firestoreResourceBase()}/documents/exercises/${id}`
    writes.push({ update: { name: documentName, fields: encodeFields(fields) }, currentDocument: { exists: false } })
    writes.push({ update: { name: `${documentName}/revisions/1`, fields: encodeFields({ ...fields, exerciseId: id, revisionType: 'catalog_import', createdBy: release }) }, currentDocument: { exists: false } })
  }
  if (writes.length) await requestJson(token, '/documents:batchWrite', { method: 'POST', body: JSON.stringify({ writes }) })
  return writes.length / 2
}

async function updateOwned(token, items, existing, release, previousRelease) {
  const writes = []
  for (const item of items) {
    const current = existing.get(item.id)
    if (!current || current.catalogRelease !== previousRelease) continue
    const { id, ...fields } = item
    const documentName = `${firestoreResourceBase()}/documents/exercises/${id}`
    const nextRevision = Math.max(2, Number(current.revision || 1) + 1)
    writes.push({ update: { name: documentName, fields: encodeFields(fields) }, currentDocument: { exists: true } })
    writes.push({ update: { name: `${documentName}/revisions/${nextRevision}`, fields: encodeFields({ ...fields, exerciseId: id, revision: nextRevision, revisionType: 'catalog_repair', createdBy: release }) }, currentDocument: { exists: false } })
  }
  if (writes.length) await requestJson(token, '/documents:batchWrite', { method: 'POST', body: JSON.stringify({ writes }) })
  return writes.length / 2
}

async function runCatalogImport({
  sourceItems = ITEMS,
  release = RELEASE,
  confirmation = CONFIRMATION,
  reportPath = REPORT,
  categories = { lowerBody: 12, upperBody: 5, core: 3 },
  validate = validateItems,
  allowOwnedUpdates = false,
  previousRelease = '',
} = {}) {
  const args = parseArgs(confirmation)
  validate(sourceItems)
  const items = sourceItems.map((item) => ({ ...item, contentDigest: sha256(JSON.stringify(item)) }))
  const planDigest = sha256(JSON.stringify(items))
  const report = { schemaVersion: 1, release, mode: args.mode, selectedCount: items.length, planDigest, writesPerformed: false, published: items.length }
  if (args.mode === 'dry-run') {
    report.categories = categories
  } else {
    const token = await accessToken()
    const metadata = await requestJson(token, '')
    if (metadata?.name !== `projects/${TARGET.projectId}/databases/${TARGET.databaseId}`) throw new Error('Connected database is not the approved target.')
    let existing = await loadExisting(token, items)
    const conflictingIds = items
      .filter((item) => existing.has(item.id) && existing.get(item.id).contentDigest !== item.contentDigest)
      .map((item) => item.id)
    report.existing = items.filter((item) => existing.has(item.id)).length
    report.conflictingIds = conflictingIds
    if (args.mode === 'apply') {
      if (args.digest !== planDigest) throw new Error('Live plan digest no longer matches the approved dry run.')
      const ownedConflicts = allowOwnedUpdates && previousRelease
        ? conflictingIds.filter((id) => existing.get(id)?.catalogRelease === previousRelease)
        : []
      const unownedConflicts = conflictingIds.filter((id) => !ownedConflicts.includes(id))
      if (unownedConflicts.length) throw new Error(`Refusing to overwrite existing exercise documents: ${unownedConflicts.join(', ')}.`)
      report.created = await createMissing(token, items, existing, release)
      report.skippedExact = items.length - report.created
      report.updatedOwned = await updateOwned(token, items.filter((item) => ownedConflicts.includes(item.id)), existing, release, previousRelease)
      report.writesPerformed = report.created > 0 || report.updatedOwned > 0
      existing = await loadExisting(token, items)
    }
    report.present = items.filter((item) => existing.get(item.id)?.contentDigest === item.contentDigest && existing.get(item.id)?.status === 'published').length
    report.missingOrDifferent = items.length - report.present
    const revisions = await loadExistingRevisions(token, items)
    report.presentRevisions = items.filter((item) => revisions.get(item.id)?.contentDigest === item.contentDigest && revisions.get(item.id)?.exerciseId === item.id).length
    report.missingOrDifferentRevisions = items.length - report.presentRevisions
    if (report.missingOrDifferent || report.missingOrDifferentRevisions) process.exitCode = 2
  }
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
}

if (require.main === module) runCatalogImport().catch((error) => { console.error(error.message); process.exitCode = 1 })
module.exports = { ITEMS, RELEASE, canonicalItems, runCatalogImport, validateItems }
