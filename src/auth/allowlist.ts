import { doc, getDoc } from 'firebase/firestore'
import type { User } from 'firebase/auth'
import { getFirebase } from '../firebase/app'

export function parseAllowedEmails(raw?: string): string[] {
  if (!raw) return []
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes('@'))
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function usesPasswordProvider(user: User): boolean {
  return user.providerData.some((p) => p.providerId === 'password')
}

/**
 * Solo cuentas de correo/contraseña creadas por el administrador.
 * Acceso permitido si:
 * - el correo está en VITE_ALLOWED_EMAILS, o
 * - existe Firestore allowlist/{email} con enabled !== false, o
 * - no hay lista en env (cualquier cuenta password dada de alta).
 */
export async function isUserAllowed(user: User): Promise<boolean> {
  if (!usesPasswordProvider(user)) return false
  const normalized = normalizeEmail(user.email ?? '')
  if (!normalized) return false
  const envList = parseAllowedEmails(import.meta.env.VITE_ALLOWED_EMAILS)
  if (envList.includes(normalized)) return true

  const fb = getFirebase()
  if (fb) {
    try {
      const snap = await getDoc(doc(fb.db, 'allowlist', normalized))
      if (snap.exists() && snap.data()?.enabled !== false) return true
    } catch {
      /* sin permiso o sin red: no abrir por Firestore */
    }
  }

  if (envList.length === 0) return true
  return false
}
