import * as XLSX from 'xlsx'
import type { EntregaEntry } from './types'

const MAX_SHEET_ROWS = 50_000
const MAX_ENTRIES = 30_000

function cellStr(v: unknown): string {
  if (v == null || v === '') return ''
  return String(v).trim()
}

function parseSiNo(raw: string): boolean | null {
  const s = raw.trim().toUpperCase().replace(/\s+/g, '')
  if (
    s === 'SI' ||
    s === 'SÍ' ||
    s === 'S' ||
    s === 'YES' ||
    s === '1' ||
    s === 'TRUE' ||
    s === 'X'
  ) {
    return true
  }
  if (s === 'NO' || s === 'N' || s === '0' || s === 'FALSE') return false
  return null
}

/**
 * Excel estado entregas:
 * - Col. A (o cabecera Equipo/PUMA/…): equipo
 * - Col. H (o cabecera instalación completa): SI/NO
 * - Col. Entregado (opcional, por cabecera): SI/NO → triángulo verde
 */
export function parseEntregasExcel(data: ArrayBuffer): EntregaEntry[] {
  const wb = XLSX.read(data, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return []
  const sheet = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: null,
    raw: false,
  }) as (string | number | null)[][]
  if (rows.length < 2 || rows.length > MAX_SHEET_ROWS) return []

  const header = (rows[0] ?? []).map((c) =>
    String(c ?? '')
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, ''),
  )

  const colEq = header.findIndex(
    (h) =>
      h.includes('EQUIPO') ||
      h.includes('PUMA') ||
      h.includes('TAG') ||
      h === 'CODIGO' ||
      h === 'CODIGO EQUIPO' ||
      h.includes('DCP'),
  )
  const colInstall = header.findIndex(
    (h) =>
      (h.includes('INSTAL') && h.includes('COMPLET')) ||
      h.includes('INSTALACION COMPLETA') ||
      h === 'INSTALACION COMPLETA' ||
      h.includes('INST. COMPLET'),
  )
  const colDelivered = header.findIndex(
    (h) =>
      h === 'ENTREGADO' ||
      h === 'ENTREGADA' ||
      h.includes('ENTREGADO') ||
      (h.includes('ENTREGA') && !h.includes('FECHA')),
  )

  const iEq = colEq >= 0 ? colEq : 0
  const iInstall = colInstall >= 0 ? colInstall : 7
  const iDelivered = colDelivered >= 0 ? colDelivered : -1

  const out: EntregaEntry[] = []
  const seen = new Set<string>()
  for (let r = 1; r < rows.length && out.length < MAX_ENTRIES; r++) {
    const row = rows[r]
    if (!row) continue
    const equipmentRef = cellStr(row[iEq])
    if (!equipmentRef) continue
    const key = equipmentRef.trim().toUpperCase()
    if (seen.has(key)) continue
    const installComplete = parseSiNo(cellStr(row[iInstall]))
    if (installComplete == null) continue
    const delivered =
      iDelivered >= 0
        ? (parseSiNo(cellStr(row[iDelivered])) ?? false)
        : false
    seen.add(key)
    out.push({ equipmentRef, installComplete, delivered })
  }
  return out
}
