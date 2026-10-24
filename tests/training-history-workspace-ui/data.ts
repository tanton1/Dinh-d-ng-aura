const fixture = () => (window as any).historyFixture
const trainers = [{ id: 'trainer-1', name: 'PT An', phone: '0901111111', status: 'active' }]
const acquireTrainingHistoryTrainerDirectory = () => {
  fixture().acquisitions++
  return () => { fixture().releases++ }
}
export const useDatabase = () => ({ trainers, operationsSync: { status: 'ready' }, acquireTrainingHistoryTrainerDirectory })
const student = (id: string, name: string, email = '') => ({ studentId: id, name, phone: '', email, status: 'active' })
export const listStudent360Directory = async (input: any) => {
  fixture().directory.push(input)
  if (input.query === 'cần tải tiếp' && !input.cursor) return { rows: [], hasMore: true, nextCursor: 'next-page', truncated: true }
  if (input.query === 'chậm') return new Promise((resolve) => {
    fixture().releaseSlow = () => resolve({ rows: [student('slow', 'Kết quả cũ')], hasMore: false, nextCursor: null })
  })
  if (input.query) return { rows: [student('email-student', 'Minh Nguyệt', 'nguyet@example.com')], hasMore: false, nextCursor: null }
  if (input.cursor) return { rows: [student('student-1', 'Học viên An'), student('student-3', 'Học viên Chi')], hasMore: false, nextCursor: null }
  return { rows: [student('student-1', 'Học viên An'), student('student-2', 'Học viên Bình')], hasMore: true, nextCursor: 'next-page' }
}
