import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { collection, doc, setDoc, deleteDoc, runTransaction, updateDoc, onSnapshot, query, where, orderBy, limit } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from './AuthContext'
import type {
  Student,
  StudentContract,
  PaymentRecord,
  Session,
  Trainer,
  Branch,
  TrainingPackage,
  StaffMember,
  DailyCheckin,
  Schedule,
  Warning,
  ScheduleEntry,
  LeaveRequest,
  ScheduleConfig,
  WorkoutLog,
  SessionRequest,
} from '../types/ptOperations'

type OperationsSyncStatus = 'idle' | 'loading' | 'ready' | 'forbidden' | 'error'

interface OperationsSyncState {
  status: OperationsSyncStatus
  lastSyncedAt: string | null
  error: string | null
}

const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = {
  workingDays: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7'],
  workingHours: [6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 19, 20],
  lockDayOfWeek: 6,
  lockHour: 12,
  complimentaryChangeCancelPerMonth: 1,
  sessionChangeDeadlineHours: 12,
  offMaxDaysPerRequest: 14,
  offRegistrationCutoffHour: 10,
  offLimitsByDuration: { threeMonths: 1, sixMonths: 3, twelveMonths: 6 },
}

// Deterministic browser-layout fixtures only. Production starts empty and
// receives canonical operations data exclusively from Firestore.
const E2E_PT_BRANCHES: Branch[] = import.meta.env.MODE === 'e2e'
  ? [{ id: 'e2e-branch', name: 'Aura Test', address: 'Đà Nẵng', status: 'active' }]
  : []
const E2E_PT_TRAINERS: Trainer[] = import.meta.env.MODE === 'e2e'
  ? [{ id: 'e2e-trainer', name: 'PT Aura', branchId: 'e2e-branch', commissionRate: 0, status: 'active', slotCapacity: 2 }]
  : []
const E2E_PT_STUDENTS: Student[] = import.meta.env.MODE === 'e2e'
  ? [{ id: 'e2e-student', name: 'Học viên Aura', phone: '0900000000', email: 'student@aura.test', sessionsPerWeek: 3, availableSlots: [], status: 'active', branchId: 'e2e-branch' }]
  : []
const E2E_PT_PACKAGES: TrainingPackage[] = import.meta.env.MODE === 'e2e'
  ? [{ id: 'e2e-package', name: 'Gói PT Aura', totalSessions: 24, price: 12_000_000, durationMonths: 3, branchId: 'e2e-branch' }]
  : []
const E2E_PT_SESSIONS: Session[] = import.meta.env.MODE === 'e2e'
  ? [{ id: 'e2e-session', trainerId: 'e2e-trainer', studentId: 'e2e-student', contractId: 'e2e-contract', date: '2026-08-01', hour: 8, status: 'completed', branchId: 'e2e-branch' }]
  : []

export interface ScheduleDocumentState {
  schedule: Schedule
  warnings: Warning[]
  overriddenSessions?: Record<string, number>
  draftRevision?: number
  publishedVersions?: Record<string, number>
  publishedRevisions?: Record<string, number>
  publishStatusByBranch?: Record<string, 'draft' | 'published'>
}

export interface PtAvailabilityDocument {
  id: string
  studentId: string
  weekId: string
  slots: string[]
  requiredSessions: number
  minimumSlots: number
  status: 'draft' | 'submitted' | 'locked'
  revision: number
}

type LegacyOperationSource =
  | 'students' | 'contracts' | 'sessions' | 'payments'
  | 'leaveRequests' | 'workoutLogs' | 'sessionRequests'
  | 'scheduleConfig' | 'trainers' | 'branches' | 'packages'
  | 'staff' | 'dailyCheckins' | 'schedules' | 'ptAvailability'

// Transitional legacy views must not all subscribe to the same 15 data
// sources. Keep each surface on the smallest set its current components use;
// actor-scoped paginated APIs will replace these remaining listeners.
const LEGACY_OPERATIONS_VIEW_SOURCES = {
  'admin-pt-students': ['students', 'contracts', 'payments', 'packages', 'trainers', 'branches', 'sessions', 'leaveRequests', 'sessionRequests', 'dailyCheckins', 'workoutLogs', 'ptAvailability'],
  'admin-pt-schedule': ['students', 'trainers', 'branches', 'contracts', 'sessions', 'schedules', 'scheduleConfig', 'ptAvailability', 'leaveRequests', 'sessionRequests'],
  // The history workspace resolves the selected subject locally, while all
  // historical sessions are fetched cursor-first from a callable API.
  'admin-training-history': ['students', 'trainers'],
  // The report dashboard uses one bounded aggregate callable. It must not also
  // subscribe to thousands of PT legacy documents in the background.
  'admin-finance': ['branches', 'contracts', 'students'],
  // Nhân sự & Chi nhánh now renders the identity workspace. It only needs
  // branch labels for scoped assignment; PT legacy history is not loaded here.
  'admin-hr': ['branches', 'scheduleConfig'],
  // Payroll details are immutable server snapshots. Loading every student,
  // contract and session here both duplicated the callable and made the page
  // unnecessarily slow on mobile.
  'admin-payroll': ['trainers', 'branches'],
  'admin-packages': ['packages', 'branches'],
  'admin-quotes': ['students', 'contracts', 'packages', 'branches'],
  'admin-schedule-settings': ['scheduleConfig'],
  // Identity v2 assignment editor only needs branch labels; it must not
  // revive the former whole-operations listener set on the roles route.
  'admin-roles': ['branches', 'scheduleConfig'],
} as const satisfies Record<string, readonly LegacyOperationSource[]>

type LegacyOperationsView = keyof typeof LEGACY_OPERATIONS_VIEW_SOURCES

function currentLegacyOperationsView(): LegacyOperationsView | null {
  if (typeof window === 'undefined') return null
  const view = window.location.hash.replace(/^#\/?/, '').split('?')[0]
  return Object.prototype.hasOwnProperty.call(LEGACY_OPERATIONS_VIEW_SOURCES, view)
    ? view as LegacyOperationsView
    : null
}

interface DatabaseContextType {
  students: Student[]
  contracts: StudentContract[]
  payments: PaymentRecord[]
  sessions: Session[]
  trainers: Trainer[]
  branches: Branch[]
  packages: TrainingPackage[]
  staff: StaffMember[]
  dailyCheckins: DailyCheckin[]
  workoutLogs: WorkoutLog[]
  leaveRequests: LeaveRequest[]
  sessionRequests: SessionRequest[]
  schedules: { [weekId: string]: ScheduleDocumentState }
  ptAvailability: PtAvailabilityDocument[]
  scheduleConfig: ScheduleConfig
  operationsSync: OperationsSyncState
  
  addStudent: (student: Student) => Promise<void>
  updateStudent: (id: string, updates: Partial<Student>) => Promise<void>
  deleteStudent: (id: string) => Promise<void>
  
  addContract: (contract: StudentContract) => Promise<void>
  updateContract: (contract: StudentContract) => Promise<void>
  deleteContract: (id: string) => Promise<void>
  
  addPayment: (payment: PaymentRecord) => Promise<void>
  deletePayment: (id: string) => Promise<void>
  
  addSession: (session: Session) => Promise<void>
  updateSession: (session: Session) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  
  addTrainer: (trainer: Trainer) => Promise<void>
  updateTrainer: (trainer: Trainer) => Promise<void>
  deleteTrainer: (id: string) => Promise<void>
  
  addBranch: (branch: Branch) => Promise<void>
  updateBranch: (branch: Branch) => Promise<void>
  deleteBranch: (id: string) => Promise<void>
  
  addPackage: (pkg: TrainingPackage) => Promise<void>
  updatePackage: (pkg: TrainingPackage) => Promise<void>
  deletePackage: (id: string) => Promise<void>
  
  addStaff: (staffMember: StaffMember) => Promise<void>
  updateStaff: (staffMember: StaffMember) => Promise<void>
  deleteStaff: (id: string) => Promise<void>
  
  addDailyCheckin: (checkin: DailyCheckin) => Promise<void>
  updateDailyCheckin: (checkin: DailyCheckin) => Promise<void>
  deleteDailyCheckin: (id: string) => Promise<void>

  addWorkoutLog: (log: WorkoutLog) => Promise<void>
  updateWorkoutLog: (log: WorkoutLog) => Promise<void>
  deleteWorkoutLog: (id: string) => Promise<void>

  addLeaveRequest: (request: LeaveRequest) => Promise<void>
  updateLeaveRequest: (request: LeaveRequest) => Promise<void>
  deleteLeaveRequest: (id: string) => Promise<void>
  
  addSessionRequest: (request: SessionRequest) => Promise<void>
  updateSessionRequest: (request: SessionRequest) => Promise<void>
  deleteSessionRequest: (id: string) => Promise<void>

  updateScheduleData: (weekId: string, schedule: Schedule, warnings: Warning[]) => Promise<void>
  updateScheduleSlot: (weekId: string, slotId: string, updater: (currentEntries: ScheduleEntry[]) => ScheduleEntry[]) => Promise<void>
  updateScheduleSlots: (weekId: string, updater: (currentSchedule: Schedule) => { [slotId: string]: ScheduleEntry[] }) => Promise<void>
  updateSessionOverrides: (weekId: string, studentId: string, sessions: number) => Promise<void>
  updateBulkSessionOverrides: (weekId: string, overrides: Record<string, number>) => Promise<void>
  updateScheduleConfig: (config: ScheduleConfig) => Promise<void>
  updateUserProfile: (uid: string, data: any) => Promise<void>
  
  refreshData: () => Promise<void>
  
  migrateData: () => Promise<void>
  isMigrating: boolean
  isMigrated: boolean
}

const DatabaseContext = createContext<DatabaseContextType | null>(null)

export const useDatabase = () => {
  const context = useContext(DatabaseContext)
  if (!context) throw new Error('useDatabase must be used within a DatabaseProvider')
  return context
}

export const DatabaseProvider = ({ children }: { children: ReactNode }) => {
  const {
    user: authenticatedUser,
    role: authenticatedRole,
    accessContext,
    authzReady,
  } = useAuth()
  const [students, setStudents] = useState<Student[]>(E2E_PT_STUDENTS)
  const [contracts, setContracts] = useState<StudentContract[]>([])
  const [payments, setPayments] = useState<PaymentRecord[]>([])
  const [sessions, setSessions] = useState<Session[]>(E2E_PT_SESSIONS)
  const [trainers, setTrainers] = useState<Trainer[]>(E2E_PT_TRAINERS)
  const [branches, setBranches] = useState<Branch[]>(E2E_PT_BRANCHES)
  const [packages, setPackages] = useState<TrainingPackage[]>(E2E_PT_PACKAGES)
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [dailyCheckins, setDailyCheckins] = useState<DailyCheckin[]>([])
  const [workoutLogs, setWorkoutLogs] = useState<WorkoutLog[]>([])
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([])
  const [sessionRequests, setSessionRequests] = useState<SessionRequest[]>([])
  const [schedules, setSchedules] = useState<{ [weekId: string]: ScheduleDocumentState }>({})
  const [ptAvailability, setPtAvailability] = useState<PtAvailabilityDocument[]>([])
  const [scheduleConfig, setScheduleConfig] = useState<ScheduleConfig>(DEFAULT_SCHEDULE_CONFIG)
  const [isMigrating] = useState(false)
  const [isMigrated, setIsMigrated] = useState(false)
  const [canUseLegacyOperations, setCanUseLegacyOperations] = useState(false)
  const [operationsView, setOperationsView] = useState<LegacyOperationsView | null>(currentLegacyOperationsView)
  const [operationsSync, setOperationsSync] = useState<OperationsSyncState>({
    status: 'idle',
    lastSyncedAt: null,
    error: null,
  })

  const refreshData = async () => {}

  const clearLegacyOperationsData = () => {
    setStudents(E2E_PT_STUDENTS)
    setContracts([])
    setPayments([])
    setSessions(E2E_PT_SESSIONS)
    setTrainers(E2E_PT_TRAINERS)
    setBranches(E2E_PT_BRANCHES)
    setPackages(E2E_PT_PACKAGES)
    setStaff([])
    setDailyCheckins([])
    setWorkoutLogs([])
    setLeaveRequests([])
    setSessionRequests([])
    setSchedules({})
    setPtAvailability([])
    setScheduleConfig(DEFAULT_SCHEDULE_CONFIG)
    setIsMigrated(false)
  }

  useEffect(() => {
    const updateRouteScope = () => setOperationsView(currentLegacyOperationsView())
    window.addEventListener('hashchange', updateRouteScope)
    window.addEventListener('popstate', updateRouteScope)
    return () => {
      window.removeEventListener('hashchange', updateRouteScope)
      window.removeEventListener('popstate', updateRouteScope)
    }
  }, [])

  useEffect(() => {
    if (import.meta.env.MODE === 'e2e') {
      setCanUseLegacyOperations(true)
      setOperationsSync({ status: 'ready', lastSyncedAt: new Date().toISOString(), error: null })
      return
    }

    if (!authenticatedUser) {
      setCanUseLegacyOperations(false)
      clearLegacyOperationsData()
      setOperationsSync({ status: 'idle', lastSyncedAt: null, error: null })
      return
    }

    if (!authzReady) {
      setCanUseLegacyOperations(false)
      setOperationsSync({
        status: operationsView ? 'loading' : 'idle',
        lastSyncedAt: null,
        error: null,
      })
      return
    }

    const accessRole = accessContext?.accessRole ?? ''
    const canUse = accessRole === 'admin' || accessRole === 'super_admin'
      || authenticatedRole === 'admin' || authenticatedRole === 'super_admin'
    setCanUseLegacyOperations(canUse)
    if (!canUse) clearLegacyOperationsData()
    setOperationsSync({
      status: canUse && operationsView ? 'loading' : canUse ? 'idle' : 'forbidden',
      lastSyncedAt: null,
      error: canUse ? null : 'Tài khoản này không có quyền truy cập dữ liệu vận hành.',
    })
  }, [accessContext?.accessRole, authenticatedRole, authenticatedUser?.uid, authzReady, operationsView])

  useEffect(() => {
    // Browser layout tests use deterministic, non-sensitive PT fixtures. Do
    // not replace them with an empty emulator snapshot while a form is open.
    if (import.meta.env.MODE === 'e2e') {
      setOperationsSync({ status: 'ready', lastSyncedAt: new Date().toISOString(), error: null })
      return
    }
    if (!canUseLegacyOperations || !operationsView || !db) {
      if (!operationsView) {
        clearLegacyOperationsData()
        if (canUseLegacyOperations) setOperationsSync({ status: 'idle', lastSyncedAt: null, error: null })
      }
      return
    }

    // A route change must never leave stale data from a broader legacy view in
    // memory while the new, narrower subscriptions are loading.
    clearLegacyOperationsData()
    setOperationsSync({ status: 'loading', lastSyncedAt: null, error: null })
    
    const unsubs: (() => void)[] = []
    const activeSources = new Set<LegacyOperationSource>(LEGACY_OPERATIONS_VIEW_SOURCES[operationsView])
    const expectedInitialSnapshots = new Set<LegacyOperationSource>(activeSources)
    const receivedInitialSnapshots = new Set<LegacyOperationSource>()
    const markReady = (source: LegacyOperationSource) => {
      receivedInitialSnapshots.add(source)
      if (receivedInitialSnapshots.size === expectedInitialSnapshots.size) {
        setOperationsSync({ status: 'ready', lastSyncedAt: new Date().toISOString(), error: null })
      }
    }
    const listenerError = (source: string, error: unknown) => {
      const code = typeof error === 'object' && error && 'code' in error
        ? String((error as { code?: unknown }).code || '')
        : ''
      const message = code === 'permission-denied'
        ? 'Firestore đang từ chối quyền đọc dữ liệu vận hành. Hãy đăng xuất và đăng nhập lại tài khoản admin.'
        : `Không thể đồng bộ ${source}.`
      setOperationsSync({ status: 'error', lastSyncedAt: null, error: message })
      console.warn(`${source} listener error`, error)
    }

    const withDocumentId = <T extends { id: string }>(snapshot: { id: string; data: () => unknown }): T => ({
      ...(snapshot.data() as Omit<T, 'id'>),
      id: snapshot.id,
    }) as T

    try {
      if (activeSources.has('students')) unsubs.push(onSnapshot(collection(db, 'students'), (snapshot) => {
        setStudents(snapshot.docs.map(document => withDocumentId<Student>(document)))
        markReady('students')
      }, (err) => listenerError('students', err)))

      if (activeSources.has('contracts')) unsubs.push(onSnapshot(collection(db, 'contracts'), (snapshot) => {
        setContracts(snapshot.docs.map(document => withDocumentId<StudentContract>(document)))
        markReady('contracts')
      }, (err) => listenerError('contracts', err)))

      // Transitional legacy adapter: never open a realtime listener over all
      // 9k+ historical sessions. Pages that need older history must use a
      // cursor API; the shared context carries only the operational window.
      const sessionWindowStart = new Date()
      sessionWindowStart.setDate(sessionWindowStart.getDate() - 180)
      const sessionsQuery = query(
        collection(db, 'sessions'),
        where('date', '>=', sessionWindowStart.toISOString().slice(0, 10)),
        orderBy('date', 'asc'),
        limit(3000),
      )
      const availabilityStart = new Date()
      const availabilityWeekday = availabilityStart.getDay()
      availabilityStart.setDate(availabilityStart.getDate() - (availabilityWeekday === 0 ? 6 : availabilityWeekday - 1))
      const availabilityQuery = query(
        collection(db, 'ptAvailability'),
        where('weekId', '>=', availabilityStart.toISOString().slice(0, 10)),
        orderBy('weekId', 'asc'),
        limit(1000),
      )
      if (activeSources.has('sessions')) unsubs.push(onSnapshot(sessionsQuery, (snapshot) => {
        const parsedSessions = snapshot.docs.map(document => {
          const data = withDocumentId<Session>(document)
          if (data.hour === undefined && data.id) {
            const parts = data.id.split('-')
            if (parts.length >= 2) {
              const parsedHour = parseInt(parts[1], 10)
              if (!isNaN(parsedHour)) {
                data.hour = parsedHour
              }
            }
          }
          return data
        })
        setSessions(parsedSessions)
        markReady('sessions')
      }, (err) => listenerError('sessions', err)))

      if (activeSources.has('payments')) unsubs.push(onSnapshot(collection(db, 'payments'), (snapshot) => {
        setPayments(snapshot.docs.map(document => withDocumentId<PaymentRecord>(document)))
        markReady('payments')
      }, (err) => listenerError('payments', err)))

      if (activeSources.has('leaveRequests')) unsubs.push(onSnapshot(collection(db, 'leaveRequests'), (snapshot) => {
        setLeaveRequests(snapshot.docs.map(document => withDocumentId<LeaveRequest>(document)))
        markReady('leaveRequests')
      }, (err) => listenerError('leaveRequests', err)))

      if (activeSources.has('workoutLogs')) unsubs.push(onSnapshot(collection(db, 'workoutLogs'), (snapshot) => {
        setWorkoutLogs(snapshot.docs.map(document => withDocumentId<WorkoutLog>(document)))
        markReady('workoutLogs')
      }, (err) => listenerError('workoutLogs', err)))

      if (activeSources.has('sessionRequests')) unsubs.push(onSnapshot(collection(db, 'sessionRequests'), (snapshot) => {
        setSessionRequests(snapshot.docs.map(document => withDocumentId<SessionRequest>(document)))
        markReady('sessionRequests')
      }, (err) => listenerError('sessionRequests', err)))

      if (activeSources.has('scheduleConfig')) unsubs.push(onSnapshot(doc(db, 'settings', 'scheduleConfig'), (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data() as Partial<ScheduleConfig>
          setScheduleConfig(prev => ({
            ...prev,
            ...data
          }))
        }
        markReady('scheduleConfig')
      }, (err) => listenerError('scheduleConfig', err)))

      if (activeSources.has('trainers')) unsubs.push(onSnapshot(collection(db, 'trainers'), (snapshot) => {
        setTrainers(snapshot.docs.map(document => withDocumentId<Trainer>(document)))
        markReady('trainers')
      }, (err) => listenerError('trainers', err)))

      if (activeSources.has('branches')) unsubs.push(onSnapshot(collection(db, 'branches'), (snapshot) => {
        setBranches(snapshot.docs.map(document => withDocumentId<Branch>(document)))
        markReady('branches')
      }, (err) => listenerError('branches', err)))

      if (activeSources.has('packages')) unsubs.push(onSnapshot(collection(db, 'packages'), (snapshot) => {
        setPackages(snapshot.docs.map(document => withDocumentId<TrainingPackage>(document)))
        markReady('packages')
      }, (err) => listenerError('packages', err)))

      if (activeSources.has('staff')) unsubs.push(onSnapshot(collection(db, 'staff'), (snapshot) => {
        setStaff(snapshot.docs.map(document => withDocumentId<StaffMember>(document)))
        markReady('staff')
      }, (err) => listenerError('staff', err)))

      if (activeSources.has('dailyCheckins')) unsubs.push(onSnapshot(collection(db, 'dailyCheckins'), (snapshot) => {
        setDailyCheckins(snapshot.docs.map(document => withDocumentId<DailyCheckin>(document)))
        markReady('dailyCheckins')
      }, (err) => listenerError('dailyCheckins', err)))

      if (activeSources.has('schedules')) unsubs.push(onSnapshot(collection(db, 'schedules'), (snapshot) => {
        const newSchedules: { [weekId: string]: ScheduleDocumentState } = {}
        snapshot.docs.forEach(docSnap => {
          if (docSnap.id === 'global_schedule') return
          const data = docSnap.data()
          newSchedules[docSnap.id] = {
            schedule: data.schedule || {},
            warnings: data.warnings || [],
            overriddenSessions: data.overriddenSessions || {},
            draftRevision: Number(data.draftRevision || 0),
            publishedVersions: data.publishedVersions || {},
            publishedRevisions: data.publishedRevisions || {},
            publishStatusByBranch: data.publishStatusByBranch || {},
          }
        })
        setSchedules(newSchedules)
        markReady('schedules')
      }, (err) => listenerError('schedules', err)))

      if (activeSources.has('ptAvailability')) unsubs.push(onSnapshot(availabilityQuery, (snapshot) => {
        setPtAvailability(snapshot.docs.map(document => withDocumentId<PtAvailabilityDocument>(document)))
        markReady('ptAvailability')
      }, (err) => listenerError('ptAvailability', err)))

    } catch (e) {
      console.warn('Failed to set up Firestore listeners', e)
    }

    return () => unsubs.forEach(unsub => unsub())
  }, [canUseLegacyOperations, operationsView])

  const migrateData = async () => {
    throw new Error('Công cụ migration phía trình duyệt đã ngừng hoạt động. Hãy dùng quy trình migration có dry-run, manifest và đối soát phía server.')
  }

  const sanitize = (obj: any) => {
    const cleanObj = { ...obj }
    Object.keys(cleanObj).forEach(key => {
      if (cleanObj[key] === undefined) {
        delete cleanObj[key]
      }
    })
    return cleanObj
  }

  const assertLegacyWriteAccess = () => {
    if (!db) throw new Error('Firestore chưa sẵn sàng.')
    if (!canUseLegacyOperations) {
      throw new Error('Quyền quản trị dữ liệu vận hành chưa được xác minh.')
    }
  }

  const addStudent = async (student: Student) => {
    assertLegacyWriteAccess()
    if (!db) return
    await setDoc(doc(db, 'students', student.id), sanitize(student), { merge: true })
  }
  const updateStudent = async (id: string, updates: Partial<Student>) => {
    assertLegacyWriteAccess()
    if (!db) return
    await updateDoc(doc(db, 'students', id), sanitize(updates))
  }
  const deleteStudent = async (id: string) => {
    assertLegacyWriteAccess()
    if (!db) return
    await updateDoc(doc(db, 'students', id), { status: 'inactive' })
  }

  const addContract = async (contract: StudentContract) => {
    assertLegacyWriteAccess()
    if (!db) return
    await setDoc(doc(db, 'contracts', contract.id), sanitize(contract))
  }
  const updateContract = async (contract: StudentContract) => {
    assertLegacyWriteAccess()
    if (!db) return
    await setDoc(doc(db, 'contracts', contract.id), sanitize(contract), { merge: true })
  }
  const deleteContract = async (id: string) => {
    assertLegacyWriteAccess()
    if (!db) return
    throw new Error(`Hợp đồng ${id} là chứng từ nghiệp vụ và không thể xóa cứng.`)
  }

  const addPayment = async (payment: PaymentRecord) => {
    assertLegacyWriteAccess()
    if (!db) return
    throw new Error(`Phiếu thu legacy ${payment.id} đang ở chế độ chỉ đọc. Hãy ghi nhận qua Sổ tài chính.`)
  }
  const deletePayment = async (id: string) => {
    assertLegacyWriteAccess()
    if (!db) return
    throw new Error(`Phiếu thu legacy ${id} không thể xóa. Hãy tạo bút toán đảo.`)
  }

  const addSession = async (session: Session) => {
    assertLegacyWriteAccess()
    if (!db) return
    throw new Error(`Buổi tập ${session.id} chỉ được tạo qua quy trình máy chủ có kiểm tra hợp đồng và xung đột lịch.`)
  }
  const updateSession = async (session: Session) => {
    assertLegacyWriteAccess()
    if (!db) return
    throw new Error(`Buổi tập ${session.id} chỉ được cập nhật qua quy trình máy chủ có kiểm toán.`)
  }
  const deleteSession = async (id: string) => {
    assertLegacyWriteAccess()
    if (!db) return
    throw new Error(`Buổi tập ${id} không thể xóa cứng. Hãy dùng quy trình hủy hoặc điều chỉnh.`)
  }

  const addTrainer = async (trainer: Trainer) => {
    assertLegacyWriteAccess()
    if (!db) return
    await setDoc(doc(db, 'trainers', trainer.id), sanitize(trainer))
  }
  const updateTrainer = async (trainer: Trainer) => {
    assertLegacyWriteAccess()
    if (!db) return
    await setDoc(doc(db, 'trainers', trainer.id), sanitize(trainer), { merge: true })
  }
  const deleteTrainer = async (id: string) => {
    assertLegacyWriteAccess()
    if (!db) return
    await setDoc(doc(db, 'trainers', id), { status: 'inactive' }, { merge: true })
  }

  const addBranch = async (branch: Branch) => {
    assertLegacyWriteAccess()
    if (!db) return
    await setDoc(doc(db, 'branches', branch.id), sanitize(branch))
  }
  const updateBranch = async (branch: Branch) => {
    assertLegacyWriteAccess()
    if (!db) return
    await setDoc(doc(db, 'branches', branch.id), sanitize(branch), { merge: true })
  }
  const deleteBranch = async (id: string) => {
    assertLegacyWriteAccess()
    if (!db) return
    await setDoc(doc(db, 'branches', id), { status: 'archived', archivedAt: new Date().toISOString() }, { merge: true })
  }

  const addPackage = async (pkg: TrainingPackage) => {
    if (!db) return
    await setDoc(doc(db, 'packages', pkg.id), sanitize(pkg))
  }
  const updatePackage = async (pkg: TrainingPackage) => {
    if (!db) return
    await setDoc(doc(db, 'packages', pkg.id), sanitize(pkg), { merge: true })
  }
  const deletePackage = async (id: string) => {
    if (!db) return
    await deleteDoc(doc(db, 'packages', id))
  }

  const addStaff = async (staffMember: StaffMember) => {
    assertLegacyWriteAccess()
    if (!db) return
    await setDoc(doc(db, 'staff', staffMember.id), sanitize(staffMember))
  }
  const updateStaff = async (staffMember: StaffMember) => {
    assertLegacyWriteAccess()
    if (!db) return
    await setDoc(doc(db, 'staff', staffMember.id), sanitize(staffMember), { merge: true })
  }
  const deleteStaff = async (id: string) => {
    assertLegacyWriteAccess()
    if (!db) return
    await setDoc(doc(db, 'staff', id), { status: 'inactive' }, { merge: true })
  }

  const addDailyCheckin = async (checkin: DailyCheckin) => {
    if (!db) return
    await setDoc(doc(db, 'dailyCheckins', checkin.id), sanitize(checkin))
  }
  const updateDailyCheckin = async (checkin: DailyCheckin) => {
    if (!db) return
    await setDoc(doc(db, 'dailyCheckins', checkin.id), sanitize(checkin), { merge: true })
  }
  const deleteDailyCheckin = async (id: string) => {
    if (!db) return
    await deleteDoc(doc(db, 'dailyCheckins', id))
  }

  const addWorkoutLog = async (log: WorkoutLog) => {
    if (!db) return
    await setDoc(doc(db, 'workoutLogs', log.id), sanitize(log))
  }
  const updateWorkoutLog = async (log: WorkoutLog) => {
    if (!db) return
    await setDoc(doc(db, 'workoutLogs', log.id), sanitize(log), { merge: true })
  }
  const deleteWorkoutLog = async (id: string) => {
    if (!db) return
    await deleteDoc(doc(db, 'workoutLogs', id))
  }

  const addLeaveRequest = async (_request: LeaveRequest) => {
    throw new Error('OFF và bảo lưu chỉ được tạo qua quy trình máy chủ có kiểm tra chính sách.')
  }
  const updateLeaveRequest = async (_request: LeaveRequest) => {
    throw new Error('OFF và bảo lưu chỉ được duyệt qua quy trình máy chủ có audit.')
  }
  const deleteLeaveRequest = async (_id: string) => {
    throw new Error('Không thể xóa trực tiếp lịch sử OFF hoặc bảo lưu.')
  }

  const addSessionRequest = async (_request: SessionRequest) => {
    throw new Error('Yêu cầu đổi hoặc hủy lịch chỉ được tạo qua quy trình máy chủ.')
  }
  const updateSessionRequest = async (_request: SessionRequest) => {
    throw new Error('Yêu cầu đổi hoặc hủy lịch chỉ được duyệt qua quy trình máy chủ có audit.')
  }
  const deleteSessionRequest = async (_id: string) => {
    throw new Error('Không thể xóa trực tiếp lịch sử đổi hoặc hủy lịch.')
  }

  const updateScheduleData = async (weekId: string, newSchedule: Schedule, newWarnings: Warning[]) => {
    assertLegacyWriteAccess()
    if (!db) return
    await runTransaction(db, async (transaction) => {
      const docRef = doc(db!, 'schedules', weekId)
      const docSnap = await transaction.get(docRef)
      const currentRevision = docSnap.exists() ? Number(docSnap.data().draftRevision || 0) : 0
      transaction.set(docRef, {
        schedule: newSchedule,
        warnings: newWarnings,
        draftRevision: currentRevision + 1,
        updatedAt: new Date().toISOString(),
      }, { merge: true })
    })
  }

  const updateScheduleSlot = async (weekId: string, slotId: string, updater: (currentEntries: ScheduleEntry[]) => ScheduleEntry[]) => {
    assertLegacyWriteAccess()
    if (!db) return
    const docRef = doc(db, 'schedules', weekId)
    await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(docRef)
      if (!docSnap.exists()) return
      
      const currentSchedule = docSnap.data().schedule || {}
      const currentEntries = currentSchedule[slotId] || []
      const newEntries = updater(currentEntries)
      
      transaction.update(docRef, {
        [`schedule.${slotId}`]: newEntries,
        draftRevision: Number(docSnap.data().draftRevision || 0) + 1,
        updatedAt: new Date().toISOString(),
      })
    })
  }

  const updateScheduleSlots = async (weekId: string, updater: (currentSchedule: Schedule) => { [slotId: string]: ScheduleEntry[] }) => {
    assertLegacyWriteAccess()
    if (!db) return
    const docRef = doc(db, 'schedules', weekId)
    await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(docRef)
      if (!docSnap.exists()) return

      const currentSchedule = docSnap.data().schedule || {}
      const updatedSlots = updater(currentSchedule)

      const updateData: any = {}
      Object.keys(updatedSlots).forEach(slotId => {
        updateData[`schedule.${slotId}`] = updatedSlots[slotId]
      })
      
      if (Object.keys(updateData).length > 0) {
        updateData.draftRevision = Number(docSnap.data().draftRevision || 0) + 1
        updateData.updatedAt = new Date().toISOString()
        transaction.update(docRef, updateData)
      }
    })
  }

  const updateSessionOverrides = async (weekId: string, studentId: string, sessionsCount: number) => {
    if (!db) return
    const docRef = doc(db, 'schedules', weekId)
    await setDoc(docRef, {
      overriddenSessions: {
        [studentId]: sessionsCount
      }
    }, { merge: true })
  }

  const updateBulkSessionOverrides = async (weekId: string, overrides: Record<string, number>) => {
    if (!db) return
    const docRef = doc(db, 'schedules', weekId)
    await setDoc(docRef, {
      overriddenSessions: overrides
    }, { merge: true })
  }

  const updateScheduleConfig = async (config: ScheduleConfig) => {
    if (!db) return
    await setDoc(doc(db, 'settings', 'scheduleConfig'), sanitize(config), { merge: true })
  }

  const updateUserProfile = async (uid: string, data: any) => {
    if (!db) return
    await setDoc(doc(db, 'users', uid), data, { merge: true })
  }

  return (
    <DatabaseContext.Provider value={{
      students, contracts, payments, sessions, trainers, branches, packages, staff, dailyCheckins, workoutLogs, leaveRequests, sessionRequests,
      addStudent, updateStudent, deleteStudent,
      addContract, updateContract, deleteContract,
      addPayment, deletePayment,
      addSession, updateSession, deleteSession,
      addTrainer, updateTrainer, deleteTrainer,
      addBranch, updateBranch, deleteBranch,
      addPackage, updatePackage, deletePackage,
      addStaff, updateStaff, deleteStaff,
      addDailyCheckin, updateDailyCheckin, deleteDailyCheckin,
      addWorkoutLog, updateWorkoutLog, deleteWorkoutLog,
      addLeaveRequest, updateLeaveRequest, deleteLeaveRequest,
      addSessionRequest, updateSessionRequest, deleteSessionRequest,
      schedules, ptAvailability, scheduleConfig, operationsSync,
      updateScheduleData, updateScheduleSlot, updateScheduleSlots, updateSessionOverrides, updateBulkSessionOverrides, updateScheduleConfig,
      updateUserProfile,
      refreshData,
      migrateData, isMigrating, isMigrated
    }}>
      {children}
    </DatabaseContext.Provider>
  )
}
