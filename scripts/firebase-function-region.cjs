'use strict'

const fs = require('node:fs')

function argument(name, fallback = '') {
  const prefix = `--${name}=`
  const value = process.argv.find((item) => item.startsWith(prefix))
  return value ? value.slice(prefix.length) : fallback
}

function resolveFunctionTarget(payload, functionName) {
  const name = String(functionName || '').trim()
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) throw new Error('Tên Function không hợp lệ.')
  const rows = Array.isArray(payload?.result) ? payload.result : []
  const matches = rows.filter((item) => item?.id === name && item?.state !== 'DELETED')
  if (!matches.length) return null
  const active = matches.filter((item) => item.state === 'ACTIVE')
  const candidates = active.length ? active : matches
  const targets = new Map(candidates.map((item) => [
    `${item.region || ''}/${item.runServiceId || ''}`,
    { region: item.region || '', service: item.runServiceId || '' },
  ]))
  if (targets.size !== 1) throw new Error(`Function ${name} tồn tại ở nhiều region/service; không thể chọn tự động.`)
  const target = [...targets.values()][0]
  if (!target.region || !/^[a-z][a-z0-9-]+$/.test(target.region)) throw new Error(`Function ${name} thiếu region hợp lệ.`)
  if (!target.service || !/^[a-z][a-z0-9-]*$/.test(target.service)) throw new Error(`Function ${name} thiếu Cloud Run service hợp lệ.`)
  return target
}

function main() {
  const file = argument('file')
  const functionName = argument('function')
  const field = argument('field', 'region')
  const allowMissing = process.argv.includes('--allow-missing')
  if (!file) throw new Error('Cần manifest Firebase qua --file=...')
  if (!['region', 'service'].includes(field)) throw new Error('--field chỉ nhận region hoặc service.')
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'))
  const target = resolveFunctionTarget(payload, functionName)
  if (!target) {
    if (allowMissing) return
    throw new Error(`Không tìm thấy Function ${functionName} trong manifest Firebase.`)
  }
  process.stdout.write(target[field])
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

module.exports = { resolveFunctionTarget }
