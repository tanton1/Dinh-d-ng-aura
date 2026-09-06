import { AlertCircle, RefreshCw } from 'lucide-react'
import { courseLoadErrorMessage } from '../../features/academy/courseLoadError'
import './academy-load-error.css'

export default function AcademyLoadError({ error, onRetry, onBack }: { error: unknown; onRetry?: () => void; onBack?: () => void }) {
  return <div className="course-detail-state academy-load-error" role="alert">
    <AlertCircle size={30} />
    <h1>Chưa tải được khóa học</h1>
    <p>{courseLoadErrorMessage(error)}</p>
    <div className="academy-load-error__actions">
      {onRetry ? <button type="button" className="primary-button" onClick={onRetry}><RefreshCw size={16} /> Thử lại</button> : null}
      {onBack ? <button type="button" className="outline-button" onClick={onBack}>Về thư viện</button> : null}
    </div>
  </div>
}
