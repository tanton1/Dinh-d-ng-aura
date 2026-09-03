import React, { useEffect, useId, useRef, useState } from 'react'
import {
  Bot,
  Camera,
  ChevronDown,
  ChevronUp,
  Database,
  HeartHandshake,
  ImagePlus,
  Loader2,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Trash2,
  Utensils,
  X,
} from 'lucide-react'
import {
  askAiCoachDetailed,
  getAiCoachOverview,
  uploadAiCoachPhoto,
  type AiCoachContextSnapshot,
  type AiCoachHistoryMessage,
  type AiCoachImageKind,
  type AiCoachLearningContext,
  type AiCoachSafetyLevel,
} from '../../services/nutritionService'
import { safeLocalStorageSet } from '../../lib/safeStorage'

interface AiCoachBottomSheetProps {
  onClose: () => void
  conversationScope?: string
  learningContext?: AiCoachLearningContext | null
}

interface ChatMessage extends AiCoachHistoryMessage {
  safetyLevel?: AiCoachSafetyLevel
  dataUsed?: string[]
  imagePreviewUrl?: string
  imageKind?: AiCoachImageKind
}

interface PendingCoachImage {
  file: File
  kind: AiCoachImageKind
  previewUrl: string
}

interface FailedCoachRequest {
  text: string
  attachment: PendingCoachImage | null
  clientTurnId: string
}

type QueuedCoachRequest = FailedCoachRequest

const DEFAULT_SUGGESTIONS = [
  'Hôm nay mình chỉ muốn tâm sự',
  'Mình đang mất động lực',
  'Xem tiến độ thật của mình',
  'Giúp mình chọn một bước nhỏ',
]

function createConversationId(scope: string) {
  const normalized = scope.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'progress'
  return `${normalized}-current`
}

function conversationStorageKey(scope: string) {
  return `aura:ai-health-coach:conversation:${scope.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)}`
}

function createClientTurnId() {
  if (typeof crypto.randomUUID === 'function') return `turn_${crypto.randomUUID()}`
  return `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`
}

function readConversationId(scope: string) {
  try {
    const saved = window.localStorage.getItem(conversationStorageKey(scope))
    if (saved && /^[A-Za-z0-9_-]{1,80}$/.test(saved)) return saved
  } catch {
    // Private browsing or storage policies may block persistence; chat still works for this session.
  }
  return createConversationId(scope)
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value)
}

function contextItems(context: AiCoachContextSnapshot) {
  return [
    context.goalLabel ? { label: 'Mục tiêu', value: context.goalLabel } : null,
    typeof context.latestWeightKg === 'number'
      ? { label: 'Cân gần nhất', value: `${context.latestWeightKg.toLocaleString('vi-VN')} kg` }
      : null,
    typeof context.todayCalories === 'number' && typeof context.calorieGoal === 'number'
      ? { label: 'Năng lượng hôm nay', value: `${formatNumber(context.todayCalories)} / ${formatNumber(context.calorieGoal)} kcal` }
      : null,
    typeof context.todayProteinG === 'number' && typeof context.proteinGoalG === 'number'
      ? { label: 'Đạm hôm nay', value: `${formatNumber(context.todayProteinG)} / ${formatNumber(context.proteinGoalG)}g` }
      : null,
    typeof context.loggedDays7 === 'number'
      ? { label: 'Nhật ký 7 ngày', value: `${context.loggedDays7}/7 ngày` }
      : null,
    typeof context.workoutDays7 === 'number'
      ? { label: 'Vận động 7 ngày', value: `${context.workoutDays7} ngày` }
      : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item))
}

export function AiCoachBottomSheet({ onClose, conversationScope = 'progress', learningContext }: AiCoachBottomSheetProps) {
  const titleId = useId()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const chatListRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const nextImageKindRef = useRef<AiCoachImageKind>('meal')
  const previewUrlsRef = useRef(new Set<string>())
  const [conversationId, setConversationId] = useState(() => readConversationId(conversationScope))
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [context, setContext] = useState<AiCoachContextSnapshot>({})
  const [dataUsed, setDataUsed] = useState<string[]>([])
  const [missingData, setMissingData] = useState<string[]>([])
  const [suggestions, setSuggestions] = useState(DEFAULT_SUGGESTIONS)
  const [inputVal, setInputVal] = useState('')
  const [loading, setLoading] = useState(false)
  const [initializing, setInitializing] = useState(true)
  const [error, setError] = useState('')
  const [failedRequest, setFailedRequest] = useState<FailedCoachRequest | null>(null)
  const [showContext, setShowContext] = useState(false)
  const [showImageMenu, setShowImageMenu] = useState(false)
  const [pendingImage, setPendingImage] = useState<PendingCoachImage | null>(null)
  const [queuedRequest, setQueuedRequest] = useState<QueuedCoachRequest | null>(null)

  const loadOverview = async (forceRefresh = false) => {
    setInitializing(true)
    setError('')
    setFailedRequest(null)
    try {
      const overview = await getAiCoachOverview(conversationId, { forceRefresh })
      setMessages((current) => [
        ...overview.history,
        ...current.filter((message) => message.id.startsWith('local-user-')),
      ])
      setContext(overview.context)
      setDataUsed(overview.dataUsed)
      setMissingData(overview.missingData)
      setSuggestions(overview.suggestedReplies.length ? overview.suggestedReplies : DEFAULT_SUGGESTIONS)
    } catch {
      setError('Chưa thể đồng bộ dữ liệu của bạn. Aura sẽ không tự đoán số liệu; hãy thử tải lại.')
    } finally {
      setInitializing(false)
    }
  }

  useEffect(() => {
    void loadOverview()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    const canAutoFocus = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const focusTimer = canAutoFocus
      ? window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 180)
      : null
    return () => {
      if (focusTimer !== null) window.clearTimeout(focusTimer)
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
      previewUrlsRef.current.clear()
    }
    // The sheet intentionally initializes one bounded conversation only once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const list = chatListRef.current
    if (!list) return
    const frame = window.requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight
    })
    return () => window.cancelAnimationFrame(frame)
  }, [messages, loading])

  useEffect(() => {
    if (initializing || !queuedRequest) return
    const queued = queuedRequest
    setQueuedRequest(null)
    void handleSend(queued.text, true, queued.attachment, queued.clientTurnId)
    // handleSend is intentionally invoked only when a queued initialization request becomes ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initializing, queuedRequest])

  const chooseImage = (kind: AiCoachImageKind) => {
    nextImageKindRef.current = kind
    setShowImageMenu(false)
    imageInputRef.current?.click()
  }

  const handleImageSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type.toLowerCase())) {
      setError('Aura chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP.')
      return
    }
    if (file.size <= 0 || file.size > 8 * 1024 * 1024) {
      setError('Ảnh cần có dung lượng từ 1 byte đến 8 MB.')
      return
    }
    if (pendingImage) {
      URL.revokeObjectURL(pendingImage.previewUrl)
      previewUrlsRef.current.delete(pendingImage.previewUrl)
    }
    const previewUrl = URL.createObjectURL(file)
    previewUrlsRef.current.add(previewUrl)
    setPendingImage({ file, kind: nextImageKindRef.current, previewUrl })
    setError('')
  }

  const removePendingImage = () => {
    if (pendingImage) {
      URL.revokeObjectURL(pendingImage.previewUrl)
      previewUrlsRef.current.delete(pendingImage.previewUrl)
    }
    setPendingImage(null)
  }

  const handleSend = async (
    textToSend?: string,
    retryExisting = false,
    attachmentOverride?: PendingCoachImage | null,
    clientTurnIdOverride?: string,
  ) => {
    const attachment = attachmentOverride === undefined ? pendingImage : attachmentOverride
    const text = (textToSend ?? inputVal).trim()
    if ((!text && !attachment) || loading || (queuedRequest && !retryExisting)) return
    const displayText = text || (attachment?.kind === 'body'
      ? 'Nhận xét vóc dáng hiện tại và gợi ý hướng cải thiện phù hợp với mình.'
      : 'Phân tích món ăn này và tư vấn theo mục tiêu hiện tại của mình.')
    const clientTurnId = clientTurnIdOverride || createClientTurnId()

    const userMessage: ChatMessage = {
      id: `local-user-${Date.now()}`,
      sender: 'user',
      text: displayText,
      imagePreviewUrl: attachment?.previewUrl,
      imageKind: attachment?.kind,
    }
    if (!retryExisting) setMessages((current) => [...current, userMessage])
    setInputVal('')
    if (!retryExisting) setPendingImage(null)
    if (initializing) {
      setQueuedRequest({ text, attachment: attachment ?? null, clientTurnId })
      setError('')
      return
    }
    setLoading(true)
    setError('')
    setFailedRequest(null)
    setQueuedRequest(null)

    try {
      const uploadedAttachment = attachment
        ? await uploadAiCoachPhoto(attachment.file, attachment.kind)
        : null
      const response = await askAiCoachDetailed(text, conversationId, uploadedAttachment, clientTurnId, learningContext)
      setMessages((current) => [...current, {
        id: `local-ai-${Date.now()}`,
        sender: 'ai',
        text: response.text,
        safetyLevel: response.safetyLevel,
        dataUsed: response.dataUsed,
      }])
      setDataUsed(response.dataUsed)
      setMissingData(response.missingData)
      if (response.suggestedReplies.length) setSuggestions(response.suggestedReplies)
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message.trim() : ''
      setError(message && !/^(internal|unknown)$/i.test(message)
        ? message
        : 'Aura chưa thể trả lời lúc này. Câu hỏi và ảnh của bạn vẫn ở đây để thử lại.')
      setFailedRequest({ text, attachment: attachment ?? null, clientTurnId })
    } finally {
      setLoading(false)
      inputRef.current?.focus({ preventScroll: true })
    }
  }

  const startNewConversation = () => {
    const nextConversationId = `${conversationScope.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 22) || 'progress'}-${Date.now().toString(36)}`
    safeLocalStorageSet(conversationStorageKey(conversationScope), nextConversationId)
    setConversationId(nextConversationId)
    setMessages([])
    setSuggestions(DEFAULT_SUGGESTIONS)
    setInputVal('')
    setError('')
    setFailedRequest(null)
    setQueuedRequest(null)
    removePendingImage()
    inputRef.current?.focus({ preventScroll: true })
  }

  const knownContext = contextItems(context)
  const greeting = knownContext.length
    ? 'Mình đã xem dữ liệu Aura đang có về bạn. Hôm nay bạn muốn mình lắng nghe, cùng nhìn lại tiến độ, hay tìm một việc nhỏ dễ làm?'
    : 'Mình chưa có đủ dữ liệu để hiểu chính xác hành trình của bạn, nhưng mình vẫn có thể lắng nghe. Hôm nay bạn đang cảm thấy thế nào?'

  return (
    <div className="pg-modal-backdrop pg-coach-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        className="pg-modal-sheet pg-coach-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="pg-modal-header pg-coach-header">
          <div className="pg-coach-heading">
            <div className="pg-ai-robot-badge pg-coach-avatar"><Bot size={22} /></div>
            <div>
              <h2 id={titleId}>Aura Health Coach</h2>
              <span><HeartHandshake size={13} /> Chuyên gia dinh dưỡng AI đồng hành cùng bạn</span>
            </div>
          </div>
          <div className="pg-coach-header-actions">
            <button type="button" className="pg-coach-icon-btn" onClick={startNewConversation} aria-label="Bắt đầu cuộc trò chuyện mới" title="Cuộc trò chuyện mới">
              <RotateCcw size={17} />
            </button>
            <button type="button" onClick={onClose} className="pg-modal-close-btn" aria-label="Đóng AI Health Coach">
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="pg-coach-safety-note">
          <ShieldCheck size={16} />
          <span>Aura hỗ trợ dinh dưỡng và vóc dáng, không chẩn đoán hay thay thế chuyên gia y tế. Ảnh chỉ được gửi cho AI khi bạn nhấn Gửi và tự xoá khỏi hệ thống ngay sau lần phân tích.</span>
        </div>

        <button type="button" className="pg-coach-context-toggle" onClick={() => setShowContext((current) => !current)} aria-expanded={showContext}>
          <span><Database size={16} /> Aura đang hiểu gì về bạn</span>
          {showContext ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
        </button>

        {showContext && (
          <div className="pg-coach-context-panel">
            {knownContext.length ? (
              <div className="pg-coach-context-grid">
                {knownContext.map((item) => (
                  <div key={item.label} className="pg-coach-context-item">
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
            ) : <p>Chưa có chỉ số đủ tin cậy để hiển thị.</p>}
            {dataUsed.length > 0 && <p><strong>Dữ liệu đang dùng:</strong> {dataUsed.join(' · ')}</p>}
            {missingData.length > 0 && <p className="pg-coach-missing"><strong>Có thể bổ sung:</strong> {missingData.join(' · ')}</p>}
          </div>
        )}

        <div ref={chatListRef} className="pg-coach-chat-list" aria-live="polite" aria-busy={loading || initializing}>
          {messages.length === 0 && (
            <div className="pg-coach-msg ai pg-coach-greeting">{greeting}</div>
          )}
          {messages.map((message) => (
            <div key={message.id} className={`pg-coach-msg ${message.sender}${message.safetyLevel === 'urgent' ? ' urgent' : ''}`}>
              {message.imagePreviewUrl && (
                <div className="pg-coach-msg-image">
                  <img src={message.imagePreviewUrl} alt={message.imageKind === 'body' ? 'Ảnh vóc dáng đã gửi' : 'Ảnh món ăn đã gửi'} />
                  <span>{message.imageKind === 'body' ? <><Camera size={13} /> Vóc dáng</> : <><Utensils size={13} /> Món ăn</>}</span>
                </div>
              )}
              {message.text}
              {message.sender === 'ai' && message.dataUsed && message.dataUsed.length > 0 && (
                <small>Dựa trên: {message.dataUsed.slice(0, 3).join(' · ')}</small>
              )}
            </div>
          ))}
          {(initializing || loading) && (
            <div className="pg-coach-msg ai pg-coach-typing" role="status">
              <Loader2 className="spin" size={16} />
              <span>{queuedRequest
                ? 'Đã giữ câu hỏi của bạn · Aura sẽ gửi ngay khi dữ liệu sẵn sàng…'
                : initializing
                  ? 'Đang đọc dữ liệu bạn đã cho phép Aura lưu…'
                  : 'Đang lắng nghe và đối chiếu dữ liệu của bạn…'}</span>
            </div>
          )}
        </div>

        {error && (
          <div className="pg-coach-error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => failedRequest
                ? void handleSend(failedRequest.text, true, failedRequest.attachment, failedRequest.clientTurnId)
                : void loadOverview(true)}
              disabled={initializing || loading}
            >
              <RefreshCw size={15} /> {failedRequest ? 'Thử lại' : 'Tải lại'}
            </button>
          </div>
        )}

        <div className="pg-coach-chips" aria-label="Gợi ý trò chuyện">
          {suggestions.slice(0, 4).map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => void handleSend(suggestion)} className="pg-coach-chip" disabled={loading || Boolean(queuedRequest)}>
              {suggestion}
            </button>
          ))}
        </div>

        {pendingImage && (
          <div className="pg-coach-pending-image">
            <img src={pendingImage.previewUrl} alt={pendingImage.kind === 'body' ? 'Ảnh vóc dáng chờ gửi' : 'Ảnh món ăn chờ gửi'} />
            <div>
              <strong>{pendingImage.kind === 'body' ? 'Ảnh vóc dáng' : 'Ảnh món ăn'}</strong>
              <span>Chỉ dùng cho câu trả lời này · tự xoá sau phân tích</span>
            </div>
            <button type="button" onClick={removePendingImage} aria-label="Bỏ ảnh đã chọn"><Trash2 size={17} /></button>
          </div>
        )}

        {showImageMenu && (
          <div className="pg-coach-image-menu" role="group" aria-label="Chọn loại ảnh cần tư vấn">
            <button type="button" onClick={() => chooseImage('body')}><Camera size={18} /><span><strong>Ảnh vóc dáng</strong><small>Tư thế, tỷ lệ và hướng cải thiện</small></span></button>
            <button type="button" onClick={() => chooseImage('meal')}><Utensils size={18} /><span><strong>Ảnh món ăn</strong><small>Khẩu phần và dinh dưỡng phù hợp</small></span></button>
          </div>
        )}

        <div className="pg-coach-composer">
          <input
            ref={imageInputRef}
            className="pg-coach-file-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleImageSelected}
            tabIndex={-1}
            aria-hidden="true"
          />
          <button
            type="button"
            className="pg-coach-attach-btn"
            disabled={loading}
            onClick={() => setShowImageMenu((current) => !current)}
            aria-label="Thêm ảnh để Aura tư vấn"
            aria-expanded={showImageMenu}
          >
            <ImagePlus size={20} />
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            maxLength={3000}
            placeholder={pendingImage ? 'Mô tả điều bạn muốn Aura tư vấn (không bắt buộc)…' : 'Bạn có thể hỏi hoặc gửi ảnh cho Aura…'}
            value={inputVal}
            disabled={loading}
            onChange={(event) => setInputVal(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void handleSend()
              }
            }}
          />
          <button type="button" className="pg-coach-send-btn" disabled={loading || Boolean(queuedRequest) || (!inputVal.trim() && !pendingImage)} onClick={() => void handleSend()} aria-label="Gửi tin nhắn cho Aura Health Coach">
            {loading ? <Loader2 className="spin" size={19} /> : <Send size={19} />}
          </button>
        </div>
      </section>
    </div>
  )
}
