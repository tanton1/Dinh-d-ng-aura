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
} from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { firebaseAuth, firestoreDb, isFirebaseConfigured } from '../lib/firebase'
import { createOrUpdateUserProfile } from '../services/firebaseService'
import type { AppUser, UserProfile, UserRole } from '../types'

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

export function getFriendlyAuthError(error: unknown) {
  const code = (error as { code?: string }).code
  const messages: Record<string, string> = {
    'auth/invalid-credential': 'Email hoặc mật khẩu chưa đúng.',
    'auth/email-already-in-use': 'Email này đã được sử dụng.',
    'auth/weak-password': 'Mật khẩu cần có ít nhất 6 ký tự.',
    'auth/invalid-email': 'Địa chỉ email không hợp lệ.',
    'auth/popup-closed-by-user': 'Cửa sổ đăng nhập Google đã được đóng.',
    'auth/too-many-requests': 'Bạn đã thử quá nhiều lần. Vui lòng quay lại sau.',
    'auth/network-request-failed': 'Không thể kết nối Firebase. Hãy kiểm tra mạng.',
  }
  return messages[code ?? ''] ?? 'Đã có lỗi xảy ra. Vui lòng thử lại.'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(isFirebaseConfigured ? null : toAppUser(demoProfile))
  const [profile, setProfile] = useState<UserProfile | null>(isFirebaseConfigured ? null : demoProfile)
  const [previewRole, setPreviewRole] = useState<UserRole | null>(null)
  const [loading, setLoading] = useState(isFirebaseConfigured)

  useEffect(() => {
    if (!isFirebaseConfigured || !firebaseAuth || !firestoreDb) return

    let unsubscribeProfile: (() => void) | undefined
    const unsubscribeAuth = onAuthStateChanged(firebaseAuth, async (firebaseUser) => {
      unsubscribeProfile?.()

      if (!firebaseUser) {
        setUser(null)
        setProfile(null)
        setLoading(false)
        return
      }

      setUser(toAppUser(firebaseUser))
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
            if (data.nutritionProfile && typeof window !== 'undefined') {
              try {
                window.localStorage.setItem(`aura:nutrition-profile:${firebaseUser.uid}`, JSON.stringify(data.nutritionProfile))
                window.localStorage.setItem(`aura:onboarding-completed:${firebaseUser.uid}`, 'true')
              } catch {}
            }
            const isCompleted = Boolean(
              data.onboardingCompleted ||
              activeNutritionProfile ||
              localOnboarding ||
              (data.heightCm && data.weightKg) ||
              (data.goals && data.goals.length > 0)
            )
            setProfile({
              ...data,
              nutritionProfile: activeNutritionProfile,
              onboardingCompleted: isCompleted,
            })
          } else {
            const localOnboarding = typeof window !== 'undefined' && window.localStorage.getItem(`aura:onboarding-completed:${firebaseUser.uid}`) === 'true'
            const localNut = typeof window !== 'undefined' && window.localStorage.getItem(`aura:nutrition-profile:${firebaseUser.uid}`)
            const nextProfile: UserProfile = {
              uid: firebaseUser.uid,
              email: firebaseUser.email ?? '',
              displayName: firebaseUser.displayName ?? 'Thành viên Aura',
              photoURL: firebaseUser.photoURL,
              role: firebaseUser.email === 'nhattank16.1@gmail.com' ? 'super_admin' : 'student',
              membership: firebaseUser.email === 'nhattank16.1@gmail.com' ? 'pro' : 'free',
              onboardingCompleted: localOnboarding || Boolean(localNut),
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
        () => {
          const localOnboarding = typeof window !== 'undefined' && window.localStorage.getItem(`aura:onboarding-completed:${firebaseUser.uid}`) === 'true'
          const localNut = typeof window !== 'undefined' && window.localStorage.getItem(`aura:nutrition-profile:${firebaseUser.uid}`)
          setProfile({
            uid: firebaseUser.uid,
            email: firebaseUser.email ?? '',
            displayName: firebaseUser.displayName ?? 'Thành viên Aura',
            role: 'student',
            membership: 'free',
            onboardingCompleted: localOnboarding || Boolean(localNut),
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
        console.error('Error during signIn:', error);
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
          alert('Tính năng đăng nhập bằng Google có thể bị chặn khi xem ở chế độ nhúng (iFrame). Vui lòng mở ứng dụng trong một tab mới để tiếp tục.')
        }
        throw error;
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
