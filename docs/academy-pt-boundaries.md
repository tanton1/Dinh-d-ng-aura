# Ranh giới dữ liệu Aura Academy và PT Coaching

## Mục tiêu

Aura Academy và PT Coaching dùng chung tài khoản Firebase, nhưng không dùng chung
quyền truy cập, tiến độ hay bằng chứng hoàn thành. Việc tham gia khóa học không
tạo quan hệ coaching; việc hoàn thành buổi PT cũng không tự hoàn thành bài học.

## Ownership theo domain

| Domain | Collections chính | Chủ thể cấp quyền |
| --- | --- | --- |
| Academy | `courses`, `enrollments`, `users/{uid}/progress`, `users/{uid}/quizAttempts`, `users/{uid}/academyNotes`, `users/{uid}/academyReviewItems` | enrollment + membership + drip schedule |
| PT Coaching | `coachClients`, `programAssignmentCycles`, `coachingPrograms`, `coachingPrograms/{id}/versions`, `coachClients/{uid}/scheduleEvents`, `users/{uid}/coachingWorkoutLogs` | active coach-client relationship + pinned assignment cycle |

Các collection `quizAttemptCounters` và `courseLessonProofs` là server-only.
Client không được tạo bằng chứng đạt quiz hoặc hoàn thành bài học.

## Luồng Academy

1. Học viên ghi danh qua `enrollInCourse`.
2. Quiz được chấm qua `gradeCourseQuiz`; answer key ở
   `courses/{courseId}/quizKeys/{lessonId}`.
3. Khi đạt quiz, server tạo `courseLessonProofs`.
4. `completeCourseLesson` chỉ hoàn thành bài quiz khi proof khớp quiz và content
   hash hiện tại.
5. Notes và review queue thuộc riêng học viên, chỉ ghi khi enrollment còn active
   hoặc completed.

Course V2 mới không nên tạo `workoutRef` hay completion mode
`workout-complete`. Editor Academy sẽ chuẩn hóa chúng về nội dung Academy.

## Luồng PT Coaching

1. Tạo `coachClients/{clientUid}` ở trạng thái `onboarding`.
2. Coach/Admin xác nhận quan hệ và chuyển `coachingStatus` thành `active`.
3. Coach tạo metadata tại `coachingPrograms/{programId}` và snapshot bất biến
   tại `versions/{versionId}`.
4. Callable server ghi nguyên tử `currentProgramId`, `currentVersionId`,
   `activeAssignmentCycleId` và một document mới trong
   `programAssignmentCycles`. Đổi program, đổi version hoặc bắt đầu lại luôn tạo
   cycle mới; pause/resume giữ nguyên cycle. `programAssignments` chỉ còn là
   projection legacy trong giai đoạn dual-read.
5. Client gọi `getPtWorkoutSession({ programId, versionId, sessionId })`.
6. Callable xác minh relationship, current program/version và chỉ trả đúng
   session đã được gán.
   Khi lịch chưa có session ID, `getPtAssignedWorkout({ sessionId? })` tự resolve
   current program/version và chọn buổi chưa hoàn thành kế tiếp theo thứ tự
   tuần/ngày.
7. Nhật ký PT mới dùng `users/{uid}/coachingWorkoutLogs`, chỉ được callable ghi
   sau khi xác minh session, cycle hiện tại và đủ số hiệp
   (`verificationVersion: 2`, `assignmentCycleId`). Tiến độ được tính riêng theo
   cycle, nên việc chạy lại cùng program/version không kế thừa các buổi đã hoàn
   thành ở cycle trước. Collection này không bao giờ được
   `completeCourseLesson` dùng làm proof Academy.
8. Lịch cloud nằm tại `coachClients/{clientUid}/scheduleEvents`. Toàn bộ thao tác
   đọc và ghi đi qua callable; Firestore client không được đọc/ghi trực tiếp.
   Học viên chỉ xem lịch của mình và chuyển event `planned` sang `done`/`skipped`.
   Coach hiện tại hoặc Admin tạo/sửa/hủy mềm qua callable.
   Khách paused/completed chỉ được hủy event cũ. Mỗi update hỗ trợ
   `expectedUpdatedAt` để phát hiện xung đột giữa nhiều thiết bị.

`getPtWorkoutSession` không nhận `courseId` hoặc `lessonId`, vì vậy UI PT không
thể vô tình tạo coupling ngược vào Academy.

## Tương thích legacy

- `programs`, `programs/{id}/versions`, `getCourseWorkoutSession` và
  `saveCourseWorkoutLog` tiếp tục tồn tại để các khóa học cũ chạy trong giai đoạn
  migration.
- Không tạo thêm liên kết course-workout mới.
- `completeCourseLesson` tiếp tục fail-closed với lesson legacy có
  `workout-complete`: cần workout log server-verified khớp đủ course, lesson,
  program, version và session.
- Script migration chỉ sao chép dữ liệu; không xóa hay sửa `programs` legacy.
- `programAssignments` không bị xóa. Functions ưu tiên
  `programAssignmentCycles`, nhưng vẫn resolve ID legacy ổn định khi hồ sơ chưa
  backfill.

## Migration

Chạy dry-run trước:

```powershell
cd functions
node scripts/migrate-programs-to-pt.js --coach-id=<UID_COACH>
```

Sau khi kiểm tra, thêm `--apply`. Có thể giới hạn bằng
`--program-id=<PROGRAM_ID>`. Script không tự tạo `coachClients` hoặc gắn current
program/version; bước đó cần quyết định nghiệp vụ và sự đồng ý của client.

Backfill assignment cycle phải chạy dry-run riêng:

```powershell
cd functions
node scripts/backfill-pt-assignment-cycles.js
```

Sau khi đối chiếu số lượng `eligible/planned/skipped`, mới thêm `--apply`. Có thể
giới hạn bằng `--client-id=<CLIENT_UID>`. Script dùng ID
`legacy_<sha256(clientId, programId, versionId)>`, chạy lặp lại không tạo bản
trùng, không xóa legacy assignment hoặc workout log. Vì schema cũ từng ghi đè
các lần gán cùng program, cycle backfill được đánh dấu
`historyCompleteness: legacy-collapsed`; không được trình bày như lịch sử đầy đủ.

Thứ tự rollout:

1. Deploy indexes, rules và Functions.
2. Tạo/kiểm tra coach-client relationship.
3. Dry-run rồi copy program/version.
4. Gắn current program/version cho từng client đã active.
5. Deploy Functions dual-read rồi dry-run/apply assignment-cycle backfill.
6. Chuyển UI PT sang cycle và schedule callables mới.
7. Theo dõi legacy callables trước khi quyết định ngừng hỗ trợ.

## Rủi ro còn lại

- Firestore rules không kiểm tra chi tiết từng phần tử trong map session; callable
  vẫn phải validate session trước khi trả về.
- Coach owner có thể chuyển onboarding thành active để khớp workflow hiện tại.
  Vì chưa có bước client chấp thuận lời mời, chỉ cấp role coach cho nhân sự tin
  cậy và bổ sung consent workflow trước khi mở hệ thống cho đối tác ngoài.
- Quyền staff được tách: editor chỉ quản lý Academy; coach chỉ quản lý PT.
  Admin/super-admin có cả hai phạm vi.
- Direct-write coaching logs là dữ liệu tự khai báo và không được dùng cho
  entitlement hoặc Academy completion.
- `coachNotes` hiện là ghi chú chia sẻ với khách và được gắn nhãn rõ trên UI.
  Nếu cần ghi chú nội bộ, phải dùng subcollection server/coach-only riêng trước
  khi nhập dữ liệu nhạy cảm.
- Chỉ xóa legacy callable sau khi không còn course chứa `workoutRef`.
- Không thể tái tạo chính xác ranh giới các cycle đã bị schema deterministic cũ
  ghi đè. Giữ nhãn `legacy-collapsed`; nếu PT muốn bắt đầu sạch tiến độ, hãy tạo
  cycle mới thay vì sửa hoặc đoán lại workout log lịch sử.
