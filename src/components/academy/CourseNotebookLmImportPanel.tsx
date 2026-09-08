import { useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileArchive, FileQuestion, FileSpreadsheet, FileText, LoaderCircle, Upload, Video, X } from 'lucide-react'
import {
  importPreviewHasErrors,
  parseNotebookLmFiles,
  type NotebookLmImportMode,
  type NotebookLmImportPreview,
} from '../../services/courseNotebookLmImportService'

interface CourseNotebookLmImportPanelProps {
  disabled?: boolean
  onImport: (preview: NotebookLmImportPreview, mode: NotebookLmImportMode) => Promise<void>
}

const accepted = '.json,.csv,.pdf,.ppt,.pptx,.mp4,.webm,.ogg,.mov,.doc,.docx,.txt'

export default function CourseNotebookLmImportPanel({ disabled = false, onImport }: CourseNotebookLmImportPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<NotebookLmImportPreview | null>(null)
  const [reading, setReading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [mode, setMode] = useState<NotebookLmImportMode>('append')
  const [open, setOpen] = useState(false)

  const chooseFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setReading(true)
    setPreview(null)
    try {
      setPreview(await parseNotebookLmFiles(files))
    } finally {
      setReading(false)
    }
  }

  const importContent = async () => {
    if (!preview || importPreviewHasErrors(preview)) return
    setImporting(true)
    try {
      await onImport(preview, mode)
      setPreview(null)
      setOpen(false)
      if (inputRef.current) inputRef.current.value = ''
    } finally {
      setImporting(false)
    }
  }

  return (
    <section className={`notebooklm-import-panel ${open ? 'is-open' : ''}`} aria-labelledby="notebooklm-import-title">
      <div className="notebooklm-import-head">
        <div className="notebooklm-import-mark" aria-hidden="true"><FileArchive size={18} /></div>
        <div>
          <strong id="notebooklm-import-title">Nhập nội dung NotebookLM</strong>
          <p>Đưa slide, video, flashcard và quiz vào bài đang chọn dưới dạng bản nháp.</p>
        </div>
        <button type="button" className="outline-button small" onClick={() => setOpen((value) => !value)} aria-expanded={open} disabled={disabled}>
          {open ? 'Thu gọn' : 'Mở nhập nội dung'}
        </button>
      </div>
      {open && (
        <div className="notebooklm-import-body">
          <div className="notebooklm-import-dropzone">
            <input ref={inputRef} type="file" multiple accept={accepted} onChange={(event) => void chooseFiles(event.target.files)} disabled={disabled || reading || importing} />
            <Upload size={20} />
            <strong>{reading ? 'Đang đọc file…' : 'Chọn các file đã xuất từ NotebookLM'}</strong>
            <span>manifest.json · flashcards.csv · quiz.json · PDF/PPTX · MP4</span>
          </div>
          {preview && (
            <div className="notebooklm-import-preview">
              <div className="notebooklm-import-summary">
                <span><FileText size={14} /> {preview.counts.files} file</span>
                <span><FileSpreadsheet size={14} /> {preview.counts.flashcards} flashcard</span>
                <span><FileQuestion size={14} /> {preview.counts.quizQuestions} câu hỏi</span>
                <span><Video size={14} /> {preview.counts.media} học liệu</span>
              </div>
              {(preview.manifest?.chapterTitle || preview.manifest?.lessonTitle || preview.manifest?.sourceUrl) && (
                <div className="notebooklm-import-manifest">
                  <strong>{preview.manifest.lessonTitle || 'Nội dung NotebookLM'}</strong>
                  <span>{preview.manifest.chapterTitle || 'Chương đang chọn'}{preview.manifest.sourceUrl ? ` · ${preview.manifest.sourceUrl}` : ''}</span>
                </div>
              )}
              {preview.issues.length > 0 && (
                <div className="notebooklm-import-issues" role="status">
                  {preview.issues.map((issue, index) => (
                    <div key={`${issue.file}-${issue.row ?? 0}-${index}`} className={issue.level === 'error' ? 'is-error' : 'is-warning'}>
                      {issue.level === 'error' ? <AlertTriangle size={14} /> : <X size={14} />}
                      <span>{issue.file}{issue.row ? ` · dòng ${issue.row}` : ''}: {issue.message}</span>
                    </div>
                  ))}
                </div>
              )}
              {!importPreviewHasErrors(preview) && (
                <div className="notebooklm-import-actions">
                  <label><span>Cách nhập</span><select value={mode} onChange={(event) => setMode(event.target.value as NotebookLmImportMode)} disabled={importing}>
                    <option value="append">Bổ sung vào nội dung hiện có</option>
                    <option value="replace">Thay nội dung cùng loại</option>
                    <option value="new-lesson">Tạo bài học mới trong chương</option>
                  </select></label>
                  <button type="button" className="primary-button" onClick={() => void importContent()} disabled={disabled || importing}>
                    {importing ? <LoaderCircle size={16} className="spin" /> : <CheckCircle2 size={16} />} {importing ? 'Đang nhập…' : 'Nhập vào bản nháp'}
                  </button>
                </div>
              )}
            </div>
          )}
          <small className="notebooklm-import-note">Không ghi đè bản đã xuất bản. File video/slide sẽ được tải vào Firebase Storage khi khóa học đang dùng Firebase.</small>
        </div>
      )}
    </section>
  )
}
