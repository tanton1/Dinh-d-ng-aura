import { useEffect } from 'react'
export default function Requests({ kind }: { kind: string }) {
  useEffect(() => { (window as any).historyFixture.requests.push(kind) }, [kind])
  return <p data-testid="request-kind">{kind}</p>
}
