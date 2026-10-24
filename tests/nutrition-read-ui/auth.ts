export const firebaseAuth = { get currentUser() { return { uid: (window as any).nutritionFixture?.uid ?? 'a' } } }
export const firestoreDb = {}
export const firebaseApp = null
export const isFirebaseConfigured = false
export const useFirebaseEmulators = false
export const firebaseAppCheckStatus = 'disabled'
export const useAuth = () => ({ accessContext: { uid: firebaseAuth.currentUser.uid, authzVersion: 1, status: 'active', accessRole: 'student', branchIds: [], capabilities: [] } })
export const useAuraUiSurface = () => false
