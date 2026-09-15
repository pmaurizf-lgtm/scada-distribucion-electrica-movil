import ExcelJS from 'exceljs'
import { vesselById, type VesselId } from '../vessels/vesselCatalog'
import { kindLabelForNoteTarget, labelForNoteTarget } from './labels'
import { NOTES_BACKUP_SHEET } from './importExcel'
import {
  isNoteFullyResolved,
  openLineCount,
  type InspectionNote,
  type NoteTarget,
} from './types'

const COLORS = {
  title: '0D47A1',
  headerBg: '1565C0',
  headerFg: 'FFFFFF',
  muted: '546E7A',
  text: '1A2330',
  kpiBg: 'E3F2FD',
  openBg: 'FFF8E1',
  openFg: 'E65100',
  resolvedBg: 'E8F5E9',
  resolvedFg: '1B5E20',
  partialBg: 'FFF3E0',
  thin: 'CFD8DC',
  zebra: 'FAFBFC',
}

function thinBorder(color = COLORS.thin): Partial<ExcelJS.Borders> {
  const side: ExcelJS.Border = { style: 'thin', color: { argb: `FF${color}` } }
  return { top: side, left: side, bottom: side, right: side }
}

function targetId(target: NoteTarget): string {
  return target.kind === 'circuit' ? target.circuitId : target.equipmentId
}

function noteStatus(note: InspectionNote): 'Resuelta' | 'Parcial' | 'Abierta' {
  if (isNoteFullyResolved(note)) return 'Resuelta'
  if (note.lines.some((l) => l.resolved)) return 'Parcial'
  return 'Abierta'
}

function asDate(iso?: string): Date | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? undefined : d
}

function paintHeader(row: ExcelJS.Row): void {
  row.height = 22
  row.eachCell((cell) => {
    cell.font = {
      bold: true,
      size: 10,
      color: { argb: `FF${COLORS.headerFg}` },
    }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: `FF${COLORS.headerBg}` },
    }
    cell.alignment = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: true,
    }
    cell.border = thinBorder('0D47A1')
  })
}

function statusFill(status: string): { bg: string; fg: string } {
  if (status === 'Resuelta') {
    return { bg: COLORS.resolvedBg, fg: COLORS.resolvedFg }
  }
  if (status === 'Parcial') {
    return { bg: COLORS.partialBg, fg: COLORS.openFg }
  }
  return { bg: COLORS.openBg, fg: COLORS.openFg }
}

async function saveWorkbook(
  wb: ExcelJS.Workbook,
  filename: string,
): Promise<void> {
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const file = new File([blob], filename, { type: blob.type })
  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean
  }
  if (typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename })
      return
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
    }
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function addTitle(
  ws: ExcelJS.Worksheet,
  title: string,
  subtitle: string,
  cols: number,
): void {
  const titleRow = ws.addRow([title])
  titleRow.height = 24
  ws.mergeCells(1, 1, 1, cols)
  titleRow.getCell(1).font = {
    bold: true,
    size: 14,
    color: { argb: `FF${COLORS.title}` },
  }
  titleRow.getCell(1).alignment = { vertical: 'middle' }

  const sub = ws.addRow([subtitle])
  ws.mergeCells(2, 1, 2, cols)
  sub.getCell(1).font = {
    size: 9,
    italic: true,
    color: { argb: `FF${COLORS.muted}` },
  }
}

function addSummarySheet(
  wb: ExcelJS.Workbook,
  vesselLabel: string,
  notes: InspectionNote[],
): void {
  const ws = wb.addWorksheet('Resumen', {
    views: [{ showGridLines: false }],
    properties: { defaultRowHeight: 18 },
  })
  ws.pageSetup = {
    paperSize: 9,
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
  }

  const bullets = notes.reduce((n, note) => n + note.lines.length, 0)
  const openBullets = notes.reduce((n, note) => n + openLineCount(note), 0)
  const resolvedNotes = notes.filter(isNoteFullyResolved).length
  const exportedAt = new Date().toLocaleString('es-ES', {
    dateStyle: 'long',
    timeStyle: 'short',
  })

  addTitle(
    ws,
    `Notas de revisión · ${vesselLabel}`,
    `Exportado ${exportedAt} · ${notes.length} nota${notes.length === 1 ? '' : 's'} · ${bullets} viñeta${bullets === 1 ? '' : 's'}`,
    5,
  )
  ws.addRow([])

  const kpiHeader = ws.addRow(['Notas', 'Resueltas', 'Parciales / abiertas', 'Viñetas abiertas', 'Viñetas resueltas'])
  paintHeader(kpiHeader)
  const kpi = ws.addRow([
    notes.length,
    resolvedNotes,
    notes.length - resolvedNotes,
    openBullets,
    bullets - openBullets,
  ])
  kpi.height = 28
  kpi.eachCell((cell) => {
    cell.font = { bold: true, size: 16, color: { argb: `FF${COLORS.title}` } }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: `FF${COLORS.kpiBg}` },
    }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    cell.border = thinBorder()
  })
  kpi.getCell(4).font = {
    bold: true,
    size: 16,
    color: { argb: `FF${COLORS.openFg}` },
  }

  ws.addRow([])
  ws.addRow(['Por equipo / interruptor']).getCell(1).font = {
    bold: true,
    size: 11,
    color: { argb: `FF${COLORS.title}` },
  }

  const destHeader = ws.addRow(['Destino', 'Tipo', 'Abiertas', 'Resueltas', 'Total viñetas'])
  paintHeader(destHeader)

  const destMap = new Map<
    string,
    { label: string; kind: string; open: number; resolved: number; total: number }
  >()
  for (const note of notes) {
    const key = `${kindLabelForNoteTarget(note.target)}|${labelForNoteTarget(note.target)}`
    let row = destMap.get(key)
    if (!row) {
      row = {
        label: labelForNoteTarget(note.target),
        kind: kindLabelForNoteTarget(note.target),
        open: 0,
        resolved: 0,
        total: 0,
      }
      destMap.set(key, row)
    }
    row.open += openLineCount(note)
    row.resolved += note.lines.filter((l) => l.resolved).length
    row.total += note.lines.length
  }

  const destRows = [...destMap.values()].sort((a, b) => {
    if (b.open !== a.open) return b.open - a.open
    return a.label.localeCompare(b.label, 'es')
  })
  for (const d of destRows) {
    const r = ws.addRow([d.label, d.kind, d.open, d.resolved, d.total])
    r.eachCell((cell, col) => {
      cell.border = thinBorder()
      cell.alignment = {
        vertical: 'middle',
        horizontal: col >= 3 ? 'center' : 'left',
        wrapText: col === 1,
      }
      cell.font = { size: 9, color: { argb: `FF${COLORS.text}` } }
      if (col === 3 && d.open > 0) {
        cell.font = { size: 9, bold: true, color: { argb: `FF${COLORS.openFg}` } }
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: `FF${COLORS.openBg}` },
        }
      }
    })
  }

  ws.addRow([])
  ws.addRow(['Por autor']).getCell(1).font = {
    bold: true,
    size: 11,
    color: { argb: `FF${COLORS.title}` },
  }
  const authorHeader = ws.addRow(['Autor', 'Notas', 'Viñetas abiertas', 'Viñetas resueltas', ''])
  paintHeader(authorHeader)

  const authorMap = new Map<string, { notes: number; open: number; resolved: number }>()
  for (const note of notes) {
    const name = note.author.trim() || '(sin nombre)'
    const prev = authorMap.get(name) ?? { notes: 0, open: 0, resolved: 0 }
    prev.notes += 1
    prev.open += openLineCount(note)
    prev.resolved += note.lines.filter((l) => l.resolved).length
    authorMap.set(name, prev)
  }
  for (const [name, a] of [...authorMap.entries()].sort((x, y) =>
    x[0].localeCompare(y[0], 'es'),
  )) {
    const r = ws.addRow([name, a.notes, a.open, a.resolved, ''])
    r.eachCell((cell, col) => {
      cell.border = thinBorder()
      cell.alignment = {
        vertical: 'middle',
        horizontal: col >= 2 && col <= 4 ? 'center' : 'left',
      }
      cell.font = { size: 9, color: { argb: `FF${COLORS.text}` } }
    })
  }

  ws.columns = [
    { width: 42 },
    { width: 16 },
    { width: 18 },
    { width: 20 },
    { width: 16 },
  ]
}

function addNotesSheet(
  wb: ExcelJS.Workbook,
  vesselLabel: string,
  notes: InspectionNote[],
): void {
  const ws = wb.addWorksheet('Notas', {
    views: [{ state: 'frozen', ySplit: 3 }],
    properties: { defaultRowHeight: 18 },
  })
  ws.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.25, footer: 0.25 },
  }

  addTitle(
    ws,
    `Notas · ${vesselLabel}`,
    'Una fila por nota. Las viñetas van juntas para leer el bloque completo. Filtra por estado.',
    8,
  )

  const header = ws.addRow([
    'Estado',
    'Tipo',
    'Equipo / interruptor',
    'ID',
    'Viñetas',
    'Abiertas',
    'Autor',
    'Creada',
  ])
  paintHeader(header)

  const sorted = [...notes].sort((a, b) => {
    const sa = noteStatus(a)
    const sb = noteStatus(b)
    const order = { Abierta: 0, Parcial: 1, Resuelta: 2 }
    if (order[sa] !== order[sb]) return order[sa] - order[sb]
    const la = labelForNoteTarget(a.target)
    const lb = labelForNoteTarget(b.target)
    const cmp = la.localeCompare(lb, 'es')
    if (cmp !== 0) return cmp
    return b.createdAt.localeCompare(a.createdAt)
  })

  for (const note of sorted) {
    const status = noteStatus(note)
    const bullets = note.lines
      .map((l) => `${l.resolved ? '☑' : '☐'}  ${l.text}`)
      .join('\n')
    const row = ws.addRow([
      status,
      kindLabelForNoteTarget(note.target),
      labelForNoteTarget(note.target),
      targetId(note.target),
      bullets || '(sin texto)',
      openLineCount(note),
      note.author,
      asDate(note.createdAt) ?? note.createdAt,
    ])
    const fill = statusFill(status)
    const lines = Math.max(1, note.lines.length)
    row.height = Math.min(18 + lines * 14, 90)
    row.eachCell((cell, col) => {
      cell.border = thinBorder()
      cell.alignment = {
        vertical: 'top',
        horizontal: col === 1 || col === 6 ? 'center' : 'left',
        wrapText: col === 3 || col === 5,
      }
      cell.font = { size: 9, color: { argb: `FF${COLORS.text}` } }
      if (col === 1) {
        cell.font = { size: 9, bold: true, color: { argb: `FF${fill.fg}` } }
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: `FF${fill.bg}` },
        }
      } else if (status === 'Resuelta') {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: `FF${COLORS.resolvedBg}` },
        }
      }
      if (col === 8 && cell.value instanceof Date) {
        cell.numFmt = 'dd/mm/yyyy hh:mm'
      }
    })
  }

  ws.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3 + sorted.length, column: 8 },
  }
  ws.columns = [
    { width: 12 },
    { width: 14 },
    { width: 36 },
    { width: 22 },
    { width: 56 },
    { width: 11 },
    { width: 18 },
    { width: 18 },
  ]
}

function addBulletsSheet(
  wb: ExcelJS.Workbook,
  vesselLabel: string,
  notes: InspectionNote[],
): void {
  const ws = wb.addWorksheet('Viñetas', {
    views: [{ state: 'frozen', ySplit: 3 }],
    properties: { defaultRowHeight: 20 },
  })
  ws.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.25, footer: 0.25 },
  }

  addTitle(
    ws,
    `Viñetas · ${vesselLabel}`,
    'Una fila por punto. Usa el filtro de Estado para quedarte solo con lo abierto.',
    10,
  )

  const header = ws.addRow([
    'Estado',
    'Tipo',
    'Equipo / interruptor',
    'ID',
    'Viñeta',
    'Nº',
    'Autor',
    'Creada',
    'Confirmada por',
    'Confirmada el',
  ])
  paintHeader(header)

  type BulletRow = {
    status: string
    kind: string
    label: string
    id: string
    text: string
    index: string
    author: string
    created?: Date
    resolvedBy: string
    resolvedAt?: Date
  }

  const rows: BulletRow[] = []
  const sortedNotes = [...notes].sort((a, b) => {
    const cmp = labelForNoteTarget(a.target).localeCompare(
      labelForNoteTarget(b.target),
      'es',
    )
    if (cmp !== 0) return cmp
    return a.createdAt.localeCompare(b.createdAt)
  })
  for (const note of sortedNotes) {
    note.lines.forEach((line, i) => {
      rows.push({
        status: line.resolved ? 'Resuelta' : 'Abierta',
        kind: kindLabelForNoteTarget(note.target),
        label: labelForNoteTarget(note.target),
        id: targetId(note.target),
        text: line.text,
        index: `${i + 1}/${note.lines.length}`,
        author: note.author,
        created: asDate(note.createdAt),
        resolvedBy: line.resolved ? (line.resolvedBy ?? '') : '',
        resolvedAt: line.resolved ? asDate(line.resolvedAt) : undefined,
      })
    })
  }
  rows.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'Abierta' ? -1 : 1
    return a.label.localeCompare(b.label, 'es')
  })

  for (const [i, r] of rows.entries()) {
    const excelRow = ws.addRow([
      r.status,
      r.kind,
      r.label,
      r.id,
      r.text,
      r.index,
      r.author,
      r.created ?? '',
      r.resolvedBy,
      r.resolvedAt ?? '',
    ])
    const fill = statusFill(r.status)
    excelRow.eachCell((cell, col) => {
      cell.border = thinBorder()
      cell.alignment = {
        vertical: 'middle',
        horizontal: col === 1 || col === 6 ? 'center' : 'left',
        wrapText: col === 3 || col === 5,
      }
      cell.font = { size: 9, color: { argb: `FF${COLORS.text}` } }
      if (col === 1) {
        cell.font = { size: 9, bold: true, color: { argb: `FF${fill.fg}` } }
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: `FF${fill.bg}` },
        }
      } else if (r.status === 'Abierta') {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: `FF${COLORS.openBg}` },
        }
      } else if (i % 2 === 1) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: `FF${COLORS.zebra}` },
        }
      }
      if ((col === 8 || col === 10) && cell.value instanceof Date) {
        cell.numFmt = 'dd/mm/yyyy hh:mm'
      }
    })
    if (r.text.length > 80) excelRow.height = 32
  }

  ws.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3 + rows.length, column: 10 },
  }
  ws.columns = [
    { width: 12 },
    { width: 14 },
    { width: 34 },
    { width: 22 },
    { width: 52 },
    { width: 8 },
    { width: 16 },
    { width: 18 },
    { width: 16 },
    { width: 18 },
  ]
}

export async function exportNotesExcel(
  vesselId: VesselId,
  notes: InspectionNote[],
): Promise<void> {
  const vessel = vesselById(vesselId)
  const wb = new ExcelJS.Workbook()
  wb.creator = 'SCADA distribución eléctrica'
  wb.created = new Date()
  wb.lastModifiedBy = 'SCADA F110'

  addSummarySheet(wb, vessel.label, notes)
  addNotesSheet(wb, vessel.label, notes)
  addBulletsSheet(wb, vessel.label, notes)
  addBackupSheet(wb, vesselId, notes)

  const day = new Date().toISOString().slice(0, 10)
  await saveWorkbook(wb, `notas-${vesselId}-${day}.xlsx`)
}

function addBackupSheet(
  wb: ExcelJS.Workbook,
  vesselId: VesselId,
  notes: InspectionNote[],
): void {
  const ws = wb.addWorksheet(NOTES_BACKUP_SHEET)
  ws.state = 'hidden'
  ws.addRow([
    'noteId',
    'lineId',
    'vesselId',
    'kind',
    'targetId',
    'author',
    'authorId',
    'createdAt',
    'updatedAt',
    'deletedAt',
    'text',
    'resolved',
    'resolvedAt',
    'resolvedBy',
    'resolvedById',
    'resolvedUpdatedAt',
    'textUpdatedAt',
  ])
  for (const note of notes) {
    const tid =
      note.target.kind === 'circuit'
        ? note.target.circuitId
        : note.target.equipmentId
    for (const line of note.lines) {
      ws.addRow([
        note.id,
        line.id,
        vesselId,
        note.target.kind,
        tid,
        note.author,
        note.authorId,
        note.createdAt,
        note.updatedAt,
        note.deletedAt ?? '',
        line.text,
        line.resolved ? '1' : '0',
        line.resolvedAt ?? '',
        line.resolvedBy ?? '',
        line.resolvedById ?? '',
        line.resolvedUpdatedAt ?? '',
        line.textUpdatedAt ?? '',
      ])
    }
  }
}
