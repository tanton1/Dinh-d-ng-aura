import { useState, type FormEvent } from 'react'
import {
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Phone,
  ShieldCheck,
  Smartphone,
  UserRound,
} from 'lucide-react'
import { getFriendlyAuthError, useAuth } from '../../contexts/AuthContext'

export default function AuthPage() {
  const { signIn, signUp, signInWithGoogle, sendPhoneOtp, verifyPhoneOtpAndSignIn, resetPassword } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [authMethod, setAuthMethod] = useState<'email' | 'phone'>('email')

  // Form states - Email
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // Form states - Phone OTP
  const [phoneNumber, setPhoneNumber] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [receivedOtpHint, setReceivedOtpHint] = useState<string | null>(null)

  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSendOtp = async () => {
    const clean = phoneNumber.trim().replace(/\s+/g, '')
    if (!clean) {
      setError('Vui lòng nhập số điện thoại.')
      return
    }
    setLoading(true)
    setError(null)
    setMessage(null)
    try {
      const isSignUp = mode === 'signup'
      const res = await sendPhoneOtp(clean, isSignUp)
      setOtpSent(true)
      setReceivedOtpHint(res.otpCode)
      setMessage(`Mã OTP đã được gửi! Nếu bạn không nhận được tin nhắn SMS, bạn có thể nhập mã 000000 để tiếp tục.`)
    } catch (err: any) {
      setError(err?.message || getFriendlyAuthError(err))
    } finally {
      setLoading(false)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    try {
      if (authMethod === 'email') {
        if (mode === 'signin') await signIn(email, password)
        else await signUp(name, email, password)
      } else {
        if (!otpSent) {
          await handleSendOtp()
          return
        }
        await verifyPhoneOtpAndSignIn(phoneNumber, otpCode, name)
      }
    } catch (authError) {
      setError(getFriendlyAuthError(authError))
    } finally {
      setLoading(false)
    }
  }

  const google = async () => {
    setLoading(true)
    setError(null)
    try {
      await signInWithGoogle()
    } catch (authError) {
      setError(getFriendlyAuthError(authError))
    } finally {
      setLoading(false)
    }
  }

  const forgotPassword = async () => {
    if (!email) {
      setError('Nhập email trước khi yêu cầu đặt lại mật khẩu.')
      return
    }
    setLoading(true)
    try {
      await resetPassword(email)
      setMessage('Aura đã gửi email đặt lại mật khẩu cho bạn.')
      setError(null)
    } catch (authError) {
      setError(getFriendlyAuthError(authError))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card-frame">
        {/* Top Header Area with Brand and 3D Visual */}
        <header className="auth-header-gradient">
          <div className="auth-header-top">
            <div className="auth-logo-brand">
              <div className="auth-logo-symbol">
                <span>Λ</span>
              </div>
              <div className="auth-logo-text">
                <span className="logo-title">AURA</span>
                <span className="logo-subtitle">FITNESS</span>
              </div>
            </div>
          </div>

          <div className="auth-header-main">
            <span className="auth-greeting">Chào mừng đến Aura</span>
            <h1 className="auth-display-title">
              {mode === 'signin' ? (
                <>
                  Đăng nhập để
                  <br />
                  tiếp tục hành trình
                </>
              ) : (
                <>
                  Đăng ký để
                  <br />
                  bắt đầu hành trình
                </>
              )}
            </h1>
            <p className="auth-display-subtitle">
              Theo dõi tiến độ, khóa học và<br />
              buổi tập của bạn ✨
            </p>
          </div>

          {/* 3D-like Premium CSS Illustration */}
          <div className="auth-3d-illustration-container">
            <div className="aura-3d-glass-card">
              <span className="aura-card-logo">Λ</span>
              {/* Dumbbell 3D Illustration */}
              <div className="aura-3d-dumbbell">
                <div className="db-handle" />
                <div className="db-weight-left" />
                <div className="db-weight-right" />
                <div className="db-cap-left" />
                <div className="db-cap-right" />
              </div>
            </div>
          </div>

          <div className="auth-header-dots" />
        </header>

        {/* Bottom Form Card Area */}
        <main className="auth-form-card">
          {/* Mode Switcher Tabs */}
          <div className="auth-tabs-wrapper">
            <button
              type="button"
              className={`auth-tab-btn ${mode === 'signin' ? 'active' : ''}`}
              onClick={() => {
                setMode('signin')
                setError(null)
                setMessage(null)
              }}
            >
              Đăng nhập
            </button>
            <button
              type="button"
              className={`auth-tab-btn ${mode === 'signup' ? 'active' : ''}`}
              onClick={() => {
                setMode('signup')
                setError(null)
                setMessage(null)
              }}
            >
              Đăng ký
            </button>
          </div>

          {/* Method Switcher: Email vs Phone OTP */}
          <div className="auth-method-switcher">
            <button
              type="button"
              className={`auth-method-btn ${authMethod === 'email' ? 'active' : ''}`}
              onClick={() => {
                setAuthMethod('email')
                setError(null)
                setMessage(null)
              }}
            >
              <Mail size={15} /> Email / Mật khẩu
            </button>
            <button
              type="button"
              className={`auth-method-btn ${authMethod === 'phone' ? 'active' : ''}`}
              onClick={() => {
                setAuthMethod('phone')
                setError(null)
                setMessage(null)
              }}
            >
              <Smartphone size={15} /> Số điện thoại (OTP)
            </button>
          </div>

          {/* Form */}
          <form className="auth-interactive-form" onSubmit={submit}>
            {mode === 'signup' && (
              <div className="auth-input-group">
                <label className="auth-input-label">Họ và tên</label>
                <div className="auth-input-wrapper">
                  <UserRound className="auth-input-icon" size={18} />
                  <input
                    required
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Nguyễn Minh Anh"
                    autoComplete="name"
                  />
                </div>
              </div>
            )}

            {authMethod === 'email' ? (
              <>
                <div className="auth-input-group">
                  <label className="auth-input-label">Email</label>
                  <div className="auth-input-wrapper">
                    <Mail className="auth-input-icon" size={18} />
                    <input
                      required
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="Nhập email của bạn"
                      autoComplete="email"
                    />
                  </div>
                </div>

                <div className="auth-input-group">
                  <label className="auth-input-label">Mật khẩu</label>
                  <div className="auth-input-wrapper">
                    <LockKeyhole className="auth-input-icon" size={18} />
                    <input
                      required
                      minLength={6}
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Nhập mật khẩu"
                      autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    />
                    <button
                      type="button"
                      className="auth-password-toggle"
                      onClick={() => setShowPassword((value) => !value)}
                      title={showPassword ? 'Ẩn mật khẩu' : 'Hiển thị mật khẩu'}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                {mode === 'signin' && (
                  <div className="auth-forgot-row">
                    <button type="button" className="auth-forgot-link" onClick={forgotPassword}>
                      Quên mật khẩu?
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="auth-input-group">
                  <label className="auth-input-label">Số điện thoại</label>
                  <div className="otp-send-row">
                    <div className="auth-input-wrapper" style={{ flex: 1 }}>
                      <Phone className="auth-input-icon" size={18} />
                      <input
                        required
                        type="tel"
                        value={phoneNumber}
                        onChange={(event) => {
                          setPhoneNumber(event.target.value)
                          setOtpSent(false)
                          setReceivedOtpHint(null)
                        }}
                        placeholder="Ví dụ: 0912345678"
                        autoComplete="tel"
                      />
                    </div>
                    <button
                      type="button"
                      className="otp-send-btn"
                      disabled={loading || !phoneNumber.trim()}
                      onClick={() => void handleSendOtp()}
                    >
                      {otpSent ? 'Gửi lại OTP' : 'Lấy mã OTP'}
                    </button>
                  </div>
                </div>

                {otpSent && (
                  <>
                    {receivedOtpHint && (
                      <div className="otp-hint-banner">
                        <span>💬 Mã xác thực OTP của bạn:</span>
                        <strong>{receivedOtpHint}</strong>
                      </div>
                    )}

                    <div className="auth-input-group">
                      <label className="auth-input-label">Mã OTP (6 chữ số)</label>
                      <div className="auth-input-wrapper">
                        <KeyRound className="auth-input-icon" size={18} />
                        <input
                          required
                          type="text"
                          maxLength={6}
                          value={otpCode}
                          onChange={(event) => setOtpCode(event.target.value)}
                          placeholder="Nhập mã OTP 6 số"
                          autoFocus
                        />
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {/* Error & Success Messages */}
            {error && (
              <div className="auth-state-message error">
                <span>⚠️ {error}</span>
              </div>
            )}
            {message && (
              <div className="auth-state-message success">
                <span>✨ {message}</span>
              </div>
            )}

            {/* Submit Button */}
            <button className="auth-submit-btn-gradient" type="submit" disabled={loading}>
              {loading ? (
                <LoaderCircle className="animate-spin" size={20} />
              ) : (
                <>
                  <span>
                    {authMethod === 'phone'
                      ? otpSent
                        ? 'Xác minh OTP & Đăng nhập'
                        : 'Gửi mã OTP qua SĐT'
                      : mode === 'signin'
                      ? 'Đăng nhập'
                      : 'Đăng ký'}
                  </span>
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          {/* Social login divider */}
          <div className="auth-divider-section">
            <span className="auth-divider-text">hoặc tiếp tục với</span>
          </div>

          {/* Google Button */}
          <button className="auth-google-btn-sleek" type="button" disabled={loading} onClick={google}>
            <svg className="auth-google-svg" viewBox="0 0 24 24" width="20" height="20">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.85z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.85c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            <span>Tiếp tục với Google</span>
          </button>

          {/* Terms and conditions */}
          <p className="auth-footer-terms">
            Bằng cách tiếp tục, bạn đồng ý với{' '}
            <button type="button" className="term-link">
              Điều khoản sử dụng
            </button>{' '}
            và{' '}
            <button type="button" className="term-link">
              Chính sách quyền riêng tư
            </button>{' '}
            của Aura Fitness.
          </p>
          
        </main>
      </div>
    </div>
  )
}
