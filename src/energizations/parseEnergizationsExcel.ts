import * as XLSX from 'xlsx'
import type { EnergizationEntry } from './types'

const MAX_SHEET_ROWS = 50_000
const MAX_ENTRIES = 30_000

function cellStr(v: unknown): string {
  if (v == null || v === '') return ''
  return String(v).trim()
}

function parseEnergized(raw: string): boolean | null {
  const s = raw.trim().toUpperCase()
  if (s === 'SI' || s === 'SÍ' || s === 'S' || s === 'YES' || s === '1') {
    return true
  }
  if (s === 'NO' || s === 'N' || s === '0') return false
  return null
}

/**
 * Excel «ControlSeguimientoEnergizaciones»:
 * A = código cable, B = origen, C = destino, E = SI/NO energizado.
 */
export function parseEnergizationsExcel(data: ArrayBuffer): EnergizationEntry[] {
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
      .toUpperCase(),
  )
  const colCode = header.findIndex((h) => h.includes('CODIGO') || h === 'CÓDIGO')
  const colOrig = header.findIndex((h) => h.includes('ORIGEN'))
  const colDest = header.findIndex((h) => h.includes('DESTINO'))
  const colEn = header.findIndex(
    (h) => h.includes('ENERGIZ') || h.includes('CABLE ENERGIZADO'),
  )

  const iCode = colCode >= 0 ? colCode : 0
  const iOrig = colOrig >= 0 ? colOrig : 1
  const iDest = colDest >= 0 ? colDest : 2
  const iEn = colEn >= 0 ? colEn : 4

  const out: EnergizationEntry[] = []
  for (let r = 1; r < rows.length && out.length < MAX_ENTRIES; r++) {
    const row = rows[r]
    if (!row) continue
    const cableCode = cellStr(row[iCode])
    if (!cableCode) continue
    const energized = parseEnergized(cellStr(row[iEn]))
    if (energized == null) continue
    out.push({
      cableCode,
      originId: cellStr(row[iOrig]),
      destinationId: cellStr(row[iDest]),
      energized,
    })
  }
  return out
}
