import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getIdTokenResult,
  onIdTokenChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult
} from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { firebaseAuth, firestoreDb, isFirebaseConfigured } from '../lib/firebase'
import { createOrUpdateUserProfile } from '../services/firebaseService'
import type { AppUser, UserProfile, UserRole } from '../types'

declare global {
  interface Window {
    recaptchaVerifier?: RecaptchaVerifier | null
    confirmationResult?: ConfirmationResult | null
  }
}

type AuthContextValue = {
  user: AppUser | null
  profile: UserProfile | null
  role: UserRole
  setPreviewRole: (role: UserRole) => void
  loading: boolean
  backendMode: 'demo' | 'firebase'
  signIn: (email: string, password: string) => Promise<void>
  signUp: (displayName: string, email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
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

const validUserRoles = new Set<UserRole>(['student', 'coach', 'editor', 'admin', 'super_admin'])
const demoOtpEnabled = import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEMO_OTP === 'true'
const e2eOtpEnabled = import.meta.env.MODE === 'e2e' && import.meta.env.VITE_ENABLE_DEMO_OTP === 'true'
const localOtpEnabled = demoOtpEnabled || e2eOtpEnabled

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

function toAppUser(user: { uid: string; email: string | null; displayName: string | null; photoURL?: string | null }): AppUser {
  return { uid: user.uid, email: user.email, displayName: user.displayName, photoURL: user.photoURL ?? null }
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
  }
  return messages[code ?? ''] ?? error?.message ?? 'Đã có lỗi xảy ra. Vui lòng thử lại.'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(isFirebaseConfigured ? null : toAppUser(demoProfile))
  const [profile, setProfile] = useState<UserProfile | null>(isFirebaseConfigured ? null : demoProfile)
  const [previewRole, setPreviewRole] = useState<UserRole | null>(null)
  const [loading, setLoading] = useState(isFirebaseConfigured)

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
        setLoading(false)
        return
      }

      setUser(toAppUser(firebaseUser))
      let tokenRole: UserRole = 'student'
      try {
        const tokenResult = await getIdTokenResult(firebaseUser)
        tokenRole = tokenRoleFromClaims(tokenResult.claims.role)
      } catch {
        // Fail closed to the learner role while token refresh is unavailable.
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
            role: 'student',
            membership: 'free',
          })
          setLoading(false)
        } catch {}
      }

      unsubscribeProfile = onSnapshot(
        doc(firestoreDb!, 'users', firebaseUser.uid),
        async (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.data() as UserProfile
            const localOnboarding = typeof window !== 'undefined' && window.localStorage.getItem(`aura:onboarding-completed:${firebaseUser.uid}`) === 'true'
            const localNutRaw = typeof window !== 'undefined' ? window.localStorage.getItem(`aura:nutrition-profile:${firebaseUser.uid}`) : null
            let localNut = null
            if (localNutRaw) {
              try { localNut = JSON.parse(localNutRaw) } catch {}
            }
            const activeNutritionProfile = data.nutritionProfile || localNut || undefined

            let localProf: any = {}
            if (typeof window !== 'undefined') {
              try {
                const raw = window.localStorage.getItem(`aura:profile:${firebaseUser.uid}`) || window.localStorage.getItem(`aura:user-profile:${firebaseUser.uid}`)
                if (raw) localProf = JSON.parse(raw)
              } catch {}
            }

            const mergedData: UserProfile = {
              ...localProf,
              ...data,
              nutritionProfile: activeNutritionProfile,
              heightCm: data.heightCm ?? localProf.heightCm ?? activeNutritionProfile?.heightCm,
              weightKg: data.weightKg ?? localProf.weightKg ?? activeNutritionProfile?.weightKg,
              goals: (data.goals && data.goals.length > 0) ? data.goals : (localProf.goals && localProf.goals.length > 0) ? localProf.goals : (activeNutritionProfile?.goal ? [activeNutritionProfile.goal] : undefined),
              targetWeightDeltaKg: data.targetWeightDeltaKg ?? localProf.targetWeightDeltaKg ?? activeNutritionProfile?.targetWeightDeltaKg,
              targetTimeframeMonths: data.targetTimeframeMonths ?? localProf.targetTimeframeMonths ?? activeNutritionProfile?.targetTimeframeMonths,
              targetSpeedPace: data.targetSpeedPace ?? localProf.targetSpeedPace ?? activeNutritionProfile?.targetSpeedPace,
            }

            const isCompleted = Boolean(
              mergedData.onboardingCompleted ||
              activeNutritionProfile ||
              localOnboarding ||
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
            const localOnboarding = typeof window !== 'undefined' && window.localStorage.getItem(`aura:onboarding-completed:${firebaseUser.uid}`) === 'true'
            const localNut = typeof window !== 'undefined' && window.localStorage.getItem(`aura:nutrition-profile:${firebaseUser.uid}`)
            let localProf: any = {}
            if (typeof window !== 'undefined') {
              try {
                const raw = window.localStorage.getItem(`aura:profile:${firebaseUser.uid}`) || window.localStorage.getItem(`aura:user-profile:${firebaseUser.uid}`)
                if (raw) localProf = JSON.parse(raw)
              } catch {}
            }

            const nextProfile: UserProfile = {
              ...localProf,
              uid: firebaseUser.uid,
              email: firebaseUser.email ?? '',
              displayName: firebaseUser.displayName ?? 'Thành viên Aura',
              photoURL: firebaseUser.photoURL,
              role: 'student',
              membership: 'free',
              onboardingCompleted: localOnboarding || Boolean(localNut) || Boolean(localProf.heightCm),
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
    }
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    profile,
    role: isFirebaseConfigured ? (profile?.role ?? 'student') : (previewRole ?? profile?.role ?? 'student'),
    setPreviewRole: (role) => {
      if (!isFirebaseConfigured) setPreviewRole(role)
    },
    loading,
    backendMode: isFirebaseConfigured ? 'firebase' : 'demo',
    signIn: async (email, password) => {
      console.log('Starting signIn for email:', email);
      if (!firebaseAuth) {
        console.error('Firebase Auth is not configured');
        throw new Error('Firebase chưa được cấu hình.')
      }
      await signInWithEmailAndPassword(firebaseAuth, email, password)
    },
    signUp: async (displayName, email, password) => {
      console.log('Starting signUp for email:', email);
      if (!firebaseAuth) {
        console.error('Firebase Auth is not configured');
        throw new Error('Firebase chưa được cấu hình.')
      }
      try {
        const credential = await createUserWithEmailAndPassword(firebaseAuth, email, password)
        console.log('createUserWithEmailAndPassword success:', credential.user.uid);
        await updateProfile(credential.user, { displayName })
        console.log('Profile updated with displayName');
        await createOrUpdateUserProfile({
          uid: credential.user.uid,
          email,
          displayName,
          role: 'student',
          membership: 'free',
          onboardingCompleted: false,
        })
        console.log('User profile created in Firestore successfully.');
      } catch (error) {
        // Firebase auth errors are handled in AuthPage
        throw error;
      }
    },
    signInWithGoogle: async () => {
      if (!firebaseAuth) throw new Error('Firebase chưa được cấu hình.')
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      try {
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
        if (error?.code === 'auth/popup-closed-by-user') {
          console.log('Popup closed by user');
          return;
        }
        if (window.self !== window.top) {
          throw new Error('Đăng nhập Google bị chặn khi xem ở chế độ nhúng. Vui lòng mở ứng dụng trong tab mới (icon góc phải trên).')
        }
        throw error;
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

      const container = document.getElementById('recaptcha-container')
      if (!container) throw new Error('Không thể khởi tạo bước xác minh bảo mật. Vui lòng tải lại trang.')

      window.confirmationResult = null
      window.recaptchaVerifier?.clear()
      window.recaptchaVerifier = null
      container.innerHTML = ''

      try {
        const verifier = new RecaptchaVerifier(firebaseAuth, 'recaptcha-container', { size: 'invisible' })
        window.recaptchaVerifier = verifier
        window.confirmationResult = await signInWithPhoneNumber(firebaseAuth, formattedPhone, verifier)
        return {
          otpCode: '',
          message: `Mã OTP đã được gửi đến ${maskPhoneNumber(formattedPhone)}.`,
        }
      } catch (error: any) {
        window.recaptchaVerifier?.clear()
        window.recaptchaVerifier = null
        window.confirmationResult = null
        container.innerHTML = ''

        if (localOtpEnabled) {
          const otpCode = storeDemoOtp(formattedPhone)
          return {
            otpCode,
            message: `[Chế độ thử nghiệm] Mã OTP đã được tạo cho ${maskPhoneNumber(formattedPhone)}.`,
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

      try {
        const credential = await window.confirmationResult.confirm(cleanCode)
        const requestedName = displayName?.trim() || ''
        if (!credential.user.displayName && requestedName) {
          await updateProfile(credential.user, { displayName: requestedName })
        }

        await createOrUpdateUserProfile({
          uid: credential.user.uid,
          email: credential.user.email || '',
          phoneNumber: credential.user.phoneNumber || formattedPhone,
          displayName: credential.user.displayName || requestedName || '',
          role: 'student',
          membership: 'free',
        })
        window.confirmationResult = null
      } catch (error: any) {
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
    },
    resetPassword: async (email) => {
      if (!firebaseAuth) throw new Error('Firebase chưa được cấu hình.')
      await sendPasswordResetEmail(firebaseAuth, email)
    },
    signOut: async () => {
      if (firebaseAuth) {
        const userId = firebaseAuth.currentUser?.uid
        await firebaseSignOut(firebaseAuth)
        if (userId) clearUserScopedStorage(userId)
      }
    },
  }), [loading, profile, user, previewRole])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth phải được dùng bên trong AuthProvider.')
  return context
}
