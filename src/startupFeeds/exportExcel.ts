import ExcelJS from 'exceljs'
import type { InspectionNote } from '../notes/types'
import type { StartupReport } from './types'
import {
  buildStartupTableRows,
  collectStartupBoards,
} from './tableRows'
function slug(title: string): string {
  return (
    title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      .slice(0, 48) || 'puesta-en-marcha'
  )
}

const COLORS = {
  title: '0D47A1',
  headerBg: '1565C0',
  headerFg: 'FFFFFF',
  summaryBg: 'E3F2FD',
  normBg: 'FAFBFC',
  altBg: 'FFF8E1',
  auxBg: 'F3E5F5',
  destBorder: '37474F',
  lineBorder: '90A4AE',
  thinBorder: 'CFD8DC',
  muted: '546E7A',
  text: '1A2330',
  ssbBg: 'E8F5E9',
}

function thinBorder(color = COLORS.thinBorder): Partial<ExcelJS.Borders> {
  const side: ExcelJS.Border = { style: 'thin', color: { argb: `FF${color}` } }
  return { top: side, left: side, bottom: side, right: side }
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

function addSsbSummarySheet(
  wb: ExcelJS.Workbook,
  report: StartupReport,
  notes: InspectionNote[] = [],
): void {
  const boards = collectStartupBoards(report, undefined, notes)
  const nSsb = boards.filter((b) => b.kind === 'SSB').length
  const nTrf = boards.filter((b) => b.kind === 'TRF').length
  const ws = wb.addWorksheet('SSB y TRF', {
    views: [{ state: 'frozen', ySplit: 3 }],
    properties: { defaultRowHeight: 18 },
  })

  ws.columns = [
    { header: 'Tipo', key: 'kind', width: 8 },
    { header: 'Código (PUMA)', key: 'id', width: 20 },
    { header: 'Nombre', key: 'name', width: 36 },
    { header: 'Código NME', key: 'nme', width: 16 },
    { header: 'Local', key: 'local', width: 14 },
    { header: 'Nombre local', key: 'localName', width: 36 },
    { header: 'Bloque', key: 'block', width: 14 },
    { header: 'Notas', key: 'notes', width: 48 },
  ]
  const titleRow = ws.addRow([
    'SSB y TRF necesarios para la puesta en marcha',
  ])
  titleRow.height = 24
  ws.mergeCells(1, 1, 1, 8)
  titleRow.getCell(1).font = {
    bold: true,
    size: 14,
    color: { argb: `FF${COLORS.title}` },
  }
  titleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' }

  const sub = ws.addRow([
    `Informe: ${report.title || 'Alimentaciones puesta en marcha'} · ${nSsb} SSB + ${nTrf} TRF (únicos, sin repeticiones) · destinos: ${report.resolvedIds.length} · TRF: aguas abajo de LCS, excl. TRF-6PWS y TRF interiores de SSB`,
  ])
  ws.mergeCells(2, 1, 2, 8)
  sub.getCell(1).font = {
    size: 9,
    italic: true,
    color: { argb: `FF${COLORS.muted}` },
  }

  const header = ws.addRow([
    'Tipo',
    'Código (PUMA)',
    'Nombre',
    'Código NME',
    'Local',
    'Nombre local',
    'Bloque',
    'Notas',
  ])
  paintHeader(header)

  if (!boards.length) {
    const empty = ws.addRow([
      '—',
      '—',
      'No aparecen SSB ni TRF (LCS→…) en las cadenas de este listado',
      '—',
      '—',
      '—',
      '—',
      '',
    ])
    empty.eachCell((cell) => {
      cell.font = {
        size: 9,
        italic: true,
        color: { argb: `FF${COLORS.muted}` },
      }
      cell.border = thinBorder()
    })
    return
  }

  for (const b of boards) {
    const row = ws.addRow([
      b.kind,
      b.equipmentId,
      b.name,
      b.nme674Id,
      b.local,
      b.localName,
      b.block,
      b.notes,
    ])
    const bg = b.kind === 'TRF' ? 'E3F2FD' : COLORS.ssbBg
    const noteLines = b.notes ? b.notes.split('\n').length : 1
    row.height = Math.min(18 + Math.max(0, noteLines - 1) * 12, 96)
    row.eachCell((cell, col) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: `FF${bg}` },
      }
      cell.font = {
        size: 9,
        color: { argb: `FF${COLORS.text}` },
        bold: col === 1 || col === 2,
      }
      cell.alignment = {
        vertical: 'top',
        horizontal: 'left',
        wrapText: col === 8,
      }
      cell.border = thinBorder()
    })
  }

  ws.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3 + Math.max(boards.length, 1), column: 8 },
  }
}

/**
 * Excel de la tabla resumen: cadena completa por destino,
 * con colores, bordes y separación entre alimentaciones.
 * Incluye hoja «SSB y TRF» (únicos, con NME, local, nombre local, bloque y notas).
 */
export async function exportStartupTableExcel(
  report: StartupReport,
  notes: InspectionNote[] = [],
): Promise<void> {
  const rows = buildStartupTableRows(report)
  const wb = new ExcelJS.Workbook()
  wb.creator = 'SCADA distribución eléctrica'
  wb.created = new Date()

  const sheetName = (report.title.trim() || 'Tabla resumen').slice(0, 31)
  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: 3 }],
    properties: { defaultRowHeight: 18 },
  })

  ws.columns = [
    { header: 'Destino', key: 'dest', width: 18 },
    { header: 'Local dest.', key: 'destLocal', width: 12 },
    { header: 'Línea', key: 'line', width: 12 },
    { header: 'Paso', key: 'step', width: 6 },
    { header: 'Equipo (cadena)', key: 'hop', width: 20 },
    { header: 'Local', key: 'hopLocal', width: 12 },
    { header: 'Protección entrada', key: 'prot', width: 18 },
    { header: 'Cadena completa', key: 'chain', width: 56 },
  ]

  const titleRow = ws.addRow([report.title || 'Alimentaciones puesta en marcha'])
  titleRow.height = 24
  ws.mergeCells(1, 1, 1, 8)
  titleRow.getCell(1).font = {
    bold: true,
    size: 14,
    color: { argb: `FF${COLORS.title}` },
  }
  titleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' }

  const sub = ws.addRow([
    `Destinos: ${report.resolvedIds.length}` +
      (report.unresolved.length
        ? ` · No encontrados: ${report.unresolved.length}`
        : '') +
      ' · Cada bloque muestra la cadena fuente → destino (Normal, Alternativa y AUX 24 V si existen).',
  ])
  ws.mergeCells(2, 1, 2, 8)
  sub.getCell(1).font = {
    size: 9,
    italic: true,
    color: { argb: `FF${COLORS.muted}` },
  }

  const header = ws.addRow([
    'Destino',
    'Local dest.',
    'Línea',
    'Paso',
    'Equipo (cadena)',
    'Local',
    'Protección entrada',
    'Cadena completa',
  ])
  paintHeader(header)

  for (const r of rows) {
    const excelRow = ws.addRow([
      r.isDestStart || r.isLineStart ? r.destEquip : '',
      r.isDestStart || r.isLineStart ? r.destLocal : '',
      r.isLineStart ? r.lineLabel : '',
      r.step,
      r.hopEquip,
      r.hopLocal,
      r.hopProt,
      r.chainSummary,
    ])

    const bg =
      r.isDestStart && r.chainSummary
        ? COLORS.summaryBg
        : r.lineKind === 'alternativa'
          ? COLORS.altBg
          : r.lineKind === 'aux'
            ? COLORS.auxBg
            : COLORS.normBg

    excelRow.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: `FF${bg}` },
      }
      cell.font = {
        size: 9,
        color: { argb: `FF${COLORS.text}` },
        bold: col === 1 && (r.isDestStart || r.isLineStart),
      }
      cell.alignment = {
        vertical: 'middle',
        horizontal: col === 4 ? 'center' : 'left',
        wrapText: col === 8,
      }
      cell.border = thinBorder()
    })

    if (r.isDestStart) {
      excelRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = {
          ...thinBorder(),
          top: {
            style: 'medium',
            color: { argb: `FF${COLORS.destBorder}` },
          },
        }
      })
      if (r.chainSummary) excelRow.height = 28
    } else if (r.isLineStart) {
      excelRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = {
          ...thinBorder(),
          top: {
            style: 'thin',
            color: { argb: `FF${COLORS.lineBorder}` },
          },
        }
      })
    }
  }

  ws.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3 + rows.length, column: 8 },
  }

  addSsbSummarySheet(wb, report, notes)

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `informe-puesta-en-marcha-${slug(report.title)}.xlsx`
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}
