/**
 * Añade salidas JBX→carga cuyo Circuit en Excel es JBX-xxxx-nn
 * (p. ej. JBX-4SFS0001-01 → RLP-VLSY0001), sin regenerar todas las cadenas.
 *
 * Uso:
 *   node scripts/patch-jbx-self-circuits.mjs [ruta/xl] [abtDownstream.json] [topologyRevC.json]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const XL_BASE = path.resolve(
  process.argv[2] ??
    path.join(ROOT, '../scada-distribucion-electrica-local/.tmp/xlsm_revc/xl'),
)
const OUT_D = path.resolve(
  process.argv[3] ?? path.join(ROOT, 'src/data/abtDownstream.json'),
)
const OUT_C = path.resolve(
  process.argv[4] ?? path.join(ROOT, 'src/data/topologyRevC.json'),
)
const NOTE = 'jbx-chain'

if (!fs.existsSync(path.join(XL_BASE, 'sharedStrings.xml'))) {
  console.error('Excel no encontrado:', XL_BASE)
  process.exit(1)
}

const ssXml = fs.readFileSync(path.join(XL_BASE, 'sharedStrings.xml'), 'utf8')
const strings = []
for (const m of ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
  strings.push(
    [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((x) => x[1]).join(''),
  )
}

function parseSheet(rel) {
  const xml = fs.readFileSync(path.join(XL_BASE, rel), 'utf8')
  const rows = new Map()
  for (const cm of xml.matchAll(
    /<c r="([A-Z]+)(\d+)"([^>]*)>(?:[\s\S]*?<v>([^<]*)<\/v>)?/g,
  )) {
    const col = cm[1]
    const row = +cm[2]
    const attrs = cm[3]
    const v = cm[4]
    if (v == null) continue
    let val = v
    if (/t="s"/.test(attrs)) val = strings[+v] ?? v
    else if (/^-?\d/.test(v)) val = Number(v)
    if (!rows.has(row)) rows.set(row, {})
    rows.get(row)[col] = val
  }
  return rows
}

function str(v) {
  if (v == null || v === '') return null
  const s = String(v).trim()
  if (!s || s === 'NaN' || s === '#N/A' || s === '-' || s === '#¡VALOR!')
    return null
  return s
}

function num(v) {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function resolveTag(raw, desc) {
  if (typeof raw === 'number' && Number.isFinite(raw) && strings[raw]) {
    const resolved = String(strings[raw]).trim()
    if (/^(JBX|SKT|[A-Z]{2,4}-)/i.test(resolved)) return resolved.toUpperCase()
  }
  const t = str(raw)
  if (t && /^(JBX|SKT|[A-Z]{2,4}-)/i.test(t) && !/^\d+$/.test(t)) {
    return t.toUpperCase()
  }
  const blob = `${t || ''} ${desc || ''}`
  const m = blob.match(/\b([A-Z]{2,4}-[A-Z]{2,6}\d{3,4})\b/i)
  return m ? m[1].toUpperCase() : null
}

function slugId(...parts) {
  return parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function patchFile(filePath, rows) {
  const file = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  const eqById = new Map(file.equipment.map((e) => [e.id, e]))
  let addedEq = 0
  let addedCirc = 0
  let skipped = 0

  for (const row of rows) {
    if (!eqById.has(row.jbxId)) {
      console.warn('Sin JBX padre en', path.basename(filePath), row.jbxId)
      skipped++
      continue
    }
    if (!row.tag) {
      skipped++
      continue
    }
    const parent = eqById.get(row.jbxId)
    const voltage = String(parent.voltage || '115').replace(/\s*V$/i, '')

    if (!eqById.has(row.tag)) {
      const eq = {
        id: row.tag,
        name: row.desc || row.tag,
        kind: 'consumidor',
        voltage,
        spare: false,
        virtual: false,
      }
      file.equipment.push(eq)
      eqById.set(row.tag, eq)
      addedEq++
    }

    const circ = {
      id: slugId('jbx', row.jbxId.replace(/^JBX-/i, ''), row.suffix),
      excelRow: row.rn,
      circuitRef: row.circuit,
      name: `${row.jbxId} → ${row.tag}`,
      originId: row.jbxId,
      destinationId: row.tag,
      lineType: 'normal',
      service: row.service || 'NV',
      protectionName: row.suffix,
      protectionModel: null,
      protectionCurrentA: null,
      pnKW: row.pnKW,
      voltage,
      parallelCables: row.parallel,
      cableSection: row.section,
      cableType: row.cableType,
      spare: false,
      virtual: false,
      notes: NOTE,
    }

    const idx = file.circuits.findIndex(
      (c) =>
        c.id === circ.id ||
        c.circuitRef === circ.circuitRef ||
        (c.originId === circ.originId &&
          c.destinationId === circ.destinationId &&
          String(c.notes || '').startsWith('jbx-chain')),
    )
    if (idx >= 0) {
      file.circuits[idx] = { ...file.circuits[idx], ...circ }
    } else {
      file.circuits.push(circ)
      addedCirc++
    }
  }

  const pretty = filePath.endsWith('abtDownstream.json')
  fs.writeFileSync(
    filePath,
    pretty ? `${JSON.stringify(file, null, 4)}\n` : `${JSON.stringify(file)}\n`,
  )
  return { addedEq, addedCirc, skipped, filePath }
}

const jbxSheet = parseSheet('worksheets/sheet8.xml')
const selfRows = []
for (const [rn, row] of [...jbxSheet.entries()].sort((a, b) => a[0] - b[0])) {
  const circuit = str(row.L)
  if (!circuit) continue
  const one = circuit.replace(/\s+/g, ' ').trim().split(/\s+/)[0].toUpperCase()
  const m = one.match(/^(JBX-[A-Z0-9]+)-(\d+)$/i)
  if (!m) continue
  const desc = str(row.D)
  const tag =
    resolveTag(row.C, desc) ||
    resolveTag(row.B, desc) ||
    resolveTag(row.A, desc)
  selfRows.push({
    rn,
    tag: tag ? tag.toUpperCase() : null,
    desc,
    service: str(row.E) || 'NV',
    pnKW: num(row.G),
    circuit: one,
    jbxId: m[1].toUpperCase(),
    suffix: m[2],
    cableType: str(row.M),
    parallel: num(row.N) || 1,
    section: row.O != null ? String(row.O).split(/\s+/)[0] : null,
  })
}

console.log('JBX self-circuit rows from Excel:', selfRows.length, selfRows)

const rD = patchFile(OUT_D, selfRows)
const rC = patchFile(OUT_C, selfRows)
console.log('abtDownstream', rD)
console.log('topologyRevC', rC)
