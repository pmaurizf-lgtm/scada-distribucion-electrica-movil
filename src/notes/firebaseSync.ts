import {
  collection,
  deleteField,
  doc,
  getDocs,
  getDocsFromServer,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore'
import { getFirebase, isSignedInUser, waitForAuthUser } from '../firebase/app'
import { VESSELS, type VesselId } from '../vessels/vesselCatalog'
import { coerceNoteLines, type InspectionNote, type NoteTarget } from './types'

export async function ensureNotesAuth(): Promise<void> {
  const user = await waitForAuthUser()
  if (!isSignedInUser(user)) {
    throw new Error('Sesión no válida')
  }
}

function notesCol(vesselId: VesselId) {
  const fb = getFirebase()
  if (!fb) return null
  return collection(fb.db, 'vessels', vesselId, 'notes')
}

function stripUndef<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj }
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) delete out[key]
  }
  return out
}

export function noteToFirestore(note: InspectionNote): Record<string, unknown> {
  return stripUndef({
    id: note.id,
    vesselId: note.vesselId,
    target: note.target,
    author: note.author,
    authorId: note.authorId,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    deletedAt: note.deletedAt ?? null,
    lines: note.lines.map((l) =>
      stripUndef({
        id: l.id,
        text: l.text,
        resolved: l.resolved,
        resolvedAt: l.resolvedAt ?? null,
        resolvedBy: l.resolvedBy ?? null,
        resolvedById: l.resolvedById ?? null,
        resolvedUpdatedAt: l.resolvedUpdatedAt ?? null,
        textUpdatedAt: l.textUpdatedAt ?? null,
      }),
    ),
  })
}

function asIso(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString()
    } catch {
      return undefined
    }
  }
  return undefined
}

function fromFirestore(
  raw: Record<string, unknown>,
  vesselId: VesselId,
): InspectionNote | null {
  if (typeof raw.id !== 'string' || !raw.id) return null
  const author = typeof raw.author === 'string' ? raw.author : ''
  const createdAt = asIso(raw.createdAt)
  const updatedAt = asIso(raw.updatedAt)
  if (!createdAt || !updatedAt) return null
  if (!raw.target || typeof raw.target !== 'object') return null
  const target = raw.target as NoteTarget
  if (target.kind === 'circuit') {
    if (typeof target.circuitId !== 'string') return null
  } else if (target.kind === 'equipment') {
    if (typeof target.equipmentId !== 'string') return null
  } else {
    return null
  }
  const deletedAt = asIso(raw.deletedAt)
  return {
    id: raw.id,
    vesselId,
    target,
    author,
    authorId: typeof raw.authorId === 'string' ? raw.authorId : '',
    createdAt,
    updatedAt,
    deletedAt,
    lines: coerceNoteLines(raw.lines),
  }
}

function notesFromSnap(
  snap: { forEach: (fn: (d: { data: () => unknown }) => void) => void },
  vesselId: VesselId,
): InspectionNote[] {
  const out: InspectionNote[] = []
  snap.forEach((d) => {
    const n = fromFirestore(d.data() as Record<string, unknown>, vesselId)
    if (n) out.push(n)
  })
  return out
}

/** Lectura forzada desde servidor (evita caché incompleta en PWA móvil). */
export async function pullVesselNotes(
  vesselId: VesselId,
): Promise<InspectionNote[]> {
  const col = notesCol(vesselId)
  if (!col) return []
  await ensureNotesAuth()
  try {
    const snap = await getDocsFromServer(col)
    return notesFromSnap(snap, vesselId)
  } catch {
    const snap = await getDocs(col)
    return notesFromSnap(snap, vesselId)
  }
}

export async function pushVesselNote(note: InspectionNote): Promise<void> {
  const fb = getFirebase()
  if (!fb) return
  await ensureNotesAuth()
  const ref = doc(fb.db, 'vessels', note.vesselId, 'notes', note.id)
  const payload = noteToFirestore(note)
  if (!note.deletedAt) payload.deletedAt = deleteField()
  await setDoc(ref, payload, { merge: true })
}

/** Recupera el borrado masivo (autor vacío + deletedAt). No toca bajas hechas a mano. */
export async function restoreBulkWipedNotes(
  vesselId: VesselId,
): Promise<InspectionNote[]> {
  const remote = await pullVesselNotes(vesselId)
  const now = new Date().toISOString()
  const out: InspectionNote[] = []
  for (const n of remote) {
    const wiped = Boolean(n.deletedAt) && !n.author.trim()
    if (!wiped) {
      out.push(n)
      continue
    }
    const restored = { ...n, deletedAt: undefined, updatedAt: now }
    await pushVesselNote(restored)
    out.push(restored)
  }
  return out
}

let bulkRestoreDone = false

/** Una vez por sesión: restaura el borrado masivo en todos los buques. */
export async function restoreAllBulkWipedNotes(): Promise<void> {
  if (bulkRestoreDone) return
  for (const v of VESSELS) {
    await restoreBulkWipedNotes(v.id)
  }
  bulkRestoreDone = true
}

export function subscribeVesselNotes(
  vesselId: VesselId,
  onChange: (notes: InspectionNote[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe | null {
  const col = notesCol(vesselId)
  if (!col) return null
  return onSnapshot(
    col,
    { includeMetadataChanges: true },
    (snap) => {
      onChange(notesFromSnap(snap, vesselId))
      // Si el primer evento viene de caché local incompleta, refrescar del servidor.
      if (snap.metadata.fromCache) {
        void getDocsFromServer(col)
          .then((serverSnap) => {
            onChange(notesFromSnap(serverSnap, vesselId))
          })
          .catch(() => {
            /* sin red: nos quedamos con caché */
          })
      }
    },
    (err) => onError?.(err),
  )
}
