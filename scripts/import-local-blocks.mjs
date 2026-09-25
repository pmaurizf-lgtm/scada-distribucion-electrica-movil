/**
 * Genera src/data/localBlocks.json desde:
 *  - LISTA DE COMPARTIMENTOS → col. AL «BLOQUES VALIDOS» (por LOCAL)
 *  - Relación de SSB completa con NME → col. «GEN BLOQUE» (por ELEMENTO / NME / local)
 *
 * Uso: node scripts/import-local-blocks.mjs
 */
import { readdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SRC_DIR =
  process.env.SCADA_SOURCE_DIR ||
  'C:/Users/pmouriz/Documents/Archivos fuente APP Distribución'
const OUT = join(ROOT, 'src/data/localBlocks.json')

function cellStr(v) {
  if (v == null) return null
  if (typeof v === 'number' && Number.isNaN(v)) return null
  const s = String(v).trim()
  return s || null
}

/** Misma filosofía que deckPlans/normalize: canónica sin ceros a la izquierda. */
function normalizeLocalCode(raw) {
  if (!raw?.trim()) return null
  const s = String(raw)
    .trim()
    .toUpperCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, '')
  const m = /([0-9IL]{1,2})-(\d{1,3})-(\d{1,2})-([A-Z0-9])/i.exec(s)
  if (!m) return null
  let a = m[1].toUpperCase()
  if (a === 'I' || a === 'L') a = '1'
  a = String(Number.parseInt(a.replace(/O/gi, '0'), 10))
  if (!a || a === '0' || !Number.isFinite(+a)) return null
  const b = String(Number.parseInt(m[2].replace(/O/gi, '0'), 10))
  const c = String(Number.parseInt(m[3].replace(/O/gi, '0'), 10))
  const d = m[4].toUpperCase()
  if (!b || c === '' || !d) return null
  return `${a}-${b}-${c}-${d}`
}

function localKeyFromCell(raw) {
  const full = cellStr(raw)
  if (!full) return null
  return normalizeLocalCode(full) || full.split(/\s+/)[0]?.toUpperCase() || null
}

function findCol(headerRow, ...needles) {
  const hdr = (headerRow || []).map((h) =>
    String(h ?? '')
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, ''),
  )
  for (const needle of needles) {
    const n = needle
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
    const i = hdr.findIndex((h) => h === n || h.includes(n))
    if (i >= 0) return i
  }
  return -1
}

function cleanBlock(raw) {
  const s = cellStr(raw)
  if (!s) return null
  // Evitar planos tipo 8320318301N si por error se leyó la col. de plano
  if (/^[0-9]{3,}[A-Z]/i.test(s) && s.length > 6) return null
  return s.replace(/\s+/g, '')
}

const files = readdirSync(SRC_DIR).filter((n) => !n.startsWith('~$'))
const compFile = files.find((n) => /COMPARTIMENTOS/i.test(n))
const ssbFile = files.find((n) => /NME|SSB completa/i.test(n))
if (!compFile) throw new Error('No se encontró LISTA DE COMPARTIMENTOS')
if (!ssbFile) throw new Error('No se encontró Relación de SSB…NME')

/** @type {Record<string, string>} */
const byLocal = {}
/** @type {Record<string, string>} */
const byEquipmentId = {}
/** @type {Record<string, string>} */
const byNme = {}

// —— Compartimentos: LOCAL (A) → BLOQUES VALIDOS (AL / cabecera)
{
  const wb = XLSX.readFile(join(SRC_DIR, compFile))
  const sh = wb.Sheets[wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null })
  const hdr = data[0] || []
  let colLocal = findCol(hdr, 'LOCAL')
  let colBlock = findCol(hdr, 'BLOQUES VALIDOS', 'BLOQUE')
  if (colLocal < 0) colLocal = 0
  if (colBlock < 0) colBlock = 37 // AL
  let n = 0
  for (let i = 1; i < data.length; i++) {
    const row = data[i] || []
    const key = localKeyFromCell(row[colLocal])
    const block = cleanBlock(row[colBlock])
    if (!key || !block) continue
    if (!byLocal[key]) {
      byLocal[key] = block
      n++
    }
  }
  console.log('compartimentos', { file: compFile, mapped: n, colLocal, colBlock })
}

// —— SSB/NME: GEN BLOQUE por hoja (columna I en la mayoría; H en 690V/TOTAL)
{
  const wb = XLSX.readFile(join(SRC_DIR, ssbFile))
  let nEq = 0
  let nNme = 0
  let nLoc = 0
  for (const sn of wb.SheetNames) {
    if (/^TOTAL$/i.test(sn)) continue
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sn], {
      header: 1,
      defval: null,
    })
    const hdr = data[0] || []
    const colElem = findCol(hdr, 'ELEMENTO')
    const colDcp = findCol(hdr, 'DCP10', 'DCP-10')
    const colNme = findCol(hdr, 'NME-674', 'NME')
    const colBlock = findCol(hdr, 'GEN BLOQUE', 'BLOQUE')
      const colLocalElectrico = findCol(
        hdr,
        'LOCAL ELECTRICO',
        'GEN LOCALNUM',
      )
      const colLocal =
        colLocalElectrico >= 0 ? colLocalElectrico : findCol(hdr, 'LOCAL')
      if (colBlock < 0) {
        console.warn('sin GEN BLOQUE en', sn)
        continue
      }
      for (let i = 1; i < data.length; i++) {
        const row = data[i] || []
        const block = cleanBlock(row[colBlock])
        if (!block) continue
        const elem = cellStr(colElem >= 0 ? row[colElem] : null)
        const dcp = cellStr(colDcp >= 0 ? row[colDcp] : null)
        const nme = cellStr(colNme >= 0 ? row[colNme] : null)
        const loc = localKeyFromCell(colLocal >= 0 ? row[colLocal] : null)
      const eqId = (dcp || elem || '').toUpperCase()
      if (eqId && /^SSB-/i.test(eqId) && !byEquipmentId[eqId]) {
        byEquipmentId[eqId] = block
        nEq++
      }
      if (nme && !byNme[nme]) {
        byNme[nme] = block
        nNme++
      }
      if (loc && !byLocal[loc]) {
        byLocal[loc] = block
        nLoc++
      }
    }
  }
  console.log('ssb-nme', { file: ssbFile, nEq, nNme, nLocExtra: nLoc })
}

const payload = {
  version: 1,
  sourceFiles: [compFile, ssbFile],
  generatedAt: new Date().toISOString(),
  byEquipmentId: Object.fromEntries(
    Object.entries(byEquipmentId).sort((a, b) => a[0].localeCompare(b[0], 'es')),
  ),
  byNme: Object.fromEntries(
    Object.entries(byNme).sort((a, b) => a[0].localeCompare(b[0], 'es')),
  ),
  byLocal: Object.fromEntries(
    Object.entries(byLocal).sort((a, b) => a[0].localeCompare(b[0], 'es')),
  ),
}

writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8')
console.log({
  out: OUT,
  byEquipmentId: Object.keys(payload.byEquipmentId).length,
  byNme: Object.keys(payload.byNme).length,
  byLocal: Object.keys(payload.byLocal).length,
})
