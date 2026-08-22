const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const [sourcePath, targetPath, outputPath] = process.argv.slice(2)
if (!sourcePath || !targetPath || !outputPath) {
  throw new Error('Usage: node firebase-auth-collision-audit.cjs <source.json> <target.json> <output.json>')
}

function readUsers(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  return Array.isArray(parsed.users) ? parsed.users : []
}

function normalized(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function indexBy(users, selector) {
  const index = new Map()
  for (const user of users) {
    const key = normalized(selector(user))
    if (!key) continue
    const existing = index.get(key) || []
    existing.push(user)
    index.set(key, existing)
  }
  return index
}

function roleOf(user) {
  if (!user.customAttributes) return null
  try {
    const claims = JSON.parse(user.customAttributes)
    return claims.role || (claims.admin === true ? 'admin' : null)
  } catch {
    return 'invalid_custom_attributes'
  }
}

const sourceUsers = readUsers(sourcePath)
const targetUsers = readUsers(targetPath)
const targetUid = indexBy(targetUsers, (user) => user.localId)
const targetEmail = indexBy(targetUsers, (user) => user.email)
const targetPhone = indexBy(targetUsers, (user) => user.phoneNumber)

const conflicts = []
for (const user of sourceUsers) {
  const uid = normalized(user.localId)
  const email = normalized(user.email)
  const phone = normalized(user.phoneNumber)
  const reasons = []
  if (uid && targetUid.has(uid)) reasons.push('uid')
  if (email && targetEmail.has(email)) reasons.push('email')
  if (phone && targetPhone.has(phone)) reasons.push('phone')
  if (reasons.length) {
    conflicts.push({
      uidHash: uid ? digest(uid) : null,
      emailHash: email ? digest(email) : null,
      phoneHash: phone ? digest(phone) : null,
      reasons,
      sourceRole: roleOf(user),
    })
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  sourceUsers: sourceUsers.length,
  targetUsers: targetUsers.length,
  sourcePasswordUsers: sourceUsers.filter((user) => Boolean(user.passwordHash)).length,
  sourceGoogleUsers: sourceUsers.filter((user) => (user.providerUserInfo || []).some((provider) => provider.providerId === 'google.com')).length,
  sourcePhoneUsers: sourceUsers.filter((user) => Boolean(user.phoneNumber)).length,
  sourceUsersWithCustomClaims: sourceUsers.filter((user) => Boolean(user.customAttributes)).length,
  conflicts: {
    totalSourceUsersWithConflict: conflicts.length,
    uid: conflicts.filter((conflict) => conflict.reasons.includes('uid')).length,
    email: conflicts.filter((conflict) => conflict.reasons.includes('email')).length,
    phone: conflicts.filter((conflict) => conflict.reasons.includes('phone')).length,
  },
  conflictRecords: conflicts,
}

fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 })
console.log(JSON.stringify({
  sourceUsers: summary.sourceUsers,
  targetUsers: summary.targetUsers,
  sourcePasswordUsers: summary.sourcePasswordUsers,
  sourceGoogleUsers: summary.sourceGoogleUsers,
  sourcePhoneUsers: summary.sourcePhoneUsers,
  sourceUsersWithCustomClaims: summary.sourceUsersWithCustomClaims,
  conflicts: summary.conflicts,
  outputPath: path.resolve(outputPath),
}, null, 2))
