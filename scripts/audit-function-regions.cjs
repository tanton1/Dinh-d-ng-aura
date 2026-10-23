'use strict'

// Read-only inventory. Never exports environment variables, tokens or source
// archives; the report contains runtime configuration and aggregate metrics.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const PROJECT = 'gen-lang-client-0815966909'
function argument(name, fallback = '') {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback
}
function shortName(value) { return String(value || '').split('/').at(-1) || '' }
function runtimeProfile(revision) {
  const resource = revision.containers?.[0]?.resources || {}
  return { revision: shortName(revision.name), cpu: Number(resource.limits?.cpu) || null, memory: resource.limits?.memory || null, minInstances: revision.scaling?.minInstanceCount ?? 0, maxInstances: revision.scaling?.maxInstanceCount ?? null, concurrency: revision.maxInstanceRequestConcurrency ?? null, startupCpuBoost: resource.startupCpuBoost ?? false }
}
async function mapBounded(items, operation, concurrency = 8) {
  const results = new Array(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await operation(items[index])
    }
  }))
  return results
}
function sumPoints(series) {
  return (series.points || []).reduce((sum, point) => sum + Number(point.value?.int64Value ?? point.value?.doubleValue ?? 0), 0)
}
function sumKnown(rows, field) {
  return rows.some((row) => row[field] === null) ? null : rows.reduce((sum, row) => sum + row[field], 0)
}
function configuredMinimumFloor(row) {
  if (!row.servingRevisions.length || row.servingRevisions.some((revision) => revision.minInstances === null)) return null
  return Math.max(row.serviceMinInstances, row.servingRevisions.reduce((sum, revision) => sum + revision.minInstances, 0))
}
function renderInventory(report) {
  const lines = [
    'AURA — KIỂM KÊ CLOUD FUNCTIONS THEO VÙNG',
    `Project: ${report.project} | Quan sát UTC: ${report.observedAt}`,
    '',
    'PHẠM VI VÀ CÁCH ĐỌC',
    '- Kiểm kê toàn bộ function đang triển khai, cấu hình, revision nhận traffic và request 24 giờ / 7 ngày.',
    '- Phân loại di chuyển là sàng lọc kỹ thuật, không thay thế rà soát từng handler, quyền và tính chống chạy trùng.',
    '- Request Cloud Run không đồng nghĩa số lượt người dùng; không gồm yêu cầu bị chặn trước container.',
    '- Min instances bằng 0 nghĩa là không đặt warm bắt buộc, không có nghĩa không tồn tại instance vừa xử lý request.',
    '- Latest khác serving: revision mới chưa sẵn sàng, không có nghĩa revision cũ đã ngừng phục vụ.',
    '- CPU x max instances là trần cấu hình, KHÔNG phải CPU đang sử dụng hay chi phí hóa đơn.',
    '- Tên alias chỉ là gợi ý; phải đối chiếu hợp đồng API trước khi chuyển client. Không tự xóa endpoint cũ.',
    '- Di chuyển vùng không giảm số read Firestore; có thể thêm độ trễ và phí truyền dữ liệu liên vùng.',
    '', 'TỔNG QUAN',
    ...report.summary.map((row) => `${row.region}: ${row.functions} functions; ${row.byKind.callable} callable; ${row.byKind['event-trigger']} trigger; ${row.byKind.scheduled} scheduled; min bắt buộc=${row.configuredMinimums ?? 'không rõ'}; requests 24h=${row.requests24h ?? 'không rõ'}, 7d=${row.requests7d ?? 'không rõ'}; latest chưa ready=${row.latestRevisionNotReady.length}`),
    '', 'QUOTA (GIỚI HẠN ĐƯỢC CẤP, KHÔNG PHẢI MỨC SỬ DỤNG HIỆN TẠI)',
    ...report.quotas.map((quota) => `${quota.service} | ${quota.metric} | ${quota.region} | ${quota.effectiveLimit} | ${quota.unit}`),
    '', 'HƯỚNG XỬ LÝ',
    '- Trigger: giữ gần Firestore, bỏ qua thay đổi không ảnh hưởng nghiệp vụ, gom rebuild và giữ retry/idempotency.',
    '- Scheduled: chỉ một lịch chạy/worker cho mỗi công việc; tránh tạo job trùng ở hai vùng.',
    '- Đã có alias: đối chiếu client và lỗi fallback; chuyển traffic trước, giữ endpoint cũ để rollback.',
    '- Read chưa có alias: kiểm tra quyền/phạm vi, tạo alias có CPU và maxInstances thấp ở vùng còn dư.',
    '- Ghi tài chính/lịch/điểm: không tự retry sang vùng khác nếu chưa có cơ chế chống ghi trùng.',
    '', 'CHI TIẾT TOÀN BỘ FUNCTION',
  ]
  report.functions.forEach((row, index) => {
    lines.push('', `${index + 1}. ${row.name} @ ${row.region} [${row.kind}]`,
      `   Requests: 24h=${row.requests24h ?? '?'}; 7d=${row.requests7d ?? '?'}; HTTP 5xx=${row.http5xx24h ?? '?'}; 429=${row.http42924h ?? '?'}`,
      `   Cấu hình mới nhất: CPU=${row.cpu}; RAM=${row.memory}; min=${row.revisionMinInstances}; max=${row.maxInstances}; concurrency=${row.concurrency}; timeout=${row.timeoutSeconds}s`,
      `   Min bắt buộc đang phục vụ=${row.configuredMinimum ?? '?'}; latest ready=${row.latestRevisionReady}; state=${row.state}`,
      ...row.servingRevisions.map((revision) => `   Serving: ${revision.revision}; CPU=${revision.cpu ?? '?'}; RAM=${revision.memory ?? '?'}; min=${revision.minInstances ?? '?'}; max=${revision.maxInstances ?? '?'}`),
      `   Alias ứng viên: ${row.aliases.map((alias) => `${alias.name}@${alias.region}`).join(', ') || 'chưa phát hiện'}`,
      `   Client: ${row.clientFiles.join(', ') || 'không tìm thấy chuỗi tên trực tiếp'}`,
      `   Phân loại: ${row.recommendation}`)
  })
  if (report.warnings.length) lines.push('', 'CẢNH BÁO THU THẬP', ...report.warnings)
  return lines.join('\n') + '\n'
}
function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    const file = path.join(directory, item.name)
    return item.isDirectory() ? sourceFiles(file) : /\.[cm]?[jt]sx?$/.test(item.name) ? [file] : []
  })
}
function classify(fn) {
  if (fn.eventTrigger) return 'event-trigger'
  if (fn.labels?.['deployment-scheduled'] === 'true') return 'scheduled'
  if (fn.labels?.['deployment-callable'] === 'true') return 'callable'
  return 'http'
}
function decision(row) {
  if (row.kind === 'event-trigger') return 'keep-near-database; audit no-op/idempotency/fan-out before reducing resources'
  if (row.kind === 'scheduled') return 'keep single scheduler; coalesce work and measure idle polls'
  if (row.region !== 'asia-southeast1') return 'already outside southeast1; verify routing and capacity'
  if (row.aliases.length) return 'existing alias; migrate client traffic first, retain legacy rollback'
  if (row.requests7d > 100 && /^(get|list|search|fetch)/.test(row.name)) return 'candidate: bounded read-only alias in existing region'
  if (row.cpu >= 1 && row.requests7d < 50) return 'cold/low-traffic; profile memory and CPU before any migration'
  return 'retain until per-handler scope, load and idempotency review'
}
async function main() {
  const project = argument('project', PROJECT)
  if (project !== PROJECT) throw new Error('This audit is scoped to the Aura production project.')
  const token = process.env.AURA_AUDIT_ACCESS_TOKEN
  if (!token) throw new Error('Provide a short-lived AURA_AUDIT_ACCESS_TOKEN without printing it.')
  const headers = { authorization: `Bearer ${token}` }
  const warnings = []
  async function get(url) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(45_000) })
    if (!response.ok) throw new Error(`Read API ${response.status} at ${new URL(url).pathname}: ${(await response.text()).slice(0, 240)}`)
    return response.json()
  }
  async function list(url, field) {
    const rows = []
    const next = new URL(url)
    do {
      const payload = await get(next)
      rows.push(...(payload[field] || []))
      if (!payload.nextPageToken) break
      next.searchParams.set('pageToken', payload.nextPageToken)
    } while (true)
    return rows
  }
  const functions = await list(`https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/-/functions?pageSize=1000`, 'functions')
  const regions = [...new Set(functions.map((fn) => fn.name.split('/')[3]))].sort()
  const services = (await Promise.all(regions.map((region) => list(`https://run.googleapis.com/v2/projects/${project}/locations/${region}/services?pageSize=100`, 'services')))).flat()
  const servingProfiles = new Map(await mapBounded(services, async (service) => {
    const targets = [...new Set((service.trafficStatuses || []).map((target) => target.revision).filter(Boolean))]
    if (!targets.length && service.latestReadyRevision) targets.push(shortName(service.latestReadyRevision))
    const profiles = await Promise.all(targets.map(async (revision) => {
      if (revision === shortName(service.latestCreatedRevision)) return runtimeProfile({ ...service.template, name: revision })
      try { return runtimeProfile(await get(`https://run.googleapis.com/v2/${service.name}/revisions/${revision}`)) }
      catch (error) { warnings.push(error.message); return { revision, unknown: true, minInstances: null } }
    }))
    return [service.name, profiles]
  }))
  const end = new Date()
  async function metric(type, days, aligner = 'ALIGN_SUM') {
    const url = new URL(`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries`)
    url.searchParams.set('filter', `metric.type="${type}" AND resource.type="cloud_run_revision"`)
    url.searchParams.set('interval.startTime', new Date(end.getTime() - days * 86400000).toISOString())
    url.searchParams.set('interval.endTime', end.toISOString())
    url.searchParams.set('aggregation.alignmentPeriod', '86400s')
    url.searchParams.set('aggregation.perSeriesAligner', aligner)
    url.searchParams.set('pageSize', '1000')
    try { return await list(url, 'timeSeries') } catch (error) { warnings.push(error.message); return null }
  }
  const [request7d, request24h, cpu24h, projectData] = await Promise.all([
    metric('run.googleapis.com/request_count', 7),
    metric('run.googleapis.com/request_count', 1),
    metric('run.googleapis.com/container/cpu/allocation_time', 1),
    get(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}`),
  ])
  const quotas = []
  for (const service of ['run.googleapis.com', 'cloudfunctions.googleapis.com']) {
    const metrics = await list(`https://serviceusage.googleapis.com/v1beta1/projects/${projectData.projectNumber}/services/${service}/consumerQuotaMetrics?view=FULL&pageSize=200`, 'metrics')
    for (const item of metrics.filter((item) => /\/(cpu_allocation|memory_allocation|max_regions|instances)$/.test(item.metric))) {
      for (const limit of item.consumerQuotaLimits || []) {
        for (const bucket of limit.quotaBuckets || []) {
          if (bucket.dimensions?.region && !regions.includes(bucket.dimensions.region)) continue
          quotas.push({ service, metric: item.metric, region: bucket.dimensions?.region || 'default', unit: limit.unit, effectiveLimit: bucket.effectiveLimit })
        }
      }
    }
  }
  const sources = sourceFiles(path.join(process.cwd(), 'src')).map((file) => ({ file: path.relative(process.cwd(), file).replaceAll('\\', '/'), text: fs.readFileSync(file, 'utf8') }))
  const byService = new Map(services.map((service) => [service.name, service]))
  function total(series, region, service, codePattern) {
    if (!series) return null
    return series.filter((item) => item.resource.labels.location === region && item.resource.labels.service_name === service && (!codePattern || codePattern.test(String(item.metric.labels.response_code))))
      .reduce((sum, item) => sum + sumPoints(item), 0)
  }
  const rows = functions.map((fn) => {
    const name = shortName(fn.name)
    const region = fn.name.split('/')[3]
    const service = shortName(fn.serviceConfig?.service)
    const run = byService.get(fn.serviceConfig?.service)
    const ready = shortName(run?.latestReadyRevision)
    const created = shortName(run?.latestCreatedRevision)
    const aliases = functions.filter((candidate) => candidate !== fn && candidate.name.split('/')[3] !== region && [name + 'Regional', name + 'Overflow', name + 'V2', name + 'V4'].includes(shortName(candidate.name)))
      .map((candidate) => ({ name: shortName(candidate.name), region: candidate.name.split('/')[3], state: candidate.state }))
    const row = {
      name, region, service, kind: classify(fn), state: fn.state,
      cpu: Number(fn.serviceConfig?.availableCpu) || null,
      memory: fn.serviceConfig?.availableMemory || null,
      maxInstances: fn.serviceConfig?.maxInstanceCount ?? null,
      revisionMinInstances: run?.template?.scaling?.minInstanceCount ?? fn.serviceConfig?.minInstanceCount ?? 0,
      serviceMinInstances: run?.scaling?.minInstanceCount ?? 0,
      servingRevisions: servingProfiles.get(fn.serviceConfig?.service) || [],
      concurrency: fn.serviceConfig?.maxInstanceRequestConcurrency ?? null,
      timeoutSeconds: fn.serviceConfig?.timeoutSeconds ?? null,
      latestReadyRevision: ready, latestCreatedRevision: created,
      latestRevisionReady: Boolean(ready && ready === created),
      traffic: run?.trafficStatuses || [],
      eventType: fn.eventTrigger?.eventType || null,
      eventFilters: fn.eventTrigger?.eventFilters || [],
      requests24h: total(request24h, region, service),
      requests7d: total(request7d, region, service),
      http5xx24h: total(request24h, region, service, /^5/),
      http42924h: total(request24h, region, service, /^429$/),
      allocatedCpuSeconds24h: total(cpu24h, region, service),
      aliases,
      clientFiles: sources.filter((source) => new RegExp(`['"\x60]${name}['"\x60]`).test(source.text)).map((source) => source.file),
    }
    row.configuredMinimum = configuredMinimumFloor(row)
    row.recommendation = decision(row)
    return row
  }).sort((a, b) => a.region.localeCompare(b.region) || b.requests7d - a.requests7d || a.name.localeCompare(b.name))
  const summary = regions.map((region) => {
    const selected = rows.filter((row) => row.region === region)
    return {
      region, functions: selected.length,
      byKind: Object.fromEntries(['callable', 'http', 'event-trigger', 'scheduled'].map((kind) => [kind, selected.filter((row) => row.kind === kind).length])),
      configuredMinimums: sumKnown(selected, 'configuredMinimum'),
      requests24h: sumKnown(selected, 'requests24h'),
      requests7d: sumKnown(selected, 'requests7d'),
      allocatedCpuSeconds24h: sumKnown(selected, 'allocatedCpuSeconds24h'),
      theoreticalCpuCeiling: Number(selected.reduce((sum, row) => sum + row.cpu * (row.maxInstances || 0), 0).toFixed(3)),
      latestRevisionNotReady: selected.filter((row) => !row.latestRevisionReady).map((row) => row.name),
    }
  })
  const output = path.resolve(argument('output', `tmp/function-region-audit-${end.toISOString().replaceAll(':', '-')}.json`))
  fs.mkdirSync(path.dirname(output), { recursive: true })
  const report = { project, observedAt: end.toISOString(), gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), notes: ['Read-only APIs; no customer document contents or credentials.', 'CPU ceiling is configured theoretical capacity, NOT active CPU or billable usage.', 'CPU allocation metric includes startup and all revisions; it is NOT a billing estimate or instantaneous regional quota usage.', 'HTTP request metrics exclude requests rejected before reaching a container, and do not cover all callable application errors.', 'Missing metrics are null, not zero. Request counts exclude services not backed by a listed Function.', 'Alias-name matches and read-name prefixes are screening hints, not proof of equivalent or side-effect-free handlers.'], warnings, summary, quotas, functions: rows }
  fs.writeFileSync(output, JSON.stringify(report, null, 2))
  fs.writeFileSync(output.replace(/\.json$/i, '') + '.txt', renderInventory(report))
  console.log(JSON.stringify({ output, warnings, summary: summary.map(({ latestRevisionNotReady, ...row }) => ({ ...row, latestRevisionNotReadyCount: latestRevisionNotReady.length })), quotas, southeastTop: rows.filter((row) => row.region === 'asia-southeast1').slice(0, 15).map(({ name, kind, requests24h, requests7d, cpu, maxInstances, aliases }) => ({ name, kind, requests24h, requests7d, cpu, maxInstances, aliases })) }, null, 2))
}
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
module.exports = { classify, decision, sumPoints, runtimeProfile, mapBounded, configuredMinimumFloor, sumKnown, renderInventory }
