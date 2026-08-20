import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  PhoneAuthProvider,
  createUserWithEmailAndPassword,
  getRedirectResult,
  getIdTokenResult,
  linkWithCredential,
  linkWithPopup,
  linkWithRedirect,
  onIdTokenChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  updateProfile,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type AuthCredential,
  type ConfirmationResult
} from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { firebaseAuth, firestoreDb, isFirebaseConfigured } from '../lib/firebase'
import { createOrUpdateUserProfile, updateUserProfile } from '../services/firebaseService'
import { reportClientIssue } from '../services/clientTelemetryService'
import { unregisterFcmToken } from '../services/fcmService'
import type { AppUser, UserProfile, UserRole } from '../types'
import { emptyStudentAccessContext, type AccessContext } from '../identity/access'
import { getMyAccessContext } from '../services/identityAccessService'

declare global {
  interface Window {
    recaptchaVerifier?: RecaptchaVerifier | null
    confirmationResult?: ConfirmationResult | null
    phoneLinkVerificationId?: string | null
  }
}

type AuthContextValue = {
  user: AppUser | null
  profile: UserProfile | null
  role: UserRole
  accessContext: AccessContext | null
  authorizationError: string | null
  authzReady: boolean
  hasCapability: (capability: string) => boolean
  setPreviewRole: (role: UserRole) => void
  loading: boolean
  backendMode: 'demo' | 'firebase'
  signIn: (email: string, password: string) => Promise<void>
  signUp: (displayName: string, email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  linkGoogleProvider: () => Promise<void>
  linkEmailProvider: (email: string, password: string) => Promise<void>
  sendPhoneLinkOtp: (phoneNumber: string) => Promise<string>
  verifyPhoneLinkOtp: (phoneNumber: string, otpCode: string) => Promise<void>
  sendPhoneOtp: (phoneNumber: string, isSignUp?: boolean) => Promise<{ otpCode: string; message: string }>
  verifyPhoneOtpAndSignIn: (phoneNumber: string, otpCode: string, displayName?: string) => Promise<void>
  resetPassword: (email: string) => Promise<void>
  signOut: () => Promise<void>
}

const demoProfile: UserProfile = {
  uid: 'demo-admin',
  email: 'an.nguyen@aurafitness.vn',
  displayName: 'An Nguyễn',
  photoURL: null,
  role: 'admin',
  membership: 'pro',
  onboardingCompleted: true,
  goals: ['Giảm mỡ', 'Tăng sức bền'],
}

const AuthContext = createContext<AuthContextValue | null>(null)

const validUserRoles = new Set<UserRole>([
  'student', 'user', 'coach', 'trainer', 'sales', 'manager',
  'editor', 'shipper', 'admin', 'super_admin',
])
const demoOtpEnabled = import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEMO_OTP === 'true'
const e2eOtpEnabled = import.meta.env.MODE === 'e2e' && import.meta.env.VITE_ENABLE_DEMO_OTP === 'true'
const localOtpEnabled = demoOtpEnabled || e2eOtpEnabled
const recaptchaContainerId = 'aura-recaptcha-container'
let pendingGoogleCredential: AuthCredential | null = null

function normalizePhoneNumber(phoneNumber: string) {
  const compact = phoneNumber.trim().replace(/[\s().-]/g, '')
  const digits = compact.replace(/\D/g, '')
  if (!digits || digits.length < 9 || digits.length > 12) {
    throw new Error('Vui lòng nhập số điện thoại hợp lệ.')
  }
  if (compact.startsWith('+')) return `+${digits}`
  if (digits.startsWith('84')) return `+${digits}`
  if (digits.startsWith('0')) return `+84${digits.slice(1)}`
  return `+84${digits}`
}

function maskPhoneNumber(phoneNumber: string) {
  return phoneNumber.length > 7
    ? `${phoneNumber.slice(0, 4)} ••• ${phoneNumber.slice(-3)}`
    : phoneNumber
}

function storeDemoOtp(phoneNumber: string) {
  const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString()
  sessionStorage.setItem(`aura_otp_${phoneNumber}`, JSON.stringify({
    code: generatedOtp,
    createdAt: Date.now(),
  }))
  return generatedOtp
}

function tokenRoleFromClaims(role: unknown): UserRole {
  return typeof role === 'string' && validUserRoles.has(role as UserRole) ? role as UserRole : 'student'
}

function effectiveRole(tokenRole: UserRole, storedRole: unknown): UserRole {
  return storedRole === tokenRole ? tokenRole : 'student'
}

function clearUserScopedStorage(userId: string) {
  if (typeof window === 'undefined') return
  for (const key of Object.keys(window.localStorage)) {
    if (key.includes(userId)) window.localStorage.removeItem(key)
  }
}

function toAppUser(user: { uid: string; email: string | null; displayName: string | null; photoURL?: string | null; phoneNumber?: string | null; emailVerified?: boolean; providerData?: Array<{ providerId: string }> }): AppUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL ?? null,
    phoneNumber: user.phoneNumber ?? null,
    emailVerified: Boolean(user.emailVerified),
    providerIds: [...new Set((user.providerData ?? []).map((provider) => provider.providerId))],
  }
}

function isMobileAuthFlow() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(max-width: 760px)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

function setRecaptchaVisibility(visible: boolean) {
  const container = document.getElementById(recaptchaContainerId)
  container?.classList.toggle('is-visible', visible)
  window.dispatchEvent(new CustomEvent('aura-recaptcha-visibility', { detail: visible }))
}

function clearRecaptchaVerifier() {
  const activeVerifier = window.recaptchaVerifier as RecaptchaVerifier | null | undefined
  activeVerifier?.clear()
  window.recaptchaVerifier = null
  const container = document.getElementById(recaptchaContainerId)
  if (container) container.innerHTML = ''
  setRecaptchaVisibility(false)
}

function getRecaptchaVerifier(size: 'invisible' | 'normal' = 'invisible', anchorId = recaptchaContainerId) {
  if (!firebaseAuth) throw new Error('Firebase chưa được cấu hình.')
  const container = document.getElementById(anchorId)
  if (!container) throw new Error('Không thể khởi tạo bước xác minh bảo mật. Vui lòng tải lại trang.')
  clearRecaptchaVerifier()
  setRecaptchaVisibility(size === 'normal')
  firebaseAuth.languageCode = 'vi'
  const verifier = new RecaptchaVerifier(firebaseAuth, anchorId, { size })
  window.recaptchaVerifier = verifier
  return verifier
}

export function getFriendlyAuthError(error: any) {
  const code = error?.code
  if (!code && error?.message) {
    // If it's a custom thrown error with no Firebase code, just return its message.
    return error.message
  }
  const messages: Record<string, string> = {
    'auth/invalid-credential': 'Email hoặc mật khẩu chưa đúng.',
    'auth/email-already-in-use': 'Email này đã được sử dụng.',
    'auth/weak-password': 'Mật khẩu cần có ít nhất 6 ký tự.',
    'auth/invalid-email': 'Địa chỉ email không hợp lệ.',
    'auth/popup-closed-by-user': 'Cửa sổ đăng nhập Google đã được đóng.',
    'auth/too-many-requests': 'Bạn đã thử quá nhiều lần. Vui lòng quay lại sau.',
    'auth/network-request-failed': 'Không thể kết nối Firebase. Hãy kiểm tra mạng.',
    'auth/operation-not-allowed': 'Phương thức đăng nhập này chưa được bật. Vui lòng thử cách khác.',
    'auth/unauthorized-domain': 'Tên miền hiện tại chưa được cấp quyền đăng nhập Firebase.',
    'auth/popup-blocked': 'Trình duyệt đã chặn cửa sổ Google. Aura sẽ chuyển sang trang đăng nhập an toàn.',
    'auth/account-exists-with-different-credential': 'Email này đã có tài khoản Aura. Hãy đăng nhập bằng email để tự động liên kết Google.',
    'auth/link-existing-account': 'Email này đã có tài khoản Aura. Hãy đăng nhập bằng email để tự động liên kết Google.',
    'auth/credential-already-in-use': 'Phương thức này đã thuộc một tài khoản Aura khác.',
    'auth/provider-already-linked': 'Phương thức đăng nhập này đã được liên kết.',
    'auth/invalid-verification-code': 'Mã OTP không chính xác. Vui lòng kiểm tra lại.',
    'auth/session-expired': 'Phiên OTP đã hết hạn. Vui lòng gửi lại mã mới.',
  }
  return messages[code ?? ''] ?? error?.message ?? 'Đã có lỗi xảy ra. Vui lòng thử lại.'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(isFirebaseConfigured ? null : toAppUser(demoProfile))
  const [profile, setProfile] = useState<UserProfile | null>(isFirebaseConfigured ? null : demoProfile)
  const [previewRole, setPreviewRole] = useState<UserRole | null>(null)
  const [loading, setLoading] = useState(isFirebaseConfigured)
  const [accessContext, setAccessContext] = useState<AccessContext | null>(
    isFirebaseConfigured ? null : { ...emptyStudentAccessContext(demoProfile.uid), accessRole: 'admin', capabilities: ['system.manage'] },
  )
  const [authorizationError, setAuthorizationError] = useState<string | null>(null)
  const [authzReady, setAuthzReady] = useState(!isFirebaseConfigured)

  useEffect(() => {
    if (!firebaseAuth) return
    void getRedirectResult(firebaseAuth)
      .then(async (result) => {
        if (!result) return
        await createOrUpdateUserProfile({
          uid: result.user.uid,
          email: result.user.email ?? '',
          displayName: result.user.displayName ?? 'Thành viên Aura',
          photoURL: result.user.photoURL,
          phoneNumber: result.user.phoneNumber ?? undefined,
          role: 'student',
          membership: 'free',
        })
      })
      .catch((error) => {
        reportClientIssue('auth', error, { phase: 'google_redirect_result', provider: 'google', retryable: true })
        const friendlyMessage = getFriendlyAuthError(error)
        try {
          sessionStorage.setItem('aura:auth-redirect-error', friendlyMessage)
        } catch {
          // The next screen can still offer email/phone sign-in if storage is unavailable.
        }
        window.dispatchEvent(new CustomEvent('aura-auth-redirect-error', { detail: friendlyMessage }))
      })
  }, [])

  useEffect(() => {
    if (!isFirebaseConfigured || !firebaseAuth || !firestoreDb) {
      setLoading(false)
      return
    }

    // Safety timeout to prevent getting stuck on infinite loading screen
    const safetyTimeout = setTimeout(() => {
      setLoading(false)
    }, 2500)

    let unsubscribeProfile: (() => void) | undefined
    const unsubscribeAuth = onIdTokenChanged(firebaseAuth, async (firebaseUser) => {
      clearTimeout(safetyTimeout)
      unsubscribeProfile?.()

      if (!firebaseUser) {
        setUser(null)
        setProfile(null)
        setAccessContext(null)
        setAuthorizationError(null)
        setAuthzReady(true)
        setLoading(false)
        return
      }

      setUser(toAppUser(firebaseUser))
      const provisionalProfile: UserProfile = {
        uid: firebaseUser.uid,
        email: firebaseUser.email ?? '',
        displayName: firebaseUser.displayName ?? 'Thành viên Aura',
        photoURL: firebaseUser.photoURL,
        phoneNumber: firebaseUser.phoneNumber ?? undefined,
        role: 'student',
        membership: 'free',
        onboardingCompleted: false,
      }
      setProfile(provisionalProfile)
      setAuthorizationError(null)
      setAuthzReady(false)
      // Firebase Auth is the login boundary. Do not keep the whole app blocked
      // while the ID-token claims or Firestore profile are still synchronising.
      setLoading(false)
      let tokenRole: UserRole = 'student'
      try {
        const tokenResult = await getIdTokenResult(firebaseUser)
        tokenRole = tokenRoleFromClaims(tokenResult.claims.role)
      } catch {
        // Fail closed to the learner role while token refresh is unavailable.
      }
      try {
        const nextAccessContext = await getMyAccessContext(firebaseUser.uid)
        setAccessContext(nextAccessContext)
        if (nextAccessContext.status !== 'active') {
          setAuthorizationError('Tài khoản đang bị tạm khóa hoặc chưa hoàn tất lời mời.')
        }
      } catch (error) {
        setAccessContext(emptyStudentAccessContext(firebaseUser.uid))
        setAuthorizationError(error instanceof Error && error.message.includes('Quyền tài khoản chưa đồng bộ')
          ? 'Quyền tài khoản chưa đồng bộ. Vui lòng đăng nhập lại hoặc liên hệ quản trị viên.'
          : 'Chưa thể xác minh phạm vi quyền. Các chức năng nhân viên đang được khóa an toàn.')
        reportClientIssue('auth', error, { phase: 'access_context_sync', retryable: true })
      } finally {
        setAuthzReady(true)
      }

      // Load initial cached profile immediately to prevent missing fields during snapshot load or offline/quota
      const cachedProfileRaw = typeof window !== 'undefined' ? (window.localStorage.getItem(`aura:profile:${firebaseUser.uid}`) || window.localStorage.getItem(`aura:user-profile:${firebaseUser.uid}`)) : null
      if (cachedProfileRaw) {
        try {
          const parsed = JSON.parse(cachedProfileRaw)
          setProfile({
            ...parsed,
            uid: firebaseUser.uid,
            email: firebaseUser.email ?? '',
            displayName: firebaseUser.displayName ?? 'Thành viên Aura',
            role: effectiveRole(tokenRole, parsed.role),
            membership: parsed.membership ?? 'free',
          })
        } catch {}
      }

      unsubscribeProfile = onSnapshot(
        doc(firestoreDb!, 'users', firebaseUser.uid),
        async (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.data() as UserProfile
            const activeNutritionProfile = data.nutritionProfile || undefined

            const mergedData: UserProfile = {
              ...data,
              nutritionProfile: activeNutritionProfile,
              heightCm: data.heightCm ?? activeNutritionProfile?.heightCm,
              weightKg: data.weightKg ?? activeNutritionProfile?.weightKg,
              goals: (data.goals && data.goals.length > 0) ? data.goals : (activeNutritionProfile?.goal ? [activeNutritionProfile.goal] : undefined),
              targetWeightDeltaKg: data.targetWeightDeltaKg ?? activeNutritionProfile?.targetWeightDeltaKg,
              targetTimeframeMonths: data.targetTimeframeMonths ?? activeNutritionProfile?.targetTimeframeMonths,
              targetSpeedPace: data.targetSpeedPace ?? activeNutritionProfile?.targetSpeedPace,
            }

            const isCompleted = Boolean(
              mergedData.onboardingCompleted ||
              activeNutritionProfile ||
              (mergedData.heightCm && mergedData.weightKg) ||
              (mergedData.goals && mergedData.goals.length > 0)
            )

            const finalProfile: UserProfile = {
              ...mergedData,
              onboardingCompleted: isCompleted,
              uid: firebaseUser.uid,
              email: firebaseUser.email ?? '',
              role: effectiveRole(tokenRole, data.role),
            }

            setProfile(finalProfile)

            if (typeof window !== 'undefined') {
              try {
                window.localStorage.setItem(`aura:profile:${firebaseUser.uid}`, JSON.stringify(finalProfile))
                window.localStorage.setItem(`aura:user-profile:${firebaseUser.uid}`, JSON.stringify(finalProfile))
                if (activeNutritionProfile) {
                  window.localStorage.setItem(`aura:nutrition-profile:${firebaseUser.uid}`, JSON.stringify(activeNutritionProfile))
                }
                if (isCompleted) {
                  window.localStorage.setItem(`aura:onboarding-completed:${firebaseUser.uid}`, 'true')
                }
              } catch {}
            }
          } else {
            const nextProfile: UserProfile = {
              uid: firebaseUser.uid,
              email: firebaseUser.email ?? '',
              displayName: firebaseUser.displayName ?? 'Thành viên Aura',
              photoURL: firebaseUser.photoURL,
              role: 'student',
              membership: 'free',
              onboardingCompleted: false,
            }
            setProfile(nextProfile)
            setLoading(false)
            try {
              await createOrUpdateUserProfile(nextProfile)
            } catch {
              // Keep the signed-in experience usable while Firestore is temporarily unavailable.
            }
            return
          }
          setLoading(false)
        },
        (err) => {
          console.warn("Firestore user profile subscription error/quota:", err)
          reportClientIssue('firestore', err, { phase: 'profile_subscription', retryable: true })
          setAuthorizationError((current) => current || 'Đang hiển thị dữ liệu cache ở chế độ chỉ đọc vì chưa đồng bộ được Firestore.')
          const localOnboarding = typeof window !== 'undefined' && window.localStorage.getItem(`aura:onboarding-completed:${firebaseUser.uid}`) === 'true'
          const localNutRaw = typeof window !== 'undefined' ? window.localStorage.getItem(`aura:nutrition-profile:${firebaseUser.uid}`) : null
          let localNut = null
          if (localNutRaw) {
            try { localNut = JSON.parse(localNutRaw) } catch {}
          }
          let localProf: any = {}
          if (typeof window !== 'undefined') {
            try {
              const raw = window.localStorage.getItem(`aura:profile:${firebaseUser.uid}`) || window.localStorage.getItem(`aura:user-profile:${firebaseUser.uid}`)
              if (raw) localProf = JSON.parse(raw)
            } catch {}
          }

          setProfile({
            ...localProf,
            uid: firebaseUser.uid,
            email: firebaseUser.email ?? '',
            displayName: firebaseUser.displayName ?? 'Thành viên Aura',
            role: 'student',
            membership: 'free',
            onboardingCompleted: localOnboarding || Boolean(localNut) || Boolean(localProf.heightCm),
            nutritionProfile: localNut || undefined,
          })
          setLoading(false)
        },
      )
    })

    return () => {
      unsubscribeProfile?.()
      unsubscribeAuth()
      clearRecaptchaVerifier()
    }
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    profile,
    role: isFirebaseConfigured ? (profile?.role ?? 'student') : (previewRole ?? profile?.role ?? 'student'),
    accessContext,
    authorizationError,
    authzReady,
    hasCapability: (capability) => accessContext?.status === 'active' && accessContext.capabilities.includes(capability),
    setPreviewRole: (role) => {
      if (!isFirebaseConfigured) setPreviewRole(role)
    },
    loading,
    backendMode: isFirebaseConfigured ? 'firebase' : 'demo',
    signIn: async (email, password) => {
      if (!firebaseAuth) {
        throw new Error('Firebase chưa được cấu hình.')
      }
      try {
        const result = await signInWithEmailAndPassword(firebaseAuth, email, password)
        if (pendingGoogleCredential) {
          await linkWithCredential(result.user, pendingGoogleCredential)
          pendingGoogleCredential = null
        }
      } catch (error) {
        reportClientIssue('auth', error, { phase: 'email_signin', provider: 'password', retryable: true })
        throw error
      }
    },
    signUp: async (displayName, email, password) => {
      if (!firebaseAuth) {
        throw new Error('Firebase chưa được cấu hình.')
      }
      try {
        const credential = await createUserWithEmailAndPassword(firebaseAuth, email, password)
        await updateProfile(credential.user, { displayName })
        await createOrUpdateUserProfile({
          uid: credential.user.uid,
          email,
          displayName,
          role: 'student',
          membership: 'free',
          onboardingCompleted: false,
        })
      } catch (error) {
        reportClientIssue('auth', error, { phase: 'email_signup', provider: 'password', retryable: true })
        throw error
      }
    },
    signInWithGoogle: async () => {
      if (!firebaseAuth) throw new Error('Firebase chưa được cấu hình.')
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      try {
        if (isMobileAuthFlow() || window.self !== window.top) {
          await signInWithRedirect(firebaseAuth, provider)
          return
        }
        const credential = await signInWithPopup(firebaseAuth, provider)
        const userEmail = credential.user.email ?? ''
        await createOrUpdateUserProfile({
          uid: credential.user.uid,
          email: userEmail,
          displayName: credential.user.displayName ?? 'Thành viên Aura',
          photoURL: credential.user.photoURL,
          role: 'student',
          membership: 'free',
        })
      } catch (error: any) {
        if (error?.code === 'auth/popup-blocked') {
          await signInWithRedirect(firebaseAuth, provider)
          return
        }
        if (error?.code === 'auth/account-exists-with-different-credential') {
          pendingGoogleCredential = GoogleAuthProvider.credentialFromError(error)
          const linkError = new Error('Email này đã có tài khoản Aura. Hãy đăng nhập bằng email để tự động liên kết Google.') as Error & { code: string; email?: string }
          linkError.code = 'auth/link-existing-account'
          linkError.email = typeof error?.customData?.email === 'string' ? error.customData.email : undefined
          reportClientIssue('auth', error, { phase: 'google_existing_account', provider: 'google', retryable: true })
          throw linkError
        }
        reportClientIssue('auth', error, { phase: 'google_signin', provider: 'google', retryable: error?.code !== 'auth/popup-closed-by-user' })
        throw error
      }
    },
    linkGoogleProvider: async () => {
      if (!firebaseAuth?.currentUser) throw new Error('Vui lòng đăng nhập lại trước khi liên kết Google.')
      if (firebaseAuth.currentUser.providerData.some((item) => item.providerId === 'google.com')) return
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      try {
        if (isMobileAuthFlow() || window.self !== window.top) {
          await linkWithRedirect(firebaseAuth.currentUser, provider)
          return
        }
        const result = await linkWithPopup(firebaseAuth.currentUser, provider)
        setUser(toAppUser(result.user))
      } catch (error: any) {
        if (error?.code === 'auth/popup-blocked') {
          await linkWithRedirect(firebaseAuth.currentUser, provider)
          return
        }
        reportClientIssue('auth', error, { phase: 'link_google', provider: 'google', retryable: true })
        throw error
      }
    },
    linkEmailProvider: async (email, password) => {
      if (!firebaseAuth?.currentUser) throw new Error('Vui lòng đăng nhập lại trước khi liên kết email.')
      try {
        const result = await linkWithCredential(firebaseAuth.currentUser, EmailAuthProvider.credential(email.trim(), password))
        if (!result.user.emailVerified) await sendEmailVerification(result.user)
        setUser(toAppUser(result.user))
      } catch (error) {
        reportClientIssue('auth', error, { phase: 'link_email', provider: 'password', retryable: true })
        throw error
      }
    },
    sendPhoneLinkOtp: async (phoneNumber) => {
      if (!firebaseAuth?.currentUser) throw new Error('Vui lòng đăng nhập lại trước khi liên kết số điện thoại.')
      const formattedPhone = normalizePhoneNumber(phoneNumber)
      try {
        const provider = new PhoneAuthProvider(firebaseAuth)
        window.phoneLinkVerificationId = await provider.verifyPhoneNumber(formattedPhone, getRecaptchaVerifier('invisible', 'phone-link-otp-button'))
        return `Mã OTP đã được gửi đến ${maskPhoneNumber(formattedPhone)}.`
      } catch (error) {
        clearRecaptchaVerifier()
        reportClientIssue('auth', error, { phase: 'link_phone_send', provider: 'phone', retryable: true })
        throw error
      }
    },
    verifyPhoneLinkOtp: async (phoneNumber, otpCode) => {
      if (!firebaseAuth?.currentUser) throw new Error('Vui lòng đăng nhập lại trước khi liên kết số điện thoại.')
      if (!window.phoneLinkVerificationId) throw new Error('Phiên OTP đã hết hạn. Vui lòng gửi lại mã mới.')
      const formattedPhone = normalizePhoneNumber(phoneNumber)
      try {
        const result = await linkWithCredential(firebaseAuth.currentUser, PhoneAuthProvider.credential(window.phoneLinkVerificationId, otpCode.replace(/\D/g, '')))
        await updateUserProfile(firebaseAuth.currentUser.uid, { phoneNumber: formattedPhone })
        setUser(toAppUser(result.user))
        window.phoneLinkVerificationId = null
      } catch (error) {
        reportClientIssue('auth', error, { phase: 'link_phone_verify', provider: 'phone', retryable: true })
        throw error
      }
    },
    sendPhoneOtp: async (phoneNumber: string, _isSignUp?: boolean) => {
      const formattedPhone = normalizePhoneNumber(phoneNumber)

      if (!firebaseAuth) {
        if (!localOtpEnabled) throw new Error('Firebase chưa được cấu hình.')
        const otpCode = storeDemoOtp(formattedPhone)
        return {
          otpCode,
          message: `[Chế độ thử nghiệm] Mã OTP đã được tạo cho ${maskPhoneNumber(formattedPhone)}.`,
        }
      }

      const container = document.getElementById(recaptchaContainerId)
      if (!container) throw new Error('Không thể khởi tạo bước xác minh bảo mật. Vui lòng tải lại trang.')

      window.confirmationResult = null
      clearRecaptchaVerifier()

      try {
        const verifier = getRecaptchaVerifier('invisible', 'phone-otp-button')
        window.confirmationResult = await signInWithPhoneNumber(firebaseAuth, formattedPhone, verifier)
        clearRecaptchaVerifier()
        return {
          otpCode: '',
          message: `Mã OTP đã được gửi đến ${maskPhoneNumber(formattedPhone)}.`,
        }
      } catch (error: any) {
        reportClientIssue('auth', error, { phase: 'phone_otp_send', provider: 'phone', retryable: true })
        clearRecaptchaVerifier()
        window.confirmationResult = null

        if (localOtpEnabled) {
          const otpCode = storeDemoOtp(formattedPhone)
          return {
            otpCode,
            message: `[Chế độ thử nghiệm] Mã OTP đã được tạo cho ${maskPhoneNumber(formattedPhone)}.`,
          }
        }

        if (error?.code === 'auth/captcha-check-failed') {
          try {
            const visibleVerifier = getRecaptchaVerifier('normal')
            window.confirmationResult = await signInWithPhoneNumber(firebaseAuth, formattedPhone, visibleVerifier)
            clearRecaptchaVerifier()
            return {
              otpCode: '',
              message: `Xác minh bảo mật thành công. Mã OTP đã được gửi đến ${maskPhoneNumber(formattedPhone)}.`,
            }
          } catch (visibleCaptchaError: any) {
            reportClientIssue('auth', visibleCaptchaError, { phase: 'phone_otp_visible_captcha', provider: 'phone', retryable: true })
            clearRecaptchaVerifier()
            const visibleCode = visibleCaptchaError?.code
            if (visibleCode && visibleCode !== 'auth/captcha-check-failed') throw visibleCaptchaError
          }
        }

        const messages: Record<string, string> = {
          'auth/invalid-phone-number': 'Số điện thoại chưa đúng. Hãy kiểm tra mã quốc gia và thử lại.',
          'auth/missing-phone-number': 'Vui lòng nhập số điện thoại.',
          'auth/quota-exceeded': 'Hệ thống đã tạm đạt giới hạn gửi SMS. Vui lòng thử lại sau.',
          'auth/too-many-requests': 'Bạn đã yêu cầu OTP quá nhiều lần. Vui lòng đợi một lúc rồi thử lại.',
          'auth/captcha-check-failed': 'Bước xác minh bảo mật chưa hoàn tất. Vui lòng thử gửi lại mã.',
          'auth/operation-not-allowed': 'Đăng nhập bằng số điện thoại chưa được bật trên Firebase.',
        }
        throw new Error(messages[error?.code] || 'Không thể gửi OTP lúc này. Vui lòng kiểm tra kết nối và thử lại.')
      }
    },
    verifyPhoneOtpAndSignIn: async (phoneNumber: string, otpCode: string, displayName?: string) => {
      const formattedPhone = normalizePhoneNumber(phoneNumber)
      const cleanCode = otpCode.replace(/\D/g, '')
      if (cleanCode.length !== 6) throw new Error('Vui lòng nhập đủ 6 chữ số OTP.')

      const storedOtpData = typeof window !== 'undefined'
        ? sessionStorage.getItem(`aura_otp_${formattedPhone}`)
        : null

      if (localOtpEnabled && storedOtpData && !window.confirmationResult) {
        const { code, createdAt } = JSON.parse(storedOtpData) as { code: string; createdAt: number }
        if (Date.now() - createdAt > 5 * 60 * 1000) {
          sessionStorage.removeItem(`aura_otp_${formattedPhone}`)
          throw new Error('Mã OTP đã hết hạn. Vui lòng gửi lại mã mới.')
        }
        if (code !== cleanCode) throw new Error('Mã OTP không chính xác. Vui lòng kiểm tra lại.')
        sessionStorage.removeItem(`aura_otp_${formattedPhone}`)
        if (!firebaseAuth) return
      }

      if (!firebaseAuth) throw new Error('Firebase chưa được cấu hình.')
      if (!window.confirmationResult) {
        throw new Error('Phiên xác thực đã hết hiệu lực. Vui lòng gửi lại OTP.')
      }

      let credential
      try {
        credential = await window.confirmationResult.confirm(cleanCode)
      } catch (error: any) {
        reportClientIssue('auth', error, { phase: 'phone_otp_verify', provider: 'phone', retryable: true })
        const errorCode = typeof error?.code === 'string' ? error.code : ''
        if (errorCode === 'auth/invalid-verification-code') {
          throw new Error('Mã OTP không chính xác. Vui lòng kiểm tra lại.')
        }
        if (errorCode === 'auth/code-expired' || errorCode === 'auth/session-expired') {
          window.confirmationResult = null
          throw new Error('Mã OTP đã hết hạn. Vui lòng gửi lại OTP mới.')
        }
        if (!errorCode && error instanceof Error) throw error
        throw new Error('Không thể xác thực OTP lúc này. Vui lòng thử lại.')
      }

      window.confirmationResult = null
      clearRecaptchaVerifier()

      const requestedName = displayName?.trim() || ''
      const resolvedDisplayName = credential.user.displayName || requestedName || 'Thành viên Aura'
      const nextProfile: UserProfile = {
        uid: credential.user.uid,
        email: credential.user.email || '',
        phoneNumber: credential.user.phoneNumber || formattedPhone,
        displayName: resolvedDisplayName,
        photoURL: credential.user.photoURL,
        role: 'student',
        membership: 'free',
        onboardingCompleted: false,
      }

      // Firebase Auth has already accepted the OTP at this point. Move the user
      // into Aura immediately and sync the optional profile fields in the
      // background so a slow Firestore connection cannot trap them on the OTP form.
      setUser({ ...toAppUser(credential.user), displayName: resolvedDisplayName })
      setProfile(nextProfile)
      setLoading(false)
      try {
        localStorage.setItem(`aura:profile:${credential.user.uid}`, JSON.stringify(nextProfile))
        localStorage.setItem(`aura:user-profile:${credential.user.uid}`, JSON.stringify(nextProfile))
      } catch {
        // Private browsing may make storage unavailable; Firebase Auth is still valid.
      }

      if (!credential.user.displayName && requestedName) {
        void updateProfile(credential.user, { displayName: requestedName })
          .then(() => setUser(toAppUser(credential.user)))
          .catch((error) => reportClientIssue('auth', error, { phase: 'phone_profile_name', provider: 'phone', retryable: true }))
      }

      void createOrUpdateUserProfile(nextProfile)
        .catch((error) => reportClientIssue('firestore', error, { phase: 'phone_profile_sync', provider: 'phone', retryable: true }))
    },
    resetPassword: async (email) => {
      if (!firebaseAuth) throw new Error('Firebase chưa được cấu hình.')
      await sendPasswordResetEmail(firebaseAuth, email)
    },
    signOut: async () => {
      if (firebaseAuth) {
        const userId = firebaseAuth.currentUser?.uid
        if (userId) {
          try {
            // Remove this browser's device token before ending the session so
            // the next account on the same phone cannot receive this user's
            // private reminders.
            await unregisterFcmToken(userId)
          } catch (error) {
            reportClientIssue('push', error, { phase: 'fcm_unregister_sign_out', retryable: true })
          }
        }
        await firebaseSignOut(firebaseAuth)
        if (userId) clearUserScopedStorage(userId)
      }
    },
  }), [accessContext, authorizationError, authzReady, loading, profile, user, previewRole])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth phải được dùng bên trong AuthProvider.')
  return context
}
