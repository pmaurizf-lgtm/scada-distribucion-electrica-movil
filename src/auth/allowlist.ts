import { doc, getDoc } from 'firebase/firestore'
import type { User } from 'firebase/auth'
import { getFirebase } from '../firebase/app'

export type AppRole = 'user' | 'admin'

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

function parseRole(raw: unknown): AppRole {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (s === 'admin' || s === 'superuser' || s === 'super') return 'admin'
  return 'user'
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

/**
 * Rol de la cuenta:
 * - VITE_ADMIN_EMAILS (lista de correos admin), o
 * - Firestore allowlist/{email}.role = 'admin' | 'superuser'
 * El resto son usuarios normales.
 */
export async function resolveUserRole(user: User): Promise<AppRole> {
  const normalized = normalizeEmail(user.email ?? '')
  if (!normalized) return 'user'

  const envAdmins = parseAllowedEmails(import.meta.env.VITE_ADMIN_EMAILS)
  if (envAdmins.includes(normalized)) return 'admin'

  const fb = getFirebase()
  if (fb) {
    try {
      const snap = await getDoc(doc(fb.db, 'allowlist', normalized))
      if (snap.exists()) {
        const data = snap.data() as { enabled?: boolean; role?: unknown }
        if (data.enabled === false) return 'user'
        return parseRole(data.role)
      }
    } catch {
      /* ignore */
    }
  }

  return 'user'
}
