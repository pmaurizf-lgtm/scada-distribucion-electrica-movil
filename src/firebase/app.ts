import { initializeApp, getApps } from 'firebase/app'
import {
  getAuth,
  onAuthStateChanged,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth'
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'
import { getFirebaseWebConfig } from '../notes/syncConfig'

const APP_NAME = 'scada-notes'

let auth: Auth | null = null
let db: Firestore | null = null

export function getFirebase(): { auth: Auth; db: Firestore } | null {
  const cfg = getFirebaseWebConfig()
  if (!cfg) return null
  const app =
    getApps().find((a) => a.name === APP_NAME) ??
    initializeApp(
      {
        apiKey: cfg.apiKey,
        authDomain: cfg.authDomain,
        projectId: cfg.projectId,
        appId: cfg.appId,
      },
      APP_NAME,
    )
  if (!auth) auth = getAuth(app)
  if (!db) {
    try {
      db = initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      })
    } catch {
      db = getFirestore(app)
    }
  }
  return { auth, db }
}

export function isSignedInUser(user: User | null): user is User {
  return Boolean(user && !user.isAnonymous)
}

/** Espera un usuario no anónimo, o null si no hay sesión válida. */
export function waitForAuthUser(): Promise<User | null> {
  const fb = getFirebase()
  if (!fb) return Promise.resolve(null)
  if (fb.auth.currentUser) {
    if (fb.auth.currentUser.isAnonymous) {
      return signOut(fb.auth).then(() => null)
    }
    return Promise.resolve(fb.auth.currentUser)
  }
  return new Promise((resolve) => {
    let done = false
    const finish = (user: User | null) => {
      if (done) return
      done = true
      unsub()
      resolve(user)
    }
    const unsub = onAuthStateChanged(fb.auth, (user) => {
      if (user?.isAnonymous) {
        void signOut(fb.auth).then(() => finish(null))
        return
      }
      finish(user)
    })
    window.setTimeout(() => {
      const current = fb.auth.currentUser
      finish(current && !current.isAnonymous ? current : null)
    }, 4000)
  })
}
