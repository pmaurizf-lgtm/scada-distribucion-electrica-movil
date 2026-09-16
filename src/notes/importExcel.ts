import ExcelJS from 'exceljs'
import { getTopology } from '../topology'
import { isVesselId, type VesselId } from '../vessels/vesselCatalog'
import { createNoteId } from './persistence'
import {
  createLineId,
  type InspectionNote,
  type NoteLine,
  type NoteTarget,
} from './types'

/** Hoja oculta con ids y fechas ISO para restaurar 1:1 el Excel exportado. */
export const NOTES_BACKUP_SHEET = '_scada_notes_v1'

export type ExcelImportResult = {
  notes: InspectionNote[]
  added: number
  updated: number
  skipped: number
  source: 'backup' | 'report'
}

function cellText(cell: ExcelJS.Cell | undefined): string {
  if (!cell) return ''
  const v = cell.value
  if (v == null || v === '') return ''
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v > 20000 && v < 90000) {
      return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString()
    }
    return String(v)
  }
  if (typeof v === 'object') {
    const obj = v as {
      text?: string
      richText?: { text: string }[]
      result?: unknown
      hyperlink?: string
    }
    if (Array.isArray(obj.richText)) {
      return obj.richText.map((t) => t.text).join('')
    }
    if (typeof obj.text === 'string') return obj.text
    if (obj.result != null) return String(obj.result)
  }
  return String(v).trim()
}

function cellDateIso(cell: ExcelJS.Cell | undefined): string | undefined {
  if (!cell) return undefined
  const v = cell.value
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString()
  const t = cellText(cell).trim()
  if (!t) return undefined
  const parsed = new Date(t)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  const m = t.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/,
  )
  if (m) {
    const d = new Date(
      Number(m[3]),
      Number(m[2]) - 1,
      Number(m[1]),
      m[4] ? Number(m[4]) : 0,
      m[5] ? Number(m[5]) : 0,
    )
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return undefined
}

function targetFromRow(kindLabel: string, id: string): NoteTarget | null {
  const trimmed = id.trim()
  if (!trimmed) return null
  const kind = kindLabel.trim().toLowerCase()
  const data = getTopology()
  const isCircuit =
    kind === 'interruptor' ||
    data.circuits.some((c) => c.id === trimmed)
  const isEquipment =
    kind === 'equipo' || data.equipment.some((e) => e.id === trimmed)
  if (isCircuit && !isEquipment) return { kind: 'circuit', circuitId: trimmed }
  if (isEquipment && !isCircuit) {
    return { kind: 'equipment', equipmentId: trimmed }
  }
  if (isCircuit) return { kind: 'circuit', circuitId: trimmed }
  if (isEquipment) return { kind: 'equipment', equipmentId: trimmed }
  if (kind === 'interruptor') return { kind: 'circuit', circuitId: trimmed }
  if (kind === 'equipo') return { kind: 'equipment', equipmentId: trimmed }
  return { kind: 'equipment', equipmentId: trimmed }
}

function targetIdOf(note: InspectionNote): string {
  return note.target.kind === 'circuit'
    ? note.target.circuitId
    : note.target.equipmentId
}

function identityKey(note: InspectionNote): string {
  return [
    targetIdOf(note),
    note.author.trim().toLowerCase(),
    note.createdAt.slice(0, 16),
  ].join('|')
}

function contentKey(note: InspectionNote): string {
  const lines = note.lines
    .map((l) => l.text.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('\n')
  return `${targetIdOf(note)}::${lines}`
}

function parsePackedBullets(raw: string): NoteLine[] {
  const out: NoteLine[] = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed === '(sin texto)') continue
    const marked = trimmed.match(/^([☑☐✓✔✗✘])\s+(.*)$/)
    if (marked) {
      const text = marked[2].trim()
      if (!text) continue
      const resolved = marked[1] === '☑' || marked[1] === '✓' || marked[1] === '✔'
      out.push({ id: createLineId(), text, resolved })
      continue
    }
    const text = trimmed.replace(/^\s*[•\-*]\s*/, '').trim()
    if (!text) continue
    out.push({ id: createLineId(), text, resolved: false })
  }
  return out
}

function findHeaderRow(
  ws: ExcelJS.Worksheet,
  required: string[],
): { row: number; col: Map<string, number> } | null {
  const want = required.map((h) => h.toLowerCase())
  for (let r = 1; r <= Math.min(ws.rowCount, 12); r++) {
    const col = new Map<string, number>()
    const row = ws.getRow(r)
    row.eachCell((cell, c) => {
      const name = cellText(cell).trim().toLowerCase()
      if (name) col.set(name, c)
    })
    if (want.every((h) => col.has(h))) return { row: r, col }
  }
  return null
}

function parseBackupSheet(
  ws: ExcelJS.Worksheet,
  vesselId: VesselId,
): InspectionNote[] {
  const header = findHeaderRow(ws, ['noteid', 'lineid', 'kind', 'targetid', 'text'])
  if (!header) return []
  const col = header.col
  const byId = new Map<string, InspectionNote>()
  for (let r = header.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const noteId = cellText(row.getCell(col.get('noteid')!)).trim()
    const lineId = cellText(row.getCell(col.get('lineid')!)).trim()
    const kind = cellText(row.getCell(col.get('kind')!)).trim()
    const targetId = cellText(row.getCell(col.get('targetid')!)).trim()
    const text = cellText(row.getCell(col.get('text')!)).trim()
    if (!noteId || !targetId) continue
    const target = targetFromRow(
      kind === 'circuit' ? 'Interruptor' : 'Equipo',
      targetId,
    )
    if (!target) continue
    const resolvedRaw = cellText(row.getCell(col.get('resolved') ?? 0)).trim()
    const resolved =
      resolvedRaw === '1' ||
      resolvedRaw.toLowerCase() === 'true' ||
      resolvedRaw.toLowerCase() === 'sí' ||
      resolvedRaw.toLowerCase() === 'si'
    const line: NoteLine = {
      id: lineId || createLineId(),
      text,
      resolved,
      resolvedAt: cellText(row.getCell(col.get('resolvedat') ?? 0)).trim() || undefined,
      resolvedBy: cellText(row.getCell(col.get('resolvedby') ?? 0)).trim() || undefined,
      resolvedById:
        cellText(row.getCell(col.get('resolvedbyid') ?? 0)).trim() || undefined,
      resolvedUpdatedAt:
        cellText(row.getCell(col.get('resolvedupdatedat') ?? 0)).trim() ||
        undefined,
      textUpdatedAt:
        cellText(row.getCell(col.get('textupdatedat') ?? 0)).trim() || undefined,
    }
    const existing = byId.get(noteId)
    if (existing) {
      if (line.text) existing.lines.push(line)
      continue
    }
    const createdAt =
      cellText(row.getCell(col.get('createdat') ?? 0)).trim() ||
      new Date().toISOString()
    const updatedAt =
      cellText(row.getCell(col.get('updatedat') ?? 0)).trim() || createdAt
    const deletedAt = cellText(row.getCell(col.get('deletedat') ?? 0)).trim()
    const rowVessel = cellText(row.getCell(col.get('vesselid') ?? 0)).trim()
    byId.set(noteId, {
      id: noteId,
      vesselId: isVesselId(rowVessel) ? rowVessel : vesselId,
      target,
      author: cellText(row.getCell(col.get('author') ?? 0)).trim(),
      authorId: cellText(row.getCell(col.get('authorid') ?? 0)).trim(),
      createdAt,
      updatedAt,
      deletedAt: deletedAt || undefined,
      lines: line.text ? [line] : [],
    })
  }
  return [...byId.values()].map((n) => ({ ...n, vesselId }))
}

function parseLineasSheet(
  ws: ExcelJS.Worksheet,
  vesselId: VesselId,
): InspectionNote[] {
  const header =
    findHeaderRow(ws, ['id', 'línea', 'autor']) ??
    findHeaderRow(ws, ['id', 'viñeta', 'autor'])
  if (!header) return []
  const textCol =
    header.col.get('línea') ?? header.col.get('viñeta')
  if (textCol == null) return []
  type Acc = {
    key: string
    target: NoteTarget
    author: string
    createdAt: string
    lines: NoteLine[]
  }
  const groups = new Map<string, Acc>()
  const order: string[] = []
  for (let r = header.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const id = cellText(row.getCell(header.col.get('id')!)).trim()
    const text = cellText(row.getCell(textCol)).trim()
    if (!id || !text) continue
    const kind = cellText(row.getCell(header.col.get('tipo') ?? 0))
    const target = targetFromRow(kind, id)
    if (!target) continue
    const author = cellText(row.getCell(header.col.get('autor') ?? 0)).trim()
    const createdAt =
      cellDateIso(row.getCell(header.col.get('creada') ?? 0)) ??
      new Date().toISOString()
    const status = cellText(row.getCell(header.col.get('estado') ?? 0))
      .trim()
      .toLowerCase()
    const resolved = status === 'resuelta'
    const key = `${id}|${author}|${createdAt.slice(0, 16)}`
    let g = groups.get(key)
    if (!g) {
      g = { key, target, author, createdAt, lines: [] }
      groups.set(key, g)
      order.push(key)
    }
    const resolvedBy = cellText(
      row.getCell(header.col.get('confirmada por') ?? 0),
    ).trim()
    const resolvedAt = cellDateIso(
      row.getCell(header.col.get('confirmada el') ?? 0),
    )
    g.lines.push({
      id: createLineId(),
      text,
      resolved,
      resolvedAt: resolved ? resolvedAt : undefined,
      resolvedBy: resolved && resolvedBy ? resolvedBy : undefined,
      resolvedUpdatedAt: resolved ? resolvedAt : undefined,
    })
  }
  return order.map((key) => {
    const g = groups.get(key)!
    return {
      id: createNoteId(),
      vesselId,
      target: g.target,
      author: g.author,
      authorId: '',
      createdAt: g.createdAt,
      updatedAt: g.createdAt,
      lines: g.lines,
    }
  })
}

function parseNotasSheet(
  ws: ExcelJS.Worksheet,
  vesselId: VesselId,
): InspectionNote[] {
  const header =
    findHeaderRow(ws, ['id', 'líneas', 'autor']) ??
    findHeaderRow(ws, ['id', 'viñetas', 'autor'])
  if (!header) return []
  const packedCol =
    header.col.get('líneas') ?? header.col.get('viñetas')
  if (packedCol == null) return []
  const out: InspectionNote[] = []
  for (let r = header.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const id = cellText(row.getCell(header.col.get('id')!)).trim()
    const packed = cellText(row.getCell(packedCol))
    if (!id) continue
    const lines = parsePackedBullets(packed)
    if (lines.length === 0) continue
    const kind = cellText(row.getCell(header.col.get('tipo') ?? 0))
    const target = targetFromRow(kind, id)
    if (!target) continue
    const createdAt =
      cellDateIso(row.getCell(header.col.get('creada') ?? 0)) ??
      new Date().toISOString()
    out.push({
      id: createNoteId(),
      vesselId,
      target,
      author: cellText(row.getCell(header.col.get('autor') ?? 0)).trim(),
      authorId: '',
      createdAt,
      updatedAt: createdAt,
      lines,
    })
  }
  return out
}

export async function parseNotesExcel(
  data: ArrayBuffer,
  vesselId: VesselId,
): Promise<{ notes: InspectionNote[]; source: 'backup' | 'report' }> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(data)
  const backup = wb.getWorksheet(NOTES_BACKUP_SHEET)
  if (backup) {
    const notes = parseBackupSheet(backup, vesselId)
    if (notes.length > 0) return { notes, source: 'backup' }
  }
  const lineas = wb.worksheets.find((s) => {
    const name = s.name.trim().toLowerCase()
    return name === 'líneas' || name === 'lineas' || name === 'viñetas'
  })
  if (lineas) {
    const notes = parseLineasSheet(lineas, vesselId)
    if (notes.length > 0) return { notes, source: 'report' }
  }
  const notas = wb.worksheets.find(
    (s) => s.name.trim().toLowerCase() === 'notas',
  )
  if (notas) {
    const notes = parseNotasSheet(notas, vesselId)
    if (notes.length > 0) return { notes, source: 'report' }
  }
  throw new Error(
    'El Excel no parece un informe de notas (faltan las hojas Notas / Líneas).',
  )
}

function findMatch(
  incoming: InspectionNote,
  existing: Map<string, InspectionNote>,
): InspectionNote | undefined {
  const byId = existing.get(incoming.id)
  if (byId && incoming.id.length > 12) return byId
  const ident = identityKey(incoming)
  for (const n of existing.values()) {
    if (identityKey(n) === ident) return n
  }
  const content = contentKey(incoming)
  if (!content.endsWith('::')) {
    for (const n of existing.values()) {
      if (contentKey(n) === content) return n
    }
  }
  return undefined
}

export function mergeExcelNotes(
  vesselId: VesselId,
  existing: InspectionNote[],
  incoming: InspectionNote[],
): ExcelImportResult {
  const byId = new Map(existing.map((n) => [n.id, { ...n, vesselId }]))
  let added = 0
  let updated = 0
  let skipped = 0
  const now = new Date().toISOString()

  for (const raw of incoming) {
    const next: InspectionNote = {
      ...raw,
      vesselId,
      lines: raw.lines.filter((l) => l.text.trim()),
    }
    if (next.lines.length === 0) {
      skipped += 1
      continue
    }
    const prev = findMatch(next, byId)
    if (!prev) {
      const id = next.id && !byId.has(next.id) ? next.id : createNoteId()
      byId.set(id, { ...next, id, deletedAt: undefined, updatedAt: now })
      added += 1
      continue
    }
    const restored = Boolean(prev.deletedAt)
    const incomingNewer = next.updatedAt > prev.updatedAt
    if (!restored && !incomingNewer && contentKey(prev) === contentKey(next)) {
      skipped += 1
      continue
    }
    byId.set(prev.id, {
      ...prev,
      ...next,
      id: prev.id,
      vesselId,
      author: next.author.trim() ? next.author : prev.author,
      authorId: next.authorId || prev.authorId,
      createdAt: prev.createdAt,
      updatedAt: now,
      deletedAt: undefined,
      lines:
        next.lines.length > 0
          ? next.lines.map((l, i) => ({
              ...l,
              id: prev.lines[i]?.id ?? l.id,
            }))
          : prev.lines,
    })
    updated += 1
  }

  return {
    notes: [...byId.values()],
    added,
    updated,
    skipped,
    source: 'report',
  }
}
