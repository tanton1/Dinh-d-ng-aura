import { useEffect } from 'react'
import { state } from './mocks'
export default function ContractWorkspace({ studentId, onChanged }: { studentId: string; onChanged: () => Promise<void> }) {
  useEffect(() => { state.contractCallbacks.push(onChanged) }, [onChanged])
  return <button onClick={() => void onChanged()}>Fixture contract saved for {studentId}</button>
}
