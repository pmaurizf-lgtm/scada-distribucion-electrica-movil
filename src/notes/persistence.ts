import type { VesselId } from '../vessels/vesselCatalog'
import { getFirebase, isSignedInUser } from '../firebase/app'
import {
  coerceNoteLines,
  isNoteDeleted,
  noteHasOpenLines,
  openLineCount,
  sameNoteTarget,
  type InspectionNote,
  type NotesExportPayload,
  type NoteTarget,
  type PersistedVesselNotes,
} from './types'
import { getInstallUserId, loadUserProfile } from './userProfile'

function storageKey(vesselId: VesselId): string {
  return `scada-vessel-${vesselId}-notes-v1`
}

function migrateNote(raw: unknown, vesselId: VesselId): InspectionNote | null {
  if (!raw || typeof raw !== 'object') return null
  const n = raw as Record<string, unknown>
  if (typeof n.id !== 'string' || !n.id) return null
  if (typeof n.author !== 'string') return null
  if (typeof n.createdAt !== 'string') return null
  if (typeof n.updatedAt !== 'string') return null
  if (!n.target || typeof n.target !== 'object') return null
  const target = n.target as NoteTarget
  if (target.kind === 'circuit') {
    if (typeof target.circuitId !== 'string') return null
  } else if (target.kind === 'equipment') {
    if (typeof target.equipmentId !== 'string') return null
  } else {
    return null
  }

  const legacyResolved = n.resolved === true
  const lines = coerceNoteLines(n.lines, { noteResolved: legacyResolved })
  const authorId =
    typeof n.authorId === 'string' && n.authorId.trim()
      ? n.authorId.trim()
      : ''
  const deletedAt =
    typeof n.deletedAt === 'string' && n.deletedAt ? n.deletedAt : undefined

  return {
    id: n.id,
    vesselId,
    target,
    author: n.author,
    authorId,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    deletedAt,
    lines,
  }
}

export function loadVesselNotes(vesselId: VesselId): InspectionNote[] {
  try {
    const raw = localStorage.getItem(storageKey(vesselId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as PersistedVesselNotes
    if (parsed?.v !== 1 || !Array.isArray(parsed.notes)) return []
    return parsed.notes
      .map((n) => migrateNote(n, vesselId))
      .filter((n): n is InspectionNote => n != null)
  } catch {
    return []
  }
}

export function saveVesselNotes(
  vesselId: VesselId,
  notes: InspectionNote[],
): void {
  try {
    const payload: PersistedVesselNotes = {
      v: 1,
      notes: notes.map((n) => ({ ...n, vesselId })),
      savedAt: new Date().toISOString(),
    }
    localStorage.setItem(storageKey(vesselId), JSON.stringify(payload))
  } catch {
    /* cuota / privado */
  }
}

export function createNoteId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function buildNotesExport(
  vesselId: VesselId,
  notes: InspectionNote[],
): NotesExportPayload {
  return {
    v: 1,
    vesselId,
    exportedAt: new Date().toISOString(),
    notes: notes.map((n) => ({ ...n, vesselId })),
  }
}

/**
 * Merge por id: no borra notas locales; actualiza si la importada
 * tiene updatedAt más reciente.
 */
export function mergeImportedNotes(
  vesselId: VesselId,
  existing: InspectionNote[],
  incoming: unknown,
): { notes: InspectionNote[]; added: number; updated: number; skipped: number } {
  let payload: NotesExportPayload | null = null
  if (incoming && typeof incoming === 'object') {
    const raw = incoming as NotesExportPayload
    if (raw.v === 1 && Array.isArray(raw.notes)) {
      payload = raw
    }
  }
  if (!payload) {
    throw new Error('Archivo de notas no válido (se espera v: 1 y notes[]).')
  }

  const byId = new Map(existing.map((n) => [n.id, { ...n, vesselId }]))
  let added = 0
  let updated = 0
  let skipped = 0

  for (const item of payload.notes) {
    const next = migrateNote(item, vesselId)
    if (!next) {
      skipped += 1
      continue
    }
    const prev = byId.get(next.id)
    if (!prev) {
      byId.set(next.id, next)
      added += 1
      continue
    }
    if (next.updatedAt > prev.updatedAt || (prev.deletedAt && !next.deletedAt)) {
      byId.set(next.id, {
        ...next,
        deletedAt: next.deletedAt,
        updatedAt: next.updatedAt,
      })
      updated += 1
    } else {
      skipped += 1
    }
  }

  return {
    notes: [...byId.values()],
    added,
    updated,
    skipped,
  }
}

export function notesForTarget(
  notes: InspectionNote[],
  target: NoteTarget,
): InspectionNote[] {
  return notes
    .filter((n) => !isNoteDeleted(n) && sameNoteTarget(n.target, target))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Nº de viñetas abiertas en el destino (badge del globo). */
export function countOpenNotesForTarget(
  notes: InspectionNote[],
  target: NoteTarget,
): number {
  return notes
    .filter((n) => !isNoteDeleted(n) && sameNoteTarget(n.target, target))
    .reduce((sum, n) => sum + openLineCount(n), 0)
}

export function noteIsOpen(note: InspectionNote): boolean {
  return !isNoteDeleted(note) && noteHasOpenLines(note)
}

export function visibleNotes(notes: InspectionNote[]): InspectionNote[] {
  return notes.filter((n) => !isNoteDeleted(n))
}

export function isNoteAuthor(
  note: InspectionNote,
  userId: string,
  displayName?: string,
): boolean {
  if (userId && note.authorId && note.authorId === userId) return true
  // Mismo nombre de perfil: tras borrar datos del sitio el install-id cambia,
  // pero el autor visible sigue siendo el mismo.
  if (
    displayName &&
    note.author.trim().toLowerCase() === displayName.trim().toLowerCase()
  ) {
    return true
  }
  return false
}

export function currentAuthor(): { author: string; authorId: string } | null {
  const profile = loadUserProfile()
  if (!profile) return null
  // Preferir UID de Firebase (estable entre equipos) frente al id de instalación.
  const user = getFirebase()?.auth.currentUser ?? null
  const authorId = isSignedInUser(user) ? user.uid : getInstallUserId()
  return { author: profile.displayName, authorId }
}
