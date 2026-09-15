import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { getFirebase, isSignedInUser, waitForAuthUser } from '../firebase/app'
import { isNotesSyncConfigured } from '../notes/syncConfig'
import {
  isUserAllowed,
  resolveUserRole,
  type AppRole,
} from './allowlist'
import { authErrorMessage } from './errors'

export type AuthStatus =
  | 'loading'
  | 'misconfigured'
  | 'unauthenticated'
  | 'forbidden'
  | 'ready'

type AuthContextValue = {
  status: AuthStatus
  user: User | null
  email: string | null
  role: AppRole
  /** true = admin / superuser: Excel notas, borrar cualquiera, candados, lista circuitos */
  isAdmin: boolean
  error: string | null
  signInWithPassword: (email: string, password: string) => Promise<void>
  signOutUser: () => Promise<void>
  clearError: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function admitOrReject(
  user: User,
): Promise<{ status: 'ready' | 'forbidden'; role: AppRole }> {
  const email = user.email?.trim() ?? ''
  if (!email || user.isAnonymous) {
    const fb = getFirebase()
    if (fb) await signOut(fb.auth)
    return { status: 'forbidden', role: 'user' }
  }
  const allowed = await isUserAllowed(user)
  if (!allowed) {
    const fb = getFirebase()
    if (fb) await signOut(fb.auth)
    return { status: 'forbidden', role: 'user' }
  }
  const role = await resolveUserRole(user)
  return { status: 'ready', role }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isNotesSyncConfigured()
  const [status, setStatus] = useState<AuthStatus>(
    configured ? 'loading' : 'misconfigured',
  )
  const [user, setUser] = useState<User | null>(null)
  const [role, setRole] = useState<AppRole>('user')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!configured) {
      setStatus('misconfigured')
      return
    }
    const fb = getFirebase()
    if (!fb) {
      setStatus('misconfigured')
      return
    }
    let cancelled = false
    const unsub = fb.auth.onAuthStateChanged((next) => {
      void (async () => {
        if (cancelled) return
        if (!isSignedInUser(next)) {
          setUser(null)
          setRole('user')
          setStatus((prev) =>
            prev === 'forbidden' ? 'forbidden' : 'unauthenticated',
          )
          return
        }
        const admitted = await admitOrReject(next)
        if (cancelled) return
        if (admitted.status === 'ready') {
          setUser(next)
          setRole(admitted.role)
          setError(null)
          setStatus('ready')
          return
        }
        setUser(null)
        setRole('user')
        setStatus('forbidden')
        setError('Esta cuenta no está autorizada para usar la aplicación.')
      })()
    })
    void waitForAuthUser().then((existing) => {
      if (cancelled || existing) return
      setStatus((prev) => (prev === 'loading' ? 'unauthenticated' : prev))
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [configured])

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const fb = getFirebase()
    if (!fb) {
      setStatus('misconfigured')
      return
    }
    setError(null)
    try {
      const cred = await signInWithEmailAndPassword(
        fb.auth,
        email.trim(),
        password,
      )
      const admitted = await admitOrReject(cred.user)
      if (admitted.status === 'forbidden') {
        setRole('user')
        setStatus('forbidden')
        setError('Esta cuenta no está autorizada para usar la aplicación.')
      }
    } catch (err) {
      setStatus('unauthenticated')
      setError(authErrorMessage(err))
    }
  }, [])

  const signOutUser = useCallback(async () => {
    const fb = getFirebase()
    setError(null)
    setUser(null)
    setRole('user')
    setStatus('unauthenticated')
    if (fb) await signOut(fb.auth)
  }, [])

  const value = useMemo(
    () => ({
      status,
      user,
      email: user?.email ?? null,
      role,
      isAdmin: role === 'admin',
      error,
      signInWithPassword,
      signOutUser,
      clearError: () => {
        setError(null)
        if (status === 'forbidden') setStatus('unauthenticated')
      },
    }),
    [status, user, role, error, signInWithPassword, signOutUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth debe usarse dentro de AuthProvider')
  }
  return ctx
}
