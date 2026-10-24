import { useEffect } from 'react'
export default function Panel(props: { subject: string; subjectId: string; subjectName: string; focusSessionId: string; focusDate: string }) {
  useEffect(() => { (window as any).historyFixture.histories.push(props) }, [props.subject, props.subjectId])
  return <p data-testid="history-person">{props.subject}:{props.subjectId}:{props.subjectName}</p>
}
