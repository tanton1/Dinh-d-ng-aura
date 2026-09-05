import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { UserRole } from '../../types'
import { DEFAULT_AURA_UI_ROLLOUT, isAuraUiSurfaceEnabled } from './config'
import { loadAuraUiRollout, readAuraUiRolloutCache } from './uiRolloutService'
import type { AuraUiAssignment, AuraUiRolloutConfig, AuraUiSurface } from './types'

interface AuraUiRolloutValue {
  loading: boolean
  config: AuraUiRolloutConfig
  assignment: AuraUiAssignment | null
  isEnabled: (surface: AuraUiSurface) => boolean
}

const AuraUiRolloutContext = createContext<AuraUiRolloutValue>({
  loading: false,
  config: DEFAULT_AURA_UI_ROLLOUT,
  assignment: null,
  isEnabled: () => false,
})

export function AuraUiRolloutProvider({ userId, role, demo = false, children }: { userId: string; role: UserRole; demo?: boolean; children: ReactNode }) {
  const initialSnapshot = readAuraUiRolloutCache(userId, demo)
  const [config, setConfig] = useState(initialSnapshot?.config ?? DEFAULT_AURA_UI_ROLLOUT)
  const [assignment, setAssignment] = useState<AuraUiAssignment | null>(initialSnapshot?.assignment ?? null)
  const [loading, setLoading] = useState(Boolean(userId && !initialSnapshot))

  useEffect(() => {
    let active = true
    if (!userId) {
      setConfig(DEFAULT_AURA_UI_ROLLOUT)
      setAssignment(null)
      setLoading(false)
      return () => { active = false }
    }
    const cached = readAuraUiRolloutCache(userId, demo)
    if (cached) {
      setConfig(cached.config)
      setAssignment(cached.assignment)
      setLoading(false)
    } else {
      setLoading(true)
    }
    void loadAuraUiRollout(userId, demo).then((snapshot) => {
      if (!active) return
      setConfig(snapshot.config)
      setAssignment(snapshot.assignment)
      setLoading(false)
    })
    return () => { active = false }
  }, [demo, userId])

  const value = useMemo<AuraUiRolloutValue>(() => ({
    loading,
    config,
    assignment,
    isEnabled: (surface) => isAuraUiSurfaceEnabled(surface, role, config, assignment),
  }), [assignment, config, loading, role])

  return <AuraUiRolloutContext.Provider value={value}>{children}</AuraUiRolloutContext.Provider>
}

export function useAuraUiRollout() {
  return useContext(AuraUiRolloutContext)
}

export function useAuraUiSurface(surface: AuraUiSurface) {
  return useAuraUiRollout().isEnabled(surface)
}

