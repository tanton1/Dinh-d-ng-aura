import { useState } from 'react'
import { useAdminSections } from '../../src/features/eat-clean/admin/useAdminSections'
import type { EatCleanAdminSection } from '../../src/features/eat-clean/admin/types'
const scopes: Record<string, readonly EatCleanAdminSection[]> = { menu: ['meals', 'config'], inventory: ['inventory', 'meals', 'config'], orders: ['orders', 'config'] }
export function AdminSectionsHarness() {
  const [scope, setScope] = useState('menu')
  const value = useAdminSections(scopes[scope], true, false)
  return <>
    <output aria-label="Section state">{JSON.stringify({ data: value.data, ready: value.ready, loading: value.loading, refreshing: value.refreshing, error: value.error })}</output>
    {Object.keys(scopes).map(name => <button key={name} onClick={() => setScope(name)}>{name}</button>)}
    <button onClick={() => void value.refresh()}>Refresh sections</button>
    <button onClick={() => value.patch(['meals'], data => ({ ...data, seeded: true, meals: data.meals.map(meal => ({ ...meal, name: 'Saved meal' })) }))}>Apply committed meal</button>
    <button onClick={() => value.invalidate(['inventory'])}>Invalidate stock</button>
    <button onClick={() => value.patch(['inventory'], data => ({ ...data, inventory: data.inventory.map(item => ({ ...item, capacity: 9 })) }))}>Apply committed stock</button>
  </>
}
