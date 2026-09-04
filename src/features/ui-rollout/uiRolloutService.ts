import { doc, getDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../../lib/firebaseFunctions'
import { firestoreDb } from '../../lib/firebaseFirestore'
import { safeLocalStorageSet } from '../../lib/safeStorage'
import { DEFAULT_AURA_UI_ROLLOUT, normalizeAuraUiAssignment, normalizeAuraUiRolloutConfig } from './config'
import type { AuraUiAssignment, AuraUiRolloutConfig, AuraUiRolloutSnapshot, AuraUiSurface } from './types'

const sessionCachePrefix = 'aura:ui-rollout:v1:'
const demoConfigKey = 'aura:ui-rollout:demo-config:v1'
const sessionPromises = new Map<string, Promise<AuraUiRolloutSnapshot>>()

function readJson(key: string) {
  try {
    const value = window.sessionStorage.getItem(key)
    return value ? JSON.parse(value) as unknown : null
  } catch {
    return null
  }
}

function readDemoConfig() {
  try {
    return normalizeAuraUiRolloutConfig(JSON.parse(window.localStorage.getItem(demoConfigKey) ?? 'null'))
  } catch {
    return DEFAULT_AURA_UI_ROLLOUT
  }
}

export function clearAuraUiRolloutCache(userId?: string) {
  if (userId) {
    sessionPromises.delete(userId)
    try { window.sessionStorage.removeItem(`${sessionCachePrefix}${userId}`) } catch { /* storage is optional */ }
    return
  }
  sessionPromises.clear()
  try {
    const keys = Array.from({ length: window.sessionStorage.length }, (_, index) => window.sessionStorage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith(sessionCachePrefix)))
    keys.forEach((key) => window.sessionStorage.removeItem(key))
  } catch { /* storage is optional */ }
}

export function loadAuraUiRollout(userId: string, demo = false): Promise<AuraUiRolloutSnapshot> {
  const existing = sessionPromises.get(userId)
  if (existing) return existing
  const promise = (async () => {
    if (demo || !firestoreDb) return { config: readDemoConfig(), assignment: null, source: 'fallback' as const }
    const cached = readJson(`${sessionCachePrefix}${userId}`) as Partial<AuraUiRolloutSnapshot> | null
    if (cached?.config) {
      return {
        config: normalizeAuraUiRolloutConfig(cached.config),
        assignment: normalizeAuraUiAssignment(cached.assignment),
        source: 'session-cache' as const,
      }
    }
    try {
      const [configSnapshot, assignmentSnapshot] = await Promise.all([
        getDoc(doc(firestoreDb, 'system', 'ui_public_config')),
        getDoc(doc(firestoreDb, 'uiRolloutAssignments', userId)),
      ])
      const value: AuraUiRolloutSnapshot = {
        config: normalizeAuraUiRolloutConfig(configSnapshot.exists() ? configSnapshot.data() : null),
        assignment: normalizeAuraUiAssignment(assignmentSnapshot.exists() ? assignmentSnapshot.data() : null),
        source: 'server',
      }
      try { window.sessionStorage.setItem(`${sessionCachePrefix}${userId}`, JSON.stringify(value)) } catch { /* storage is optional */ }
      return value
    } catch {
      return { config: DEFAULT_AURA_UI_ROLLOUT, assignment: null, source: 'fallback' as const }
    }
  })()
  sessionPromises.set(userId, promise)
  return promise
}

export async function saveAuraUiRolloutConfig(config: AuraUiRolloutConfig, actorUid: string, demo = false) {
  const normalized = normalizeAuraUiRolloutConfig({ ...config, updatedBy: actorUid, updatedAt: new Date().toISOString() })
  if (demo || !firebaseFunctions) {
    safeLocalStorageSet(demoConfigKey, JSON.stringify(normalized))
    clearAuraUiRolloutCache()
    return normalized
  }
  const callable = httpsCallable<{ action: 'config'; surfaces: AuraUiRolloutConfig['surfaces'] }, AuraUiRolloutConfig>(firebaseFunctions, 'updateAuraUiRollout')
  const result = await callable({ action: 'config', surfaces: normalized.surfaces })
  clearAuraUiRolloutCache()
  return normalizeAuraUiRolloutConfig(result.data)
}

export async function saveAuraUiAssignment(input: { uid: string; surfaces: AuraUiSurface[]; expiresAt: string | null }, demo = false) {
  if (demo || !firebaseFunctions) return normalizeAuraUiAssignment({ ...input, updatedAt: new Date().toISOString(), updatedBy: 'demo' })
  const callable = httpsCallable<{ action: 'assignment'; uid: string; surfaces: AuraUiSurface[]; expiresAt: string | null }, AuraUiAssignment>(firebaseFunctions, 'updateAuraUiRollout')
  const result = await callable({ action: 'assignment', ...input })
  clearAuraUiRolloutCache(input.uid)
  return normalizeAuraUiAssignment(result.data)
}
