import {
  collection,
  deleteField,
  doc,
  getDocs,
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

function fromFirestore(raw: Record<string, unknown>, vesselId: VesselId): InspectionNote | null {
  if (typeof raw.id !== 'string' || !raw.id) return null
  if (typeof raw.author !== 'string') return null
  if (typeof raw.createdAt !== 'string' || typeof raw.updatedAt !== 'string') {
    return null
  }
  if (!raw.target || typeof raw.target !== 'object') return null
  const target = raw.target as NoteTarget
  if (target.kind === 'circuit') {
    if (typeof target.circuitId !== 'string') return null
  } else if (target.kind === 'equipment') {
    if (typeof target.equipmentId !== 'string') return null
  } else {
    return null
  }
  const deletedAt =
    typeof raw.deletedAt === 'string' && raw.deletedAt ? raw.deletedAt : undefined
  return {
    id: raw.id,
    vesselId,
    target,
    author: raw.author,
    authorId: typeof raw.authorId === 'string' ? raw.authorId : '',
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    deletedAt,
    lines: coerceNoteLines(raw.lines),
  }
}

export async function pullVesselNotes(
  vesselId: VesselId,
): Promise<InspectionNote[]> {
  const col = notesCol(vesselId)
  if (!col) return []
  await ensureNotesAuth()
  const snap = await getDocs(col)
  const out: InspectionNote[] = []
  snap.forEach((d) => {
    const n = fromFirestore(d.data() as Record<string, unknown>, vesselId)
    if (n) out.push(n)
  })
  return out
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
    (snap) => {
      const out: InspectionNote[] = []
      snap.forEach((d) => {
        const n = fromFirestore(d.data() as Record<string, unknown>, vesselId)
        if (n) out.push(n)
      })
      onChange(out)
    },
    (err) => onError?.(err),
  )
}
