import { maxIso, type InspectionNote, type NoteLine } from './types'

function mergeLine(a?: NoteLine, b?: NoteLine): NoteLine | null {
  if (!a) return b ?? null
  if (!b) return a
  const textAtA = a.textUpdatedAt ?? ''
  const textAtB = b.textUpdatedAt ?? ''
  const textFrom = textAtB > textAtA ? b : a
  const resAtA = a.resolvedUpdatedAt ?? a.resolvedAt ?? ''
  const resAtB = b.resolvedUpdatedAt ?? b.resolvedAt ?? ''
  const resFrom = resAtB > resAtA ? b : a
  return {
    id: a.id,
    text: textFrom.text,
    textUpdatedAt: maxIso(a.textUpdatedAt, b.textUpdatedAt),
    resolved: resFrom.resolved,
    resolvedAt: resFrom.resolved ? resFrom.resolvedAt : undefined,
    resolvedBy: resFrom.resolvedBy,
    resolvedById: resFrom.resolvedById,
    resolvedUpdatedAt: maxIso(a.resolvedUpdatedAt, b.resolvedUpdatedAt),
  }
}

/** Fusiona dos versiones de la misma nota (id).
 * La baja lógica gana, salvo si la otra copia está viva y es igual de reciente
 * o más nueva (p. ej. restauración desde Excel). */
export function mergeNotePair(
  a: InspectionNote,
  b: InspectionNote,
): InspectionNote {
  const undeleted =
    (!a.deletedAt && Boolean(b.deletedAt) && a.updatedAt >= b.updatedAt) ||
    (!b.deletedAt && Boolean(a.deletedAt) && b.updatedAt >= a.updatedAt)
  const deletedAt = undeleted ? undefined : maxIso(a.deletedAt, b.deletedAt)
  const base = a.createdAt <= b.createdAt ? a : b
  if (deletedAt) {
    return {
      ...base,
      deletedAt,
      updatedAt: maxIso(a.updatedAt, b.updatedAt) ?? deletedAt,
      lines: base.lines,
    }
  }
  const byId = new Map<string, NoteLine>()
  for (const line of [...a.lines, ...b.lines]) {
    const prev = byId.get(line.id)
    const next = mergeLine(prev, line)
    if (next) byId.set(line.id, next)
  }
  const order = a.updatedAt >= b.updatedAt ? a.lines : b.lines
  const ordered: NoteLine[] = []
  const seen = new Set<string>()
  for (const line of order) {
    const merged = byId.get(line.id)
    if (merged && !seen.has(line.id)) {
      ordered.push(merged)
      seen.add(line.id)
    }
  }
  for (const [id, line] of byId) {
    if (!seen.has(id)) ordered.push(line)
  }
  return {
    ...base,
    author: base.author.trim() ? base.author : a.author || b.author,
    authorId: base.authorId || a.authorId || b.authorId,
    updatedAt: maxIso(a.updatedAt, b.updatedAt) ?? base.updatedAt,
    lines: ordered,
  }
}

export function mergeNoteLists(
  local: InspectionNote[],
  incoming: InspectionNote[],
): InspectionNote[] {
  const byId = new Map(local.map((n) => [n.id, n]))
  for (const item of incoming) {
    const prev = byId.get(item.id)
    byId.set(item.id, prev ? mergeNotePair(prev, item) : item)
  }
  return [...byId.values()]
}

/**
 * Merge al bajar de la nube: si el servidor tiene la nota viva y la baja local
 * es anterior a esa versión, se recupera. Si el usuario acaba de borrar
 * (deletedAt >= updatedAt remoto), se respeta el borrado.
 */
export function mergeNoteListsFromServer(
  local: InspectionNote[],
  remote: InspectionNote[],
): InspectionNote[] {
  const byId = new Map(local.map((n) => [n.id, n]))
  for (const rem of remote) {
    const loc = byId.get(rem.id)
    if (!loc) {
      byId.set(rem.id, rem)
      continue
    }
    if (!rem.deletedAt && loc.deletedAt) {
      if (loc.deletedAt >= rem.updatedAt) {
        byId.set(rem.id, loc)
        continue
      }
      const liveLocal = { ...loc, deletedAt: undefined }
      const merged = mergeNotePair(liveLocal, rem)
      byId.set(rem.id, { ...merged, deletedAt: undefined })
      continue
    }
    byId.set(rem.id, mergeNotePair(loc, rem))
  }
  return [...byId.values()]
}

export function notesFingerprint(notes: InspectionNote[]): string {
  return notes
    .map((n) => {
      const lines = n.lines
        .map(
          (l) =>
            `${l.id}:${l.text}:${l.resolved ? 1 : 0}:${l.resolvedUpdatedAt ?? ''}:${l.textUpdatedAt ?? ''}`,
        )
        .join(',')
      return `${n.id}:${n.updatedAt}:${n.deletedAt ?? ''}:${lines}`
    })
    .sort()
    .join('|')
}
