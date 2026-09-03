import type { Schedule, ScheduleConfig, SchedulerResult, Session, Student, StudentContract, Trainer } from '../types'
import { generateSchedule } from '../utils/scheduler'

type ScheduleWorkerRequest = {
  students: Student[]
  trainers: Trainer[]
  contracts: StudentContract[]
  sessions: Session[]
  config: ScheduleConfig
  existingSchedule: Schedule
  overriddenSessions: Record<string, number>
  targetDate: Date
}

type ScheduleWorkerResponse =
  | { ok: true; result: SchedulerResult }
  | { ok: false; message: string }

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ScheduleWorkerRequest>) => void) | null
  postMessage: (message: ScheduleWorkerResponse) => void
}

workerScope.onmessage = (event) => {
  try {
    const request = event.data
    const result = generateSchedule(
      request.students,
      request.trainers,
      request.contracts,
      request.sessions,
      request.config,
      request.existingSchedule,
      request.overriddenSessions,
      new Date(request.targetDate),
    )
    workerScope.postMessage({ ok: true, result })
  } catch (error) {
    workerScope.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : 'Không thể xử lý dữ liệu xếp lịch.',
    })
  }
}

export {}
