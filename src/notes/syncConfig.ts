/**
 * Firebase (acceso restringido + notas).
 *
 * Sin estas variables la app no deja entrar: hace falta validar al usuario.
 *
 * VITE_FIREBASE_API_KEY
 * VITE_FIREBASE_AUTH_DOMAIN
 * VITE_FIREBASE_PROJECT_ID
 * VITE_FIREBASE_APP_ID
 */
export type FirebaseWebConfig = {
  apiKey: string
  authDomain: string
  projectId: string
  appId: string
}

function readEnv(name: string): string {
  const v = import.meta.env[name]
  return typeof v === 'string' ? v.trim() : ''
}

export function getFirebaseWebConfig(): FirebaseWebConfig | null {
  const apiKey = readEnv('VITE_FIREBASE_API_KEY')
  const authDomain = readEnv('VITE_FIREBASE_AUTH_DOMAIN')
  const projectId = readEnv('VITE_FIREBASE_PROJECT_ID')
  const appId = readEnv('VITE_FIREBASE_APP_ID')
  if (!apiKey || !authDomain || !projectId || !appId) return null
  return { apiKey, authDomain, projectId, appId }
}

export function isNotesSyncConfigured(): boolean {
  return getFirebaseWebConfig() != null
}
