const initial = (window as any).mapInitial || {}
const state = { configured: initial.configured !== false, hold: initial.hold === true, fail: initial.fail === true, rejectMarkers: initial.rejectMarkers === true, loaderCalls: 0,
  pending: [] as Array<() => void>, maps: [] as any[], markers: [] as any[] }
Object.assign(window, { mapsState: state })
class TestMap {
  record: any
  constructor(element: HTMLElement, options: any) {
    this.record = { id: state.maps.length + 1, center: options.center, zoom: options.zoom, pans: [], zoomChanges: [] }
    state.maps.push(this.record)
    const canvas = document.createElement('div')
    canvas.dataset.fakeGoogleCanvas = 'true'
    canvas.style.cssText = 'position:absolute;inset:0;background:#e2efea'
    element.appendChild(canvas)
  }
  panTo(value: any) { this.record.center = value; this.record.pans.push(value) }
  setZoom(value: number) { this.record.zoom = value; this.record.zoomChanges.push(value) }
}
class TestMarker {
  record: any
  constructor(options: any) {
    if (state.rejectMarkers) throw new Error('Synthetic marker initialization failure')
    this.record = { id: state.markers.length + 1, title: options.title, position: options.position, mapId: options.map?.record.id || null, moves: [] }
    state.markers.push(this.record)
  }
  setPosition(value: any) { this.record.position = value; this.record.moves.push(value) }
  setMap(map: TestMap | null) { this.record.mapId = map?.record.id || null }
}
export const googleMapsConfigured = () => state.configured
export async function loadGoogleMaps() {
  state.loaderCalls++
  if (state.hold) await new Promise<void>(resolve => state.pending.push(resolve))
  return state.fail ? null : { Map: TestMap, Marker: TestMarker }
}
