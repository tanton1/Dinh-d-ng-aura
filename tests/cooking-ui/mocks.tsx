// Keep this fixture disconnected from member data and network services.
export default function NotificationCenter() { return null }
export function useAuraUiSurface() { return !new URLSearchParams(location.search).has('legacy') }
export function prefetchRoute() {}
