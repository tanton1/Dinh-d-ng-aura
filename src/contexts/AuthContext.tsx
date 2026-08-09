import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult
} from 'firebase/auth'
import { doc, onSnapshot, collection, query, where, getDocs } from 'firebase/firestore'
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
    const unsubscribeAuth = onAuthStateChanged(firebaseAuth, async (firebaseUser) => {
      clearTimeout(safetyTimeout)
      unsubscribeProfile?.()

      if (!firebaseUser) {
        setUser(null)
        setProfile(null)
        setLoading(false)
        return
      }

      setUser(toAppUser(firebaseUser))

      // Load initial cached profile immediately to prevent missing fields during snapshot load or offline/quota
      const cachedProfileRaw = typeof window !== 'undefined' ? (window.localStorage.getItem(`aura:profile:${firebaseUser.uid}`) || window.localStorage.getItem(`aura:user-profile:${firebaseUser.uid}`)) : null
      if (cachedProfileRaw) {
        try {
          const parsed = JSON.parse(cachedProfileRaw)
          setProfile((prev) => ({
            uid: firebaseUser.uid,
            email: firebaseUser.email ?? '',
            displayName: firebaseUser.displayName ?? 'Thành viên Aura',
            role: firebaseUser.email === 'nhattank16.1@gmail.com' ? 'super_admin' : 'student',
            membership: firebaseUser.email === 'nhattank16.1@gmail.com' ? 'pro' : 'free',
            ...parsed,
            ...prev,
          }))
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
              uid: firebaseUser.uid,
              email: firebaseUser.email ?? '',
              displayName: firebaseUser.displayName ?? 'Thành viên Aura',
              photoURL: firebaseUser.photoURL,
              role: firebaseUser.email === 'nhattank16.1@gmail.com' ? 'super_admin' : 'student',
              membership: firebaseUser.email === 'nhattank16.1@gmail.com' ? 'pro' : 'free',
              onboardingCompleted: localOnboarding || Boolean(localNut) || Boolean(localProf.heightCm),
              ...localProf,
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
            uid: firebaseUser.uid,
            email: firebaseUser.email ?? '',
            displayName: firebaseUser.displayName ?? 'Thành viên Aura',
            role: firebaseUser.email === 'nhattank16.1@gmail.com' ? 'super_admin' : 'student',
            membership: firebaseUser.email === 'nhattank16.1@gmail.com' ? 'pro' : 'free',
            onboardingCompleted: localOnboarding || Boolean(localNut) || Boolean(localProf.heightCm),
            nutritionProfile: localNut || undefined,
            ...localProf,
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
    role: previewRole ?? profile?.role ?? 'student',
    setPreviewRole,
    loading,
    backendMode: isFirebaseConfigured ? 'firebase' : 'demo',
    signIn: async (email, password) => {
      console.log('Starting signIn for email:', email);
      if (!firebaseAuth) {
        console.error('Firebase Auth is not configured');
        throw new Error('Firebase chưa được cấu hình.')
      }
      try {
        const credential = await signInWithEmailAndPassword(firebaseAuth, email, password)
        console.log('signInWithEmailAndPassword success:', credential.user.uid);
        
        // Đảm bảo cấp quyền admin nếu đăng nhập bằng email admin
        if (email === 'nhattank16.1@gmail.com') {
          console.log('Admin login detected, updating user profile...');
          await createOrUpdateUserProfile({
            uid: credential.user.uid,
            email,
            displayName: credential.user.displayName ?? 'Thành viên Aura',
            role: 'super_admin',
            membership: 'pro',
          })
          console.log('Admin profile updated successfully.');
        }
      } catch (error) {
        throw error;
      }
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
          role: email === 'nhattank16.1@gmail.com' ? 'super_admin' : 'student',
          membership: email === 'nhattank16.1@gmail.com' ? 'pro' : 'free',
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
          role: userEmail === 'nhattank16.1@gmail.com' ? 'super_admin' : 'student',
          membership: userEmail === 'nhattank16.1@gmail.com' ? 'pro' : 'free',
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
    sendPhoneOtp: async (phoneNumber: string, isSignUp?: boolean) => {
      const cleanPhone = phoneNumber.trim().replace(/\s+/g, '')
      if (!cleanPhone || cleanPhone.length < 8) {
        throw new Error('Vui lòng nhập số điện thoại hợp lệ (từ 9 đến 11 chữ số).')
      }

      if (!firebaseAuth) {
        throw new Error('Firebase chưa được cấu hình.')
      }

      let formattedPhone = cleanPhone
      if (formattedPhone.startsWith('0')) {
        formattedPhone = '+84' + formattedPhone.substring(1)
      } else if (!formattedPhone.startsWith('+')) {
        formattedPhone = '+' + formattedPhone
      }

      // Check if user exists before sending OTP
      if (firestoreDb) {
        try {
          const usersRef = collection(firestoreDb, 'users')
          const q1 = query(usersRef, where('phoneNumber', '==', formattedPhone))
          const q2 = query(usersRef, where('phoneNumber', '==', cleanPhone))
          
          const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)])
          const exists = !snap1.empty || !snap2.empty
          
          if (isSignUp && exists) {
            throw new Error('Số điện thoại này đã được đăng ký. Vui lòng chuyển sang tab Đăng nhập.')
          } else if (isSignUp === false && !exists) {
            throw new Error('Số điện thoại này chưa được đăng ký. Vui lòng chuyển sang tab Đăng ký tài khoản.')
          }
        } catch (e: any) {
          // If the error is not about existing user (e.g., missing permissions because user is not authenticated yet),
          // we just log it and proceed to send OTP anyway to avoid blocking the auth flow.
          if (e.message.includes('đăng ký')) {
            throw e;
          }
          console.warn('[PhoneAuth] Could not verify if user exists (likely due to firestore rules before auth). Proceeding with OTP.', e);
        }
      }

      let appVerifier: any = window.recaptchaVerifier;
      if (!appVerifier) {
        try {
          const container = document.getElementById('recaptcha-container');
          if (container) {
            container.innerHTML = '';
          }
          appVerifier = new RecaptchaVerifier(firebaseAuth, 'recaptcha-container', {
            size: 'invisible'
          });
          window.recaptchaVerifier = appVerifier;
        } catch (err) {
          console.error('[PhoneAuth] Error creating RecaptchaVerifier:', err);
          throw new Error('Lỗi khởi tạo hệ thống bảo mật captcha.');
        }
      }
      
      try {
        console.log(`[PhoneAuth] Sending OTP to ${formattedPhone}...`, { cleanPhone, isSignUp });
        const confirmationResult = await signInWithPhoneNumber(firebaseAuth, formattedPhone, appVerifier)
        window.confirmationResult = confirmationResult
        console.log(`[PhoneAuth] OTP sent successfully to ${formattedPhone}`);
        
        return {
          otpCode: '', // Not used in real Firebase Phone Auth
          message: `Mã xác thực OTP đã được gửi đến số ${formattedPhone}.`,
        }
      } catch (error: any) {
        console.warn('[PhoneAuth] Failed to send OTP. Exact error from Firebase:', error);
        console.warn('[PhoneAuth] Request payload:', { formattedPhone, appVerifierExists: !!appVerifier });
        
        // Error logging removed for iframe/demo testing
        // Fallback for iframe/demo testing when Firebase Phone Auth fails
        console.log('[PhoneAuth] Falling back to local demo OTP...');
        const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString()
        if (typeof window !== 'undefined') {
          sessionStorage.setItem(`aura_otp_${cleanPhone}`, JSON.stringify({
            code: generatedOtp,
            createdAt: Date.now(),
          }))
        }
        
        // Return a mock success response so the user can proceed in the UI
        return {
          otpCode: generatedOtp,
          message: `[Chế độ thử nghiệm] Mã OTP của bạn là ${generatedOtp}.`,
        }
      }
    },
    verifyPhoneOtpAndSignIn: async (phoneNumber: string, otpCode: string, displayName?: string) => {
      const cleanPhone = phoneNumber.trim().replace(/\s+/g, '')
      const cleanCode = otpCode.trim()

      if (!cleanPhone) throw new Error('Chưa có số điện thoại.')
      if (!cleanCode || cleanCode.length < 4) throw new Error('Mã OTP không hợp lệ.')

      if (!firebaseAuth) {
        throw new Error('Firebase chưa được cấu hình.')
      }
      
      // Developer backdoor for missing SMS
      if (cleanCode === '000000') {
        const demoEmail = `${cleanPhone}@aurafitness.demo.com`
        const demoPassword = `Demo${cleanPhone}!`
        let nameToUse = displayName?.trim() || `Học viên ${cleanPhone}`
        let credential: any;
        try {
          credential = await signInWithEmailAndPassword(firebaseAuth, demoEmail, demoPassword)
        } catch (e: any) {
          credential = await createUserWithEmailAndPassword(firebaseAuth, demoEmail, demoPassword)
          await updateProfile(credential.user, { displayName: nameToUse })
        }
        
        let formattedPhone = cleanPhone
        if (formattedPhone.startsWith('0')) {
          formattedPhone = '+84' + formattedPhone.substring(1)
        } else if (!formattedPhone.startsWith('+')) {
          formattedPhone = '+' + formattedPhone
        }

        await createOrUpdateUserProfile({
          uid: credential.user.uid,
          email: credential.user.email,
          phoneNumber: formattedPhone,
          displayName: credential.user.displayName || nameToUse,
          role: 'student',
          membership: 'free',
          onboardingCompleted: false,
        })
        return;
      }
      
      // Fallback check
      const storedOtpData = typeof window !== 'undefined' ? sessionStorage.getItem(`aura_otp_${cleanPhone}`) : null
      if (storedOtpData && !window.confirmationResult) {
        try {
          const { code, createdAt } = JSON.parse(storedOtpData)
          if (Date.now() - createdAt > 5 * 60 * 1000) {
            throw new Error('Mã OTP đã hết hạn.')
          }
          if (code === cleanCode) {
            sessionStorage.removeItem(`aura_otp_${cleanPhone}`)
            
            // Map demo auth to email/password under the hood to bypass iframe limits
            const demoEmail = `${cleanPhone}@aurafitness.demo.com`
            const demoPassword = `Demo${cleanPhone}!`
            let nameToUse = displayName?.trim() || `Học viên ${cleanPhone}`
            let credential: any;
            try {
              credential = await signInWithEmailAndPassword(firebaseAuth, demoEmail, demoPassword)
            } catch (e: any) {
              credential = await createUserWithEmailAndPassword(firebaseAuth, demoEmail, demoPassword)
              await updateProfile(credential.user, { displayName: nameToUse })
            }
            
            let formattedPhone = cleanPhone
            if (formattedPhone.startsWith('0')) {
              formattedPhone = '+84' + formattedPhone.substring(1)
            } else if (!formattedPhone.startsWith('+')) {
              formattedPhone = '+' + formattedPhone
            }

            await createOrUpdateUserProfile({
              uid: credential.user.uid,
              email: credential.user.email,
              phoneNumber: formattedPhone,
              displayName: credential.user.displayName || nameToUse,
              role: 'student',
              membership: 'free',
              onboardingCompleted: false,
            })
            return;
          } else {
            throw new Error('Mã OTP không chính xác.')
          }
        } catch (e: any) {
          throw new Error(e.message || 'Lỗi kiểm tra OTP.')
        }
      }

      if (!window.confirmationResult) {
        throw new Error('Không tìm thấy phiên xác thực OTP. Vui lòng lấy mã mới.')
      }

      let formattedPhone = cleanPhone
      if (formattedPhone.startsWith('0')) {
        formattedPhone = '+84' + formattedPhone.substring(1)
      } else if (!formattedPhone.startsWith('+')) {
        formattedPhone = '+' + formattedPhone
      }

      try {
        const credential = await window.confirmationResult.confirm(cleanCode)
        let nameToUse = displayName?.trim() || `Học viên ${cleanPhone}`
        
        if (!credential.user.displayName && displayName?.trim()) {
           await updateProfile(credential.user, { displayName: nameToUse })
        } else if (credential.user.displayName) {
           nameToUse = credential.user.displayName
        }

        await createOrUpdateUserProfile({
          uid: credential.user.uid,
          email: credential.user.email || `${cleanPhone}@aurafitness.com`,
          phoneNumber: credential.user.phoneNumber || formattedPhone,
          displayName: nameToUse,
          role: 'student',
          membership: 'free',
          onboardingCompleted: false,
        })
      } catch (error: any) {
        if (error.code === 'auth/invalid-verification-code') {
          throw new Error('Mã OTP không chính xác. Vui lòng kiểm tra lại.')
        } else if (error.code === 'auth/code-expired') {
          throw new Error('Mã OTP đã hết hạn. Vui lòng gửi lại OTP mới.')
        }
        throw new Error('Đăng nhập bằng OTP thất bại. Vui lòng thử lại.')
      }
    },
    resetPassword: async (email) => {
      if (!firebaseAuth) throw new Error('Firebase chưa được cấu hình.')
      await sendPasswordResetEmail(firebaseAuth, email)
    },
    signOut: async () => {
      if (firebaseAuth) await firebaseSignOut(firebaseAuth)
    },
  }), [loading, profile, user, previewRole])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth phải được dùng bên trong AuthProvider.')
  return context
}
