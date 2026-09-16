import type { VesselId } from '../vessels/vesselCatalog'

export type NoteTarget =
  | { kind: 'circuit'; circuitId: string }
  | { kind: 'equipment'; equipmentId: string }

export type NoteLine = {
  id: string
  text: string
  resolved: boolean
  resolvedAt?: string
  /** Quién marcó o desmarcó el check (cualquier usuario). */
  resolvedBy?: string
  resolvedById?: string
  /** Siempre al cambiar el check — para fusionar entre equipos. */
  resolvedUpdatedAt?: string
  /** Última edición del texto (solo el autor). */
  textUpdatedAt?: string
}

export type InspectionNote = {
  id: string
  vesselId: VesselId
  target: NoteTarget
  /** Nombre visible al crear (no es la clave de permisos). */
  author: string
  /** Id estable de la instalación que creó la nota. */
  authorId: string
  createdAt: string
  updatedAt: string
  /** Baja lógica: se sincroniza para que el resto de equipos la oculten. */
  deletedAt?: string
  /** Cada línea con su propio estado resuelto. */
  lines: NoteLine[]
}

export type PersistedVesselNotes = {
  v: 1
  notes: InspectionNote[]
  savedAt: string
}

export type NotesExportPayload = {
  v: 1
  vesselId: VesselId
  exportedAt: string
  notes: InspectionNote[]
}

export function noteTargetKey(target: NoteTarget): string {
  return target.kind === 'circuit'
    ? `circuit:${target.circuitId}`
    : `equipment:${target.equipmentId}`
}

export function sameNoteTarget(a: NoteTarget, b: NoteTarget): boolean {
  return noteTargetKey(a) === noteTargetKey(b)
}

export function createLineId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function stripBullet(text: string): string {
  return text.replace(/^\s*[•\-\*]\s*/, '').trim()
}

/** Migra string[] antiguo o NoteLine[] → NoteLine[]. */
export function coerceNoteLines(
  raw: unknown,
  opts?: { noteResolved?: boolean },
): NoteLine[] {
  if (!Array.isArray(raw)) return []
  const noteResolved = opts?.noteResolved === true
  const out: NoteLine[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      const text = stripBullet(item)
      if (!text) continue
      out.push({
        id: createLineId(),
        text,
        resolved: noteResolved,
        resolvedAt: noteResolved ? new Date().toISOString() : undefined,
      })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const row = item as Partial<NoteLine> & { text?: unknown }
    const text =
      typeof row.text === 'string' ? stripBullet(row.text) : ''
    if (!text) continue
    const resolved = typeof row.resolved === 'boolean' ? row.resolved : noteResolved
    const resolvedAt =
      resolved && typeof row.resolvedAt === 'string'
        ? row.resolvedAt
        : resolved
          ? new Date().toISOString()
          : undefined
    const resolvedUpdatedAt =
      typeof row.resolvedUpdatedAt === 'string'
        ? row.resolvedUpdatedAt
        : resolvedAt
    out.push({
      id: typeof row.id === 'string' && row.id ? row.id : createLineId(),
      text,
      resolved,
      resolvedAt,
      resolvedBy:
        typeof row.resolvedBy === 'string' ? row.resolvedBy : undefined,
      resolvedById:
        typeof row.resolvedById === 'string' ? row.resolvedById : undefined,
      resolvedUpdatedAt,
      textUpdatedAt:
        typeof row.textUpdatedAt === 'string' ? row.textUpdatedAt : undefined,
    })
  }
  return out
}

export function normalizeNoteLinesFromText(raw: string): NoteLine[] {
  return raw
    .split(/\r?\n/)
    .map((line) => stripBullet(line))
    .filter((line) => line.length > 0)
    .map((text) => ({
      id: createLineId(),
      text,
      resolved: false,
    }))
}

export function openLineCount(note: InspectionNote): number {
  return note.lines.filter((l) => !l.resolved).length
}

export function isNoteFullyResolved(note: InspectionNote): boolean {
  return note.lines.length > 0 && note.lines.every((l) => l.resolved)
}

export function noteHasOpenLines(note: InspectionNote): boolean {
  return note.lines.some((l) => !l.resolved)
}

export function isNoteDeleted(note: InspectionNote): boolean {
  return Boolean(note.deletedAt)
}

export function maxIso(a?: string, b?: string): string | undefined {
  if (!a) return b
  if (!b) return a
  return a >= b ? a : b
}
