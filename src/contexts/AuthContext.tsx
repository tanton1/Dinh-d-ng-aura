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
  reauthenticateWithCredential,
  updatePassword,
  updateProfile,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type AuthCredential,
  type ConfirmationResult
} from 'firebase/auth'
import { firebaseAuth, isFirebaseConfigured } from '../lib/firebase'
import { reportClientIssue } from '../services/clientTelemetryService'
import type { AppUser, UserProfile, UserRole } from '../types'
import { emptyStudentAccessContext, type AccessContext } from '../identity/access'
import {
  initialProfileSyncState,
  readProfileCache,
  resolveProfileRevision,
  writeProfileCache,
  type DataSyncState,
} from '../dataSync/profileSync'

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
  profileSyncState: DataSyncState
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
  changePassword: (currentPassword: string, nextPassword: string) => Promise<void>
  saveProfileChanges: (values: Partial<UserProfile>) => Promise<void>
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
const googleRedirectMarkerKey = 'aura:google-auth-redirect'
let pendingGoogleCredential: AuthCredential | null = null

async function createOrUpdateUserProfile(profile: UserProfile) {
  const service = await import('../services/firebaseService')
  return service.createOrUpdateUserProfile(profile)
}

async function updateUserProfile(userId: string, values: Partial<UserProfile>) {
  const service = await import('../services/firebaseService')
  return service.updateUserProfile(userId, values)
}

async function getMyAccessContext(uid: string) {
  const service = await import('../services/identityAccessService')
  return service.getMyAccessContext(uid)
}

async function unregisterFcmToken(userId: string) {
  const service = await import('../services/fcmService')
  return service.unregisterFcmToken(userId)
}

function markGoogleRedirect() {
  try {
    sessionStorage.setItem(googleRedirectMarkerKey, String(Date.now()))
  } catch {
    // Firebase can still continue when storage is restricted.
  }
}

function hasFreshGoogleRedirectMarker() {
  try {
    const startedAt = Number(sessionStorage.getItem(googleRedirectMarkerKey) || 0)
    return Number.isFinite(startedAt) && Date.now() - startedAt < 15 * 60_000
  } catch {
    return false
  }
}

function clearGoogleRedirectMarker() {
  try {
    sessionStorage.removeItem(googleRedirectMarkerKey)
  } catch {
    // Nothing else to clean up.
  }
}

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
  const [profileSyncState, setProfileSyncState] = useState<DataSyncState>(initialProfileSyncState)

  useEffect(() => {
    if (!firebaseAuth || !hasFreshGoogleRedirectMarker()) return
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
      .finally(clearGoogleRedirectMarker)
  }, [])

  useEffect(() => {
    if (!isFirebaseConfigured || !firebaseAuth) {
      setLoading(false)
      return
    }

    // Safety timeout to prevent getting stuck on infinite loading screen
    const safetyTimeout = setTimeout(() => {
      setLoading(false)
    }, 2500)

    let unsubscribeProfile: (() => void) | undefined
    let authGeneration = 0
    const unsubscribeAuth = onIdTokenChanged(firebaseAuth, async (firebaseUser) => {
      const generation = ++authGeneration
      const isCurrent = () => generation === authGeneration
      clearTimeout(safetyTimeout)
      unsubscribeProfile?.()

      if (!firebaseUser) {
        setUser(null)
        setProfile(null)
        setAccessContext(null)
        setAuthorizationError(null)
        setAuthzReady(true)
        setProfileSyncState(initialProfileSyncState)
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

      // Resolve the capability scope in parallel with the locally cached ID
      // token. Previously this request started only after token decoding and
      // blocked profile hydration/listeners for the full callable cold start.
      void getMyAccessContext(firebaseUser.uid)
        .then((nextAccessContext) => {
          if (!isCurrent()) return
          setAccessContext(nextAccessContext)
          if (nextAccessContext.status !== 'active') {
            setAuthorizationError('Tài khoản đang bị tạm khóa hoặc chưa hoàn tất lời mời.')
          }
        })
        .catch((error) => {
          if (!isCurrent()) return
          setAccessContext(emptyStudentAccessContext(firebaseUser.uid))
          setAuthorizationError(error instanceof Error && error.message.includes('Quyền tài khoản chưa đồng bộ')
            ? 'Quyền tài khoản chưa đồng bộ. Vui lòng đăng nhập lại hoặc liên hệ quản trị viên.'
            : 'Chưa thể xác minh phạm vi quyền. Các chức năng nhân viên đang được khóa an toàn.')
          reportClientIssue('auth', error, { phase: 'access_context_sync', retryable: true })
        })
        .finally(() => {
          if (isCurrent()) setAuthzReady(true)
        })

      // A cache is display-only. Only a versioned envelope previously written
      // from a confirmed Firestore snapshot is accepted here.
      const cachedProfile = readProfileCache(firebaseUser.uid)
      let tokenRole: UserRole = 'student'
      let storedRole: unknown = cachedProfile?.value.role
      if (cachedProfile) {
        setProfile({
          ...cachedProfile.value,
          uid: firebaseUser.uid,
          email: firebaseUser.email ?? '',
          // Claims are resolved in parallel. Fail closed briefly instead of
          // delaying the canonical Firestore listener behind a token request.
          role: 'student',
        })
        setProfileSyncState({
          status: typeof navigator !== 'undefined' && !navigator.onLine ? 'offline-readonly' : 'stale-cache',
          revision: cachedProfile.revision,
          cachedAt: cachedProfile.cachedAt,
        })
      }

      void getIdTokenResult(firebaseUser)
        .then((tokenResult) => {
          if (!isCurrent()) return
          tokenRole = tokenRoleFromClaims(tokenResult.claims.role)
          setProfile((current) => current && current.uid === firebaseUser.uid
            ? { ...current, role: effectiveRole(tokenRole, storedRole) }
            : current)
        })
        .catch(() => {
          // Fail closed to the learner role while token refresh is unavailable.
        })

      try {
        const [{ doc, onSnapshot }, { firestoreDb }] = await Promise.all([
          import('firebase/firestore'),
          import('../lib/firebaseFirestore'),
        ])
        if (!isCurrent() || !firestoreDb) return
        unsubscribeProfile = onSnapshot(
          doc(firestoreDb, 'users', firebaseUser.uid),
          { includeMetadataChanges: true },
          (snapshot) => {
            if (!isCurrent()) return
            if (snapshot.exists()) {
              const data = snapshot.data() as UserProfile
              storedRole = data.role
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

              // Firestore is canonical. Visible nutrition defaults or an old
              // local cache must never silently complete onboarding.
              const isCompleted = mergedData.onboardingCompleted === true

              const finalProfile: UserProfile = {
                ...mergedData,
                onboardingCompleted: isCompleted,
                uid: firebaseUser.uid,
                email: firebaseUser.email ?? '',
                role: effectiveRole(tokenRole, data.role),
              }

              setProfile(finalProfile)
              const revision = resolveProfileRevision(snapshot.data())
              const lastConfirmed = readProfileCache(firebaseUser.uid)
              if (snapshot.metadata.hasPendingWrites) {
                setProfileSyncState({ status: 'pending-local-change', revision, cachedAt: lastConfirmed?.cachedAt ?? null })
              } else if (snapshot.metadata.fromCache) {
                setProfileSyncState({
                  status: typeof navigator !== 'undefined' && !navigator.onLine ? 'offline-readonly' : 'stale-cache',
                  revision: lastConfirmed?.revision ?? revision,
                  cachedAt: lastConfirmed?.cachedAt ?? null,
                })
              } else if (lastConfirmed && lastConfirmed.revision > revision) {
                setProfileSyncState({
                  status: 'conflict',
                  revision,
                  cachedAt: lastConfirmed.cachedAt,
                  message: 'Bản máy chủ cũ hơn bản đã xác nhận trước đó. Aura đã khóa chỉnh sửa để tránh ghi đè.',
                })
              } else {
                const cachedAt = new Date().toISOString()
                // Persist the confirmed Firestore role. It is always intersected
                // with verified token claims before becoming effective in UI.
                writeProfileCache(firebaseUser.uid, { ...finalProfile, role: data.role }, revision, cachedAt)
                setProfileSyncState({ status: 'synced', revision, cachedAt })
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
              setProfileSyncState({
                status: 'sync-failed',
                revision: 0,
                cachedAt: cachedProfile?.cachedAt ?? null,
                message: 'Chưa tìm thấy hồ sơ canonical. Vui lòng hoàn tất thiết lập hoặc liên hệ quản trị viên.',
              })
              setLoading(false)
              return
            }
            setLoading(false)
          },
          (err) => {
            if (!isCurrent()) return
            reportClientIssue('firestore', err, { phase: 'profile_subscription', retryable: true })
            const fallback = readProfileCache(firebaseUser.uid)
            if (fallback) setProfile({ ...fallback.value, role: effectiveRole(tokenRole, fallback.value.role) })
            setProfileSyncState({
              status: typeof navigator !== 'undefined' && !navigator.onLine && fallback ? 'offline-readonly' : 'sync-failed',
              revision: fallback?.revision ?? 0,
              cachedAt: fallback?.cachedAt ?? null,
            })
            setLoading(false)
          },
        )
      } catch (err) {
        if (!isCurrent()) return
        reportClientIssue('firestore', err, { phase: 'profile_module_load', retryable: true })
        setProfileSyncState({ status: 'sync-failed', revision: 0, cachedAt: cachedProfile?.cachedAt ?? null })
      }
    })

    return () => {
      authGeneration += 1
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
    profileSyncState,
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
          markGoogleRedirect()
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
          markGoogleRedirect()
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
          markGoogleRedirect()
          await linkWithRedirect(firebaseAuth.currentUser, provider)
          return
        }
        const result = await linkWithPopup(firebaseAuth.currentUser, provider)
        setUser(toAppUser(result.user))
      } catch (error: any) {
        if (error?.code === 'auth/popup-blocked') {
          markGoogleRedirect()
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
      setProfileSyncState((current) => ({ ...current, status: 'pending-local-change' }))
      setLoading(false)

      if (!credential.user.displayName && requestedName) {
        void updateProfile(credential.user, { displayName: requestedName })
          .then(() => setUser(toAppUser(credential.user)))
          .catch((error) => reportClientIssue('auth', error, { phase: 'phone_profile_name', provider: 'phone', retryable: true }))
      }

      void createOrUpdateUserProfile(nextProfile)
        .catch((error) => {
          setProfileSyncState((current) => ({
            ...current,
            status: typeof navigator !== 'undefined' && !navigator.onLine ? 'offline-readonly' : 'sync-failed',
          }))
          reportClientIssue('firestore', error, { phase: 'phone_profile_sync', provider: 'phone', retryable: true })
        })
    },
    resetPassword: async (email) => {
      if (!firebaseAuth) throw new Error('Firebase chưa được cấu hình.')
      await sendPasswordResetEmail(firebaseAuth, email)
    },
    changePassword: async (currentPassword, nextPassword) => {
      const currentUser = firebaseAuth?.currentUser
      if (!currentUser?.email) throw new Error('Tài khoản này chưa có email để đổi mật khẩu. Hãy liên hệ Aura để được hỗ trợ.')
      if (nextPassword.length < 6) throw new Error('Mật khẩu mới cần có ít nhất 6 ký tự.')
      await reauthenticateWithCredential(currentUser, EmailAuthProvider.credential(currentUser.email, currentPassword))
      await updatePassword(currentUser, nextPassword)
      setProfile((current) => current ? { ...current, mustChangePassword: false } : current)
    },
    saveProfileChanges: async (values) => {
      if (!user?.uid) throw new Error('Vui lòng đăng nhập lại trước khi lưu hồ sơ.')
      if (profileSyncState.status === 'offline-readonly' || profileSyncState.status === 'stale-cache' || profileSyncState.status === 'conflict') {
        throw new Error('Hồ sơ đang ở chế độ chỉ đọc. Hãy kết nối lại và tải dữ liệu mới nhất trước khi chỉnh sửa.')
      }
      const previous = profile
      setProfile((current) => current ? { ...current, ...values } : current)
      setProfileSyncState((current) => ({ ...current, status: 'pending-local-change', message: undefined }))
      try {
        await updateUserProfile(user.uid, values)
      } catch (error) {
        setProfile(previous)
        setProfileSyncState((current) => ({
          ...current,
          status: typeof navigator !== 'undefined' && !navigator.onLine ? 'offline-readonly' : 'sync-failed',
        }))
        throw error
      }
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
  }), [accessContext, authorizationError, authzReady, loading, profile, profileSyncState, user, previewRole])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth phải được dùng bên trong AuthProvider.')
  return context
}
