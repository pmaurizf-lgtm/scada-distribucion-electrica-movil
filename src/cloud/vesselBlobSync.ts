/**
 * Sync de un documento de estado por buque:
 * vessels/{vesselId}/{collection}/state
 */
import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore'
import { getFirebase, isSignedInUser, waitForAuthUser } from '../firebase/app'
import { isNotesSyncConfigured } from '../notes/syncConfig'
import type { VesselId } from '../vessels/vesselCatalog'

export async function ensureCloudAuth(): Promise<void> {
  const user = await waitForAuthUser()
  if (!isSignedInUser(user)) {
    throw new Error('Sesión no válida')
  }
}

export function isCloudSyncConfigured(): boolean {
  return isNotesSyncConfigured()
}

function stateRef(vesselId: VesselId, collection: string) {
  const fb = getFirebase()
  if (!fb) return null
  return doc(fb.db, 'vessels', vesselId, collection, 'state')
}

export async function pullVesselBlob<T extends Record<string, unknown>>(
  vesselId: VesselId,
  collection: string,
): Promise<T | null> {
  const ref = stateRef(vesselId, collection)
  if (!ref) return null
  await ensureCloudAuth()
  const snap = await getDoc(ref)
  if (!snap.exists()) return null
  return snap.data() as T
}

export async function pushVesselBlob(
  vesselId: VesselId,
  collection: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const ref = stateRef(vesselId, collection)
  if (!ref) return
  await ensureCloudAuth()
  await setDoc(ref, { ...payload, vesselId }, { merge: false })
}

export function subscribeVesselBlob<T extends Record<string, unknown>>(
  vesselId: VesselId,
  collection: string,
  onChange: (data: T | null) => void,
  onError?: (err: Error) => void,
): Unsubscribe | null {
  const ref = stateRef(vesselId, collection)
  if (!ref) return null
  return onSnapshot(
    ref,
    (snap) => {
      onChange(snap.exists() ? (snap.data() as T) : null)
    },
    (err) => onError?.(err),
  )
}

/** true si a es estrictamente más reciente que b (ISO). */
export function isNewerIso(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a) return false
  if (!b) return true
  return a > b
}
