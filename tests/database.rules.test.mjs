import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { get, ref, set } from 'firebase/database'

const projectId = 'demo-aura-fitness-rtdb'
let environment

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    database: { rules: await readFile(new URL('../database.rules.json', import.meta.url), 'utf8') },
  })
})

after(async () => environment?.cleanup())

test('Realtime delivery locations deny direct browser reads and writes', async () => {
  const database = environment.authenticatedContext('shipper-1', { role: 'shipper' }).database()
  await assert.rejects(get(ref(database, 'eatCleanLiveLocations/order-1')))
  await assert.rejects(set(ref(database, 'eatCleanLiveLocations/order-1'), { latitude: 16.05, longitude: 108.2 }))
})
