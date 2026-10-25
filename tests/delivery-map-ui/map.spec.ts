import { expect, test, type Page } from '@playwright/test'
async function start(page: Page, initial = {}) {
  await page.addInitScript(value => { (window as any).mapInitial = value }, initial)
  await page.goto('/tests/delivery-map-ui/index.html')
  await page.waitForFunction(() => Boolean((window as any).mapHarness))
}
const snapshot = (page: Page) => page.evaluate(() => {
  const state = (window as any).mapsState
  return { maps: state.maps, markers: state.markers, calls: state.loaderCalls }
})

test('twenty distinct GPS updates keep one map and three markers without resetting zoom', async ({ page }) => {
  await start(page)
  await expect.poll(async () => (await snapshot(page)).maps.length).toBe(1)
  await page.evaluate(() => { (window as any).mapsState.maps[0].zoom = 9 })
  for (let n = 1; n <= 20; n++) {
    const latitude = 16.03 + n / 1000
    await page.evaluate(latitude => (window as any).mapHarness.patch({ shipperLocation: { latitude, longitude: 108.03 } }), latitude)
    await expect.poll(async () => (await snapshot(page)).markers.find((m: any) => m.title === 'Shipper').position.lat).toBe(latitude)
  }
  const value = await snapshot(page)
  expect(value.maps).toHaveLength(1); expect(value.markers).toHaveLength(3)
  expect(value.maps[0].zoom).toBe(9); expect(value.maps[0].zoomChanges).toHaveLength(0)
  expect(value.markers.filter((m: any) => m.title !== 'Shipper').every((m: any) => m.moves.length === 0)).toBe(true)
  await page.evaluate(() => (window as any).mapHarness.patch({}))
  expect((await snapshot(page)).markers.find((m: any) => m.title === 'Shipper').moves).toHaveLength(20)
})

test('new orders and missing positions remove old markers while keeping the map instance', async ({ page }) => {
  await start(page)
  await expect.poll(async () => (await snapshot(page)).maps.length).toBe(1)
  await page.evaluate(() => (window as any).mapHarness.replace({ orderId: 'order-b', status: 'assigned', destination: { latitude: 17, longitude: 109 } }))
  await expect.poll(async () => (await snapshot(page)).markers.filter((m: any) => m.mapId !== null).map((m: any) => m.title)).toEqual(['Điểm nhận hàng'])
  expect((await snapshot(page)).maps[0].center).toEqual({ lat: 17, lng: 109 })
  await page.evaluate(() => (window as any).mapHarness.patch({ destination: undefined }))
  await expect(page.getByText('Chưa có vị trí shipper')).toBeVisible()
  expect((await snapshot(page)).markers.filter((m: any) => m.mapId !== null)).toHaveLength(0)
  await page.evaluate(() => (window as any).mapHarness.patch({ shipperLocation: { latitude: 17.1, longitude: 109.1 } }))
  await expect(page.getByLabel('Bản đồ giao hàng')).toBeVisible()
  expect((await snapshot(page)).maps).toHaveLength(1)
  expect((await snapshot(page)).maps[0].center).toEqual({ lat: 17.1, lng: 109.1 })
})

test('a delayed SDK uses the latest order and ignores an unmounted view', async ({ page }) => {
  await start(page, { hold: true })
  await page.evaluate(() => (window as any).mapHarness.replace({ orderId: 'order-b', status: 'delivering', shipperLocation: { latitude: 18, longitude: 110 } }))
  await expect(page.getByLabel('Fixture order')).toHaveText('order-b')
  await page.evaluate(() => { const s = (window as any).mapsState; s.hold = false; s.pending.splice(0).forEach((resolve: () => void) => resolve()) })
  await expect.poll(async () => (await snapshot(page)).maps.length).toBe(1)
  const value = await snapshot(page)
  expect(value.maps[0].center).toEqual({ lat: 18, lng: 110 }); expect(value.markers).toHaveLength(1)
  await page.evaluate(() => (window as any).mapHarness.show(false))
  await expect(page.getByLabel('Bản đồ giao hàng')).toHaveCount(0)
  expect((await snapshot(page)).markers.every((m: any) => m.mapId === null)).toBe(true)
})

test('unmount before SDK completion creates no map', async ({ page }) => {
  await start(page, { hold: true })
  await page.evaluate(() => (window as any).mapHarness.show(false))
  await expect(page.getByLabel('Bản đồ giao hàng')).toHaveCount(0)
  await page.evaluate(() => { const s = (window as any).mapsState; s.hold = false; s.pending.splice(0).forEach((resolve: () => void) => resolve()) })
  expect((await snapshot(page)).maps).toHaveLength(0)
})

test('unconfigured or invalid coordinates do not load the SDK', async ({ page }) => {
  await start(page, { configured: false })
  await expect(page.getByText('Bản đồ trực quan sẽ hiện khi Google Maps được cấu hình.')).toBeVisible()
  expect((await snapshot(page)).calls).toBe(0)
  await page.evaluate(() => { (window as any).mapsState.configured = true; (window as any).mapHarness.replace({ orderId: 'invalid', status: 'assigned', destination: { latitude: 91, longitude: 108 } }) })
  await expect(page.getByText('Chưa có vị trí shipper')).toBeVisible()
  expect((await snapshot(page)).calls).toBe(0)
  await page.evaluate(() => (window as any).mapHarness.patch({ destination: { latitude: 16, longitude: 108 } }))
  await expect.poll(async () => (await snapshot(page)).maps.length).toBe(1)
})

test('SDK failure waits for an explicit retry instead of retrying on every location update', async ({ page }) => {
  await start(page, { fail: true })
  await expect(page.getByRole('button', { name: 'Thử lại bản đồ' })).toBeVisible()
  const before = (await snapshot(page)).calls
  for (let n = 0; n < 5; n++) await page.evaluate(latitude => (window as any).mapHarness.patch({ shipperLocation: { latitude, longitude: 108 } }), 16 + n / 100)
  expect((await snapshot(page)).calls).toBe(before)
  await page.evaluate(() => { (window as any).mapsState.fail = false })
  await page.getByRole('button', { name: 'Thử lại bản đồ' }).click()
  await expect.poll(async () => (await snapshot(page)).maps.length).toBe(1)
  await expect(page.getByRole('button', { name: 'Thử lại bản đồ' })).toBeHidden()
})

test('the SDK canvas fills the map without inheriting fallback text padding', async ({ page }) => {
  await start(page)
  await expect.poll(async () => (await snapshot(page)).maps.length).toBe(1)
  const outer = await page.locator('.eat-clean-tracking-map').boundingBox()
  const canvas = await page.getByLabel('Bản đồ giao hàng').boundingBox()
  const google = await page.locator('[data-fake-google-canvas]').boundingBox()
  expect(outer).not.toBeNull(); expect(canvas).not.toBeNull(); expect(google).not.toBeNull()
  expect(canvas!.width).toBeCloseTo(outer!.width, 0); expect(canvas!.height).toBeGreaterThanOrEqual(300)
  expect(google!.width).toBeCloseTo(canvas!.width, 0); expect(google!.height).toBeCloseTo(canvas!.height, 0)
})

test('partial SDK initialization is cleaned before an explicit recovery', async ({ page }) => {
  await start(page, { rejectMarkers: true })
  await expect(page.getByRole('button', { name: 'Thử lại bản đồ' })).toBeVisible()
  expect((await snapshot(page)).maps).toHaveLength(1)
  await expect(page.locator('[data-fake-google-canvas]')).toHaveCount(0)
  await page.evaluate(() => { (window as any).mapsState.rejectMarkers = false })
  await page.getByRole('button', { name: 'Thử lại bản đồ' }).click()
  await expect.poll(async () => (await snapshot(page)).markers.length).toBe(3)
  expect((await snapshot(page)).maps).toHaveLength(2)
  await expect(page.locator('[data-fake-google-canvas]')).toHaveCount(1)
})
