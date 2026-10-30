import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_PUSH_SETTINGS, getPushAdminOverview, getPushAutomationLogs, getPushBroadcastLogsPage,
  getPushTemplates, getSystemPushSettings, type PushBroadcastCursor,
} from '../../../services/notificationService'
import type { PushAdminOverview, PushAutomationLog, PushBroadcastLog, PushTemplate, SystemPushSettings } from '../../../types'
import type { PushAdminTab } from './pushTypes'

export type AdminSettingsTab = PushAdminTab | 'ui-rollout'
type Source = 'settings' | 'overview' | 'templates' | 'automations' | 'history'
const sourcesFor = (tab: AdminSettingsTab): Source[] => tab === 'overview' ? ['settings', 'overview']
  : tab === 'compose' ? ['templates'] : tab === 'automation' ? ['settings', 'automations']
    : tab === 'history' ? ['history', 'automations'] : []

export function useAdminPushReads(tab: AdminSettingsTab, backendMode: 'demo' | 'firebase') {
  const [settings, setSettings] = useState<SystemPushSettings>(() => ({ ...DEFAULT_PUSH_SETTINGS, mealReminderTimes: { ...DEFAULT_PUSH_SETTINGS.mealReminderTimes } }))
  const [overview, setOverview] = useState<PushAdminOverview | null>(null)
  const [settingsReady, setSettingsReady] = useState(false)
  const [templates, setTemplates] = useState<PushTemplate[]>([])
  const [broadcasts, setBroadcasts] = useState<PushBroadcastLog[]>([])
  const [automations, setAutomations] = useState<PushAutomationLog[]>([])
  const [pending, setPending] = useState<Partial<Record<Source, boolean>>>({})
  const [errors, setErrors] = useState<Partial<Record<Source, string>>>({})
  const [hasMore, setHasMore] = useState(false)
  const [historyChanged, setHistoryChanged] = useState(false)
  const loaded = useRef(new Set<Source>())
  const requests = useRef(new Map<Source, number>())
  const inFlight = useRef(new Set<Source>())
  const cursor = useRef<PushBroadcastCursor | null>(null)
  const historyPages = useRef(1)
  const overviewNeedsFresh = useRef(false)
  const lifetime = useRef(0)
  const alive = useRef(false)
  const activeTab = useRef(tab)
  activeTab.current = tab
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; lifetime.current++; inFlight.current.clear() }
  }, [])
  const currentRequest = useCallback(() => {
    const epoch = lifetime.current
    return () => alive.current && lifetime.current === epoch
  }, [])

  const load = useCallback(async (source: Source, force = false, append = false) => {
    if ((inFlight.current.has(source) && (!force || append)) || (!force && loaded.current.has(source))) return
    const generation = (requests.current.get(source) ?? 0) + 1
    requests.current.set(source, generation)
    const current = currentRequest()
    const valid = () => current() && requests.current.get(source) === generation
    inFlight.current.add(source)
    setPending(value => ({ ...value, [source]: true }))
    setErrors(value => ({ ...value, [source]: '' }))
    try {
      if (source === 'history') {
        let after = append ? cursor.current : null
        let items: PushBroadcastLog[] = []
        let more = false
        let pages = 0
        // Refresh the window already opened by the operator, in bounded pages.
        // Do not collapse their place to the first page after a mutation.
        do {
          const page = await getPushBroadcastLogsPage({ cursor: after, pageSize: 25 })
          if (!valid()) return
          items.push(...page.items)
          after = page.nextCursor
          more = page.hasMore
          pages++
        } while (!append && more && after && pages < historyPages.current)
        if (!valid()) return
        cursor.current = after
        historyPages.current = append ? historyPages.current + 1 : pages
        setBroadcasts(previous => [...new Map((append ? [...previous, ...items] : items).map(item => [item.id, item])).values()])
        setHasMore(more)
        if (!append) setHistoryChanged(false)
      } else {
        const value = await ({ settings: () => getSystemPushSettings({ requireServer: backendMode === 'firebase' }), overview: () => getPushAdminOverview({ forceRefresh: force || overviewNeedsFresh.current }), templates: getPushTemplates, automations: getPushAutomationLogs }[source])()
        if (!valid()) return
        if (source === 'settings') { setSettings(value as SystemPushSettings); setSettingsReady(true) }
        if (source === 'overview') { setOverview(value as PushAdminOverview); overviewNeedsFresh.current = false }
        if (source === 'templates') setTemplates(value as PushTemplate[])
        if (source === 'automations') setAutomations(value as PushAutomationLog[])
      }
      if (valid()) loaded.current.add(source)
    } catch (error) {
      if (!valid()) return
      loaded.current.add(source)
      if (source === 'overview') setOverview(null)
      if (source === 'settings') setSettingsReady(false)
      setErrors(value => ({ ...value, [source]: error instanceof Error ? error.message : 'Chưa tải được dữ liệu. Hãy thử lại.' }))
    } finally {
      if (valid()) {
        inFlight.current.delete(source)
        setPending(value => ({ ...value, [source]: false }))
      }
    }
  }, [backendMode, currentRequest])

  useEffect(() => { sourcesFor(tab).forEach(source => { void load(source) }) }, [load, tab])
  const invalidate = (source: Source) => {
    requests.current.set(source, (requests.current.get(source) ?? 0) + 1)
    inFlight.current.delete(source)
    loaded.current.delete(source)
    setPending(value => ({ ...value, [source]: false }))
  }
  const refresh = () => Promise.all(sourcesFor(tab).map(source => load(source, true)))
  const afterDelivery = () => {
    overviewNeedsFresh.current = true
    invalidate('overview')
    // A request started before delivery must not clear the changed notice or
    // publish a cursor whose source snapshot predates the new notification.
    if (inFlight.current.has('history')) invalidate('history')
    setHistoryChanged(true)
    // History stays in place until an explicit refresh. No hidden-tab reads.
    if (activeTab.current === 'overview') void load('overview', true)
  }
  const afterDevice = () => {
    overviewNeedsFresh.current = true
    invalidate('overview')
    if (activeTab.current === 'overview') void load('overview', true)
  }
  return {
    settings, settingsReady, setSettings: (next: SystemPushSettings) => {
      invalidate('settings'); loaded.current.add('settings'); setSettings(next)
    }, overview, templates, broadcasts, automations, hasMore, historyChanged,
    loading: sourcesFor(tab).some(source => pending[source]), historyLoading: Boolean(pending.history),
    loadError: sourcesFor(tab).map(source => errors[source]).filter(Boolean).join(' '),
    refresh, retryFailed: () => Promise.all(sourcesFor(tab).filter(source => errors[source]).map(source => load(source, true))),
    loadMore: () => load('history', true, true), refreshTemplates: () => load('templates', true),
    afterDelivery, afterDevice, currentRequest,
  }
}
