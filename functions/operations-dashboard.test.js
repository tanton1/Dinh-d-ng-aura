'use strict'
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const source = readFileSync(join(__dirname, 'operations-dashboard.js'), 'utf8')
const dashboard = readFileSync(join(__dirname, '..', 'src', 'pages', 'admin', 'AdminDashboard.tsx'), 'utf8')

test('operations dashboard separates contract sales from canonical cash collection', () => {
  assert.match(source, /contractSales/)
  assert.match(source, /cashCollected/)
  assert.match(source, /collection\('ledgerEntries'\)/)
  assert.doesNotMatch(source, /collection\('payments'\)/)
  assert.match(dashboard, /DOANH SỐ HỢP ĐỒNG/)
  assert.match(dashboard, /TIỀN THỰC THU/)
})

test('dashboard and attendance queries are bounded and capability protected', () => {
  assert.match(source, /requireCapability\(actor, 'dashboard\.view'\)/)
  assert.match(source, /requireCapability\(actor, 'payroll\.operations\.manage'\)/)
  assert.match(source, /MAX_SCANNED_DOCUMENTS/)
  assert.match(source, /collection\('attendanceEvents'\)/)
})
