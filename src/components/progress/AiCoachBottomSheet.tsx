import React, { useEffect, useId, useRef, useState } from 'react'
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Database,
  HeartHandshake,
  Loader2,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react'
import {
  askAiCoachDetailed,
  getAiCoachOverview,
  type AiCoachContextSnapshot,
  type AiCoachHistoryMessage,
  type AiCoachSafetyLevel,
} from '../../services/nutritionService'
import { safeLocalStorageSet } from '../../lib/safeStorage'

interface AiCoachBottomSheetProps {
  onClose: () => void
  conversationScope?: string
}

interface ChatMessage extends AiCoachHistoryMessage {
  safetyLevel?: AiCoachSafetyLevel
  dataUsed?: string[]
}

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

export function AiCoachBottomSheet({ onClose, conversationScope = 'progress' }: AiCoachBottomSheetProps) {
  const titleId = useId()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
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
  const [failedMessage, setFailedMessage] = useState('')
  const [showContext, setShowContext] = useState(false)

  const loadOverview = async () => {
    setInitializing(true)
    setError('')
    setFailedMessage('')
    try {
      const overview = await getAiCoachOverview(conversationId)
      setMessages(overview.history)
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
    window.setTimeout(() => inputRef.current?.focus(), 150)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
    // The sheet intentionally initializes one bounded conversation only once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, loading])

  const handleSend = async (textToSend?: string, retryExisting = false) => {
    const text = (textToSend ?? inputVal).trim()
    if (!text || loading || initializing) return

    const userMessage: ChatMessage = {
      id: `local-user-${Date.now()}`,
      sender: 'user',
      text,
    }
    if (!retryExisting) setMessages((current) => [...current, userMessage])
    setInputVal('')
    setLoading(true)
    setError('')
    setFailedMessage('')

    try {
      const response = await askAiCoachDetailed(text, conversationId)
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
    } catch {
      setError('Aura chưa thể trả lời lúc này. Câu hỏi của bạn vẫn ở đây để thử lại.')
      setFailedMessage(text)
    } finally {
      setLoading(false)
      inputRef.current?.focus()
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
    setFailedMessage('')
    inputRef.current?.focus()
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
          <span>Aura hỗ trợ dinh dưỡng và thói quen, không chẩn đoán hay thay thế bác sĩ/chuyên gia y tế. Khi nhấn Gửi, bạn đồng ý để Aura dùng phần dữ liệu sức khỏe liên quan cho câu trả lời; hệ thống không gửi email, số điện thoại hoặc ảnh.</span>
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

        <div className="pg-coach-chat-list" aria-live="polite" aria-busy={loading || initializing}>
          {!initializing && messages.length === 0 && (
            <div className="pg-coach-msg ai pg-coach-greeting">{greeting}</div>
          )}
          {messages.map((message) => (
            <div key={message.id} className={`pg-coach-msg ${message.sender}${message.safetyLevel === 'urgent' ? ' urgent' : ''}`}>
              {message.text}
              {message.sender === 'ai' && message.dataUsed && message.dataUsed.length > 0 && (
                <small>Dựa trên: {message.dataUsed.slice(0, 3).join(' · ')}</small>
              )}
            </div>
          ))}
          {(initializing || loading) && (
            <div className="pg-coach-msg ai pg-coach-typing" role="status">
              <Loader2 className="spin" size={16} />
              <span>{initializing ? 'Đang đọc dữ liệu bạn đã cho phép Aura lưu…' : 'Đang lắng nghe và đối chiếu dữ liệu của bạn…'}</span>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {error && (
          <div className="pg-coach-error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => failedMessage ? void handleSend(failedMessage, true) : void loadOverview()}
              disabled={initializing || loading}
            >
              <RefreshCw size={15} /> {failedMessage ? 'Thử lại' : 'Tải lại'}
            </button>
          </div>
        )}

        <div className="pg-coach-chips" aria-label="Gợi ý trò chuyện">
          {suggestions.slice(0, 4).map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => void handleSend(suggestion)} className="pg-coach-chip" disabled={loading || initializing}>
              {suggestion}
            </button>
          ))}
        </div>

        <div className="pg-coach-composer">
          <textarea
            ref={inputRef}
            rows={1}
            maxLength={3000}
            placeholder="Bạn có thể hỏi hoặc tâm sự với Aura…"
            value={inputVal}
            disabled={loading || initializing}
            onChange={(event) => setInputVal(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void handleSend()
              }
            }}
          />
          <button type="button" disabled={loading || initializing || !inputVal.trim()} onClick={() => void handleSend()} aria-label="Gửi tin nhắn cho Aura Health Coach">
            {loading ? <Loader2 className="spin" size={19} /> : <Send size={19} />}
          </button>
        </div>
      </section>
    </div>
  )
}
