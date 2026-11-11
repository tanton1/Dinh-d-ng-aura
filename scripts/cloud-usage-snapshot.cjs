#!/usr/bin/env node
'use strict'

// Read-only usage snapshot from Cloud Monitoring: Firestore read/write
// operations and Cloud Run (Functions) requests and billable instance time.
// It reads metric metadata only: no business documents, no logs, no writes.
//
//   node scripts/cloud-usage-snapshot.cjs --project=<id> [--days=7] [--top=25] [--hourly=48]
//
// --hourly prints, per hour, Firestore read operations next to the run time of
// the weekly schedule view worker and the number of schedule opens. It is the
// quickest way to see whether a background sweep, not a page, drives reads.
const { execFileSync } = require('node:child_process')

function option(name, fallback) {
  const prefix = `--${name}=`
  const match = process.argv.find((item) => item.startsWith(prefix))
  return match ? match.slice(prefix.length) : fallback
}

const project = option('project', process.env.GCLOUD_PROJECT || '')
const days = Math.max(1, Math.min(30, Number(option('days', '7')) || 7))
const top = Math.max(5, Math.min(400, Number(option('top', '25')) || 25))
const hourly = Math.max(0, Math.min(168, Number(option('hourly', '0')) || 0))
if (!/^[a-z][a-z0-9-]{4,29}$/.test(project)) {
  console.error('Usage: node scripts/cloud-usage-snapshot.cjs --project=<project id> [--days=7] [--top=25] [--hourly=48]')
  process.exit(2)
}

function accessToken() {
  const output = process.platform === 'win32'
    ? execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'gcloud auth print-access-token --quiet'], { encoding: 'utf8' })
    : execFileSync('gcloud', ['auth', 'print-access-token', '--quiet'], { encoding: 'utf8' })
  return output.trim()
}

async function timeSeries(token, { filter, start, end, periodSeconds, groupBy = [] }) {
  const rows = []
  let pageToken = ''
  do {
    const params = new URLSearchParams()
    params.set('filter', filter)
    params.set('interval.startTime', start.toISOString())
    params.set('interval.endTime', end.toISOString())
    params.set('aggregation.alignmentPeriod', `${periodSeconds}s`)
    params.set('aggregation.perSeriesAligner', 'ALIGN_SUM')
    params.set('aggregation.crossSeriesReducer', 'REDUCE_SUM')
    for (const field of groupBy) params.append('aggregation.groupByFields', field)
    if (pageToken) params.set('pageToken', pageToken)
    const response = await fetch(`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries?${params}`, { headers: { authorization: `Bearer ${token}` } })
    const body = await response.json()
    if (!response.ok) throw new Error(`${filter}: ${response.status} ${JSON.stringify(body).slice(0, 300)}`)
    rows.push(...(body.timeSeries || []))
    pageToken = body.nextPageToken || ''
  } while (pageToken)
  return rows
}

const pointValue = (point) => Number(point.value.int64Value ?? point.value.doubleValue ?? 0)
const total = (row) => (row.points || []).reduce((sum, point) => sum + pointValue(point), 0)
const metric = (type) => `metric.type="${type}"`

async function totals(token, end) {
  const start = new Date(end.getTime() - days * 86400000)
  const window = { start, end, periodSeconds: days * 86400 }
  console.log(`Window ${start.toISOString()} → ${end.toISOString()} (${days} days)`)
  for (const [type, label] of [
    ['firestore.googleapis.com/document/read_ops_count', 'type'],
    ['firestore.googleapis.com/document/write_ops_count', 'op'],
    ['firestore.googleapis.com/api/billable_read_units', 'api_method'],
  ]) {
    const rows = await timeSeries(token, { ...window, filter: metric(type), groupBy: [`metric.label.${label}`] })
    console.log(`\n${type}`)
    for (const row of rows.map((item) => [item.metric?.labels?.[label] || '-', total(item)]).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(row[0]).padEnd(24)} ${String(Math.round(row[1])).padStart(12)}  (${Math.round(row[1] / days)}/day)`)
    }
  }
  const byService = async (type) => new Map((await timeSeries(token, { ...window, filter: metric(type), groupBy: ['resource.label.service_name'] }))
    .map((row) => [row.resource.labels.service_name, total(row)]))
  const requests = await byService('run.googleapis.com/request_count')
  const seconds = await byService('run.googleapis.com/container/billable_instance_time')
  const table = [...new Set([...requests.keys(), ...seconds.keys()])]
    .map((name) => ({ name, requests: requests.get(name) || 0, seconds: seconds.get(name) || 0 }))
  const sum = (key) => table.reduce((value, row) => value + row[key], 0)
  console.log(`\nCloud Run services with traffic: ${table.length}; requests ${Math.round(sum('requests'))} (${Math.round(sum('requests') / days)}/day); billable instance seconds ${Math.round(sum('seconds'))} (${Math.round(sum('seconds') / days)}/day)`)
  const print = (title, key) => {
    console.log(`\n${title}`)
    for (const row of [...table].sort((a, b) => b[key] - a[key]).slice(0, top)) {
      console.log(`  ${row.name.padEnd(52)} ${String(Math.round(row.requests)).padStart(7)} req  ${String(Math.round(row.seconds)).padStart(8)} s  ${row.requests ? (row.seconds / row.requests).toFixed(2) : '-'} s/req`)
    }
  }
  print(`Top ${top} by billable instance time`, 'seconds')
  print(`Top ${top} by requests`, 'requests')
}

async function hourlyTable(token, end) {
  const start = new Date(end.getTime() - hourly * 3600000)
  const window = { start, end, periodSeconds: 3600 }
  const series = async (filter) => {
    const result = new Map()
    for (const row of await timeSeries(token, { ...window, filter })) {
      for (const point of row.points || []) {
        const key = point.interval.endTime.slice(0, 13)
        result.set(key, (result.get(key) || 0) + pointValue(point))
      }
    }
    return result
  }
  const service = (name) => `resource.label.service_name="${name}"`
  const reads = await series(metric('firestore.googleapis.com/document/read_ops_count'))
  const units = await series(metric('firestore.googleapis.com/api/billable_read_units'))
  const worker = await series(`${metric('run.googleapis.com/container/billable_instance_time')} AND ${service('rebuilddirtyptscheduleweeklyviewsscheduled')}`)
  const opens = await series(`${metric('run.googleapis.com/request_count')} AND ${service('getptscheduleweeklyviewregional')}`)
  const requests = await series(metric('run.googleapis.com/request_count'))
  console.log(`\nHourly (UTC), last ${hourly} hours`)
  console.log('hour            read_ops  read_units  worker_s  schedule_opens  all_requests')
  const cell = (map, key, width) => String(Math.round(map.get(key) || 0)).padStart(width)
  for (const key of [...reads.keys()].sort()) {
    console.log(`${key}  ${cell(reads, key, 9)}  ${cell(units, key, 10)}  ${cell(worker, key, 8)}  ${cell(opens, key, 14)}  ${cell(requests, key, 12)}`)
  }
}

async function main() {
  const token = accessToken()
  const end = new Date(Math.floor(Date.now() / 3600000) * 3600000)
  await totals(token, end)
  if (hourly) await hourlyTable(token, end)
}

main().catch((error) => { console.error(error.message); process.exit(1) })
