import { useState, type FormEvent } from 'react'
import { ArrowRight, CheckCircle2, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, ShieldCheck, Sparkles, UserRound } from 'lucide-react'
import { getFriendlyAuthError, useAuth } from '../../contexts/AuthContext'

export default function AuthPage() {
  const { signIn, signUp, signInWithGoogle, resetPassword } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)
    try {
      if (mode === 'signin') await signIn(email, password)
      else await signUp(name, email, password)
    } catch (authError) {
      setError(getFriendlyAuthError(authError))
    } finally {
      setLoading(false)
    }
  }

  const google = async () => {
    setLoading(true)
    setError(null)
    try { await signInWithGoogle() }
    catch (authError) { setError(getFriendlyAuthError(authError)) }
    finally { setLoading(false) }
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
    } finally { setLoading(false) }
  }

  return (
    <div className="auth-page">
      <section className="auth-story">
        <div className="auth-brand"><div className="brand-mark">A<span /></div><div><strong>AURA</strong><small>FITNESS</small></div></div>
        <div className="auth-story__content">
          <span className="auth-kicker"><Sparkles size={15} /> HỌC ĐÚNG · TẬP CHẤT · SỐNG KHỎE</span>
          <h1>Mỗi ngày mạnh mẽ hơn một chút.</h1>
          <p>Lộ trình học và tập luyện được cá nhân hóa, đồng hành cùng bạn từ buổi đầu tiên đến khi chạm mục tiêu.</p>
          <div className="auth-benefits">
            <span><CheckCircle2 /> Giáo án khoa học từ huấn luyện viên Aura</span>
            <span><CheckCircle2 /> Theo dõi tiến độ trên mọi thiết bị</span>
            <span><CheckCircle2 /> Dữ liệu được đồng bộ và bảo vệ bởi Firebase</span>
          </div>
        </div>
        <div className="auth-orbit one" /><div className="auth-orbit two" /><div className="auth-glow" />
        <div className="auth-trust"><ShieldCheck size={18} /><span><strong>Dữ liệu riêng tư</strong><small>Bạn kiểm soát toàn bộ thông tin sức khỏe của mình.</small></span></div>
      </section>

      <main className="auth-form-panel">
        <div className="auth-form-wrap">
          <div className="auth-form-heading">
            <span className="eyebrow">CHÀO MỪNG ĐẾN AURA</span>
            <h2>{mode === 'signin' ? 'Đăng nhập tài khoản' : 'Bắt đầu hành trình'}</h2>
            <p>{mode === 'signin' ? 'Tiếp tục khóa học và buổi tập đang chờ bạn.' : 'Tạo tài khoản để nhận lộ trình phù hợp với mục tiêu.'}</p>
          </div>

          <div className="auth-mode-tabs"><button className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>Đăng nhập</button><button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Đăng ký</button></div>

          <form onSubmit={submit}>
            {mode === 'signup' && <label><span>Họ và tên</span><div><UserRound size={18} /><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Nguyễn Minh Anh" autoComplete="name" /></div></label>}
            <label><span>Email</span><div><Mail size={18} /><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ban@aurafitness.vn" autoComplete="email" /></div></label>
            <label><span>Mật khẩu</span><div><LockKeyhole size={18} /><input required minLength={6} type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Tối thiểu 6 ký tự" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
            {mode === 'signin' && <button type="button" className="forgot-button" onClick={forgotPassword}>Quên mật khẩu?</button>}
            {error && <div className="auth-message error">{error}</div>}
            {message && <div className="auth-message success">{message}</div>}
            <button className="auth-submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={19} /> : <>{mode === 'signin' ? 'Đăng nhập' : 'Tạo tài khoản'} <ArrowRight size={18} /></>}</button>
          </form>

          <div className="auth-divider"><span>hoặc tiếp tục với</span></div>
          <button className="google-button" disabled={loading} onClick={google}><span>G</span> Google</button>
          <p className="auth-terms">Bằng cách tiếp tục, bạn đồng ý với <button>Điều khoản sử dụng</button> và <button>Chính sách quyền riêng tư</button> của Aura Fitness.</p>
        </div>
      </main>
    </div>
  )
}
