import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Schedule, ScheduleConfig, Student, Trainer } from '../src/types'
import { calculateWarnings } from '../src/utils/schedulerWarnings'
import { calculateWarnings as compatibleCalculateWarnings } from '../src/utils/scheduler'

test('scheduler warning projection stays compatible after optimizer chunk split', () => {
  const students = [
    { id: 'student-1', name: 'Lan', sessionsPerWeek: 2 },
    { id: 'student-2', name: 'Mai', sessionsPerWeek: 1 },
  ] as Student[]
  const trainers = [{ id: 'trainer-1', name: 'PT Aura', slotCapacity: 2 }] as Trainer[]
  const config = { workingDays: ['T2'], workingHours: [6, 7] } as ScheduleConfig
  const schedule = {
    'T2-6': [{ studentId: 'student-1', trainerId: 'trainer-1', type: 'training' }],
    'T2-7': [],
  } as Schedule

  const warnings = calculateWarnings(students, trainers, schedule, config)
  assert.deepEqual(compatibleCalculateWarnings(students, trainers, schedule, config), warnings)
  assert.equal(warnings.find((item) => item.studentId === 'student-1')?.requested, 2)
  assert.equal(warnings.find((item) => item.studentId === 'student-2')?.suggestions[0], 'T2-6')
})

test('heavy route assets remain behind their interaction boundaries', () => {
  const application = readFileSync('src/AuraApplication.tsx', 'utf8')
  const progress = readFileSync('src/pages/student/ProgressPage.tsx', 'utf8')
  const schedulerWrapper = readFileSync('src/components/schedule/SchedulerWrapper.tsx', 'utf8')
  const preloader = readFileSync('src/utils/routePreloader.ts', 'utf8')

  assert.doesNotMatch(application, /import ['"]\.\/styles-progress\.css['"]/)
  assert.match(progress, /React\.lazy\(\(\) => import\('\.\.\/\.\.\/components\/progress\/ProgressPhotosCard'\)/)
  assert.match(progress, /period === '7-days' \? 7 : period === '30-days' \? 30 : 90/)
  assert.match(schedulerWrapper, /from ["']\.\.\/\.\.\/utils\/schedulerWarnings["']/)
  assert.doesNotMatch(schedulerWrapper, /import \{ calculateWarnings \} from ["']\.\.\/\.\.\/utils\/scheduler["']/)
  assert.match(preloader, /'admin-pt-schedule': \(\) => import\('\.\.\/components\/schedule\/BranchScheduleWorkspace'\)/)
  assert.match(preloader, /'admin-finance': \(\) => import\('\.\.\/components\/admin\/pt\/AdminFinanceHub'\)/)
  assert.doesNotMatch(preloader, /features\/eat-clean\/pages\/EatCleanPage/)
})
