/**
 * Desarrolla cadenas JBX + SKT (+ equipos dedicados) aguas abajo de todos los SSB
 * desde Excel «Junction Boxes» + «Sockets», mismo patrón que SSB-2PWS1160.
 *
 * Uso: node scripts/import-jbx-all-chains.mjs
 *
 * Requiere Excel descomprimido en .tmp/xlsm_unpack/unpacked/xl
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'src/data/abtDownstream.json')
/** Permite Excel Rev.C/D descomprimido: node … [ruta/a/xl] */
const XL_BASE = path.resolve(
  process.argv[2] ?? path.join(ROOT, '.tmp/xlsm_unpack/unpacked/xl'),
)
const NOTE = 'jbx-chain'
const LEGACY_NOTES = new Set(['jbx-chain', 'jbx-chain-1160', 'jbx-chain-1160-q06'])

if (!fs.existsSync(path.join(XL_BASE, 'sharedStrings.xml'))) {
  console.error('No se encuentra Excel descomprimido en', XL_BASE)
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
  // Índice sharedString guardado como número (sin t="s" en la celda)
  if (typeof raw === 'number' && Number.isFinite(raw) && strings[raw]) {
    const resolved = String(strings[raw]).trim()
    if (/^(JBX|SKT|[A-Z]{2,4}-)/i.test(resolved)) return resolved.toUpperCase()
    const mNum = resolved.match(/\b([A-Z]{2,4}-[A-Z]{2,6}\d{3,4})\b/i)
    if (mNum) return mNum[1].toUpperCase()
  }
  const t = str(raw)
  if (t && /^(JBX|SKT|[A-Z]{2,4}-[A-Z0-9]+)/i.test(t) && !/^\d+$/.test(t)) {
    return t.toUpperCase()
  }
  if (t && /^\d+$/.test(t) && strings[+t]) {
    const resolved = strings[+t]
    const m = resolved.match(/\b([A-Z]{2,4}-[A-Z]{2,6}\d{3,4})\b/i)
    if (m) return m[1].toUpperCase()
    if (/^JBX-|^SKT-/i.test(resolved)) return resolved.toUpperCase()
    if (/^[A-Z]{2,4}-/i.test(resolved)) return resolved.toUpperCase()
  }
  const blob = `${t || ''} ${desc || ''}`
  const m = blob.match(/\b([A-Z]{2,4}-[A-Z]{2,6}\d{3,4})\b/i)
  return m ? m[1].toUpperCase() : null
}

function tagFromRow(row, desc) {
  return (
    resolveTag(row.C, desc) ||
    resolveTag(row.B, desc) ||
    resolveTag(row.A, desc)
  )
}

function isJbxTag(tag, desc) {
  if (tag && /^JBX-/i.test(tag)) return true
  return /CAJA DE CONEX/i.test(desc || '')
}

function isSktTag(tag) {
  return !!(tag && /^SKT-/i.test(tag))
}

/**
 * Padre topológico por sufijo de circuito (patrón Q06):
 *  - 10 / 20 / 30 → interconexión JBX
 *  - 11–19 / 01–09 → hijos del root (salvo carga no-SKT 11–19 con JBX-10)
 *  - 21–29 → hijos del JBX-10; 31–39 → del JBX-20
 */
function parentCircuitRef(feederRef, suffix, opts) {
  const n = parseInt(suffix, 10)
  if (Number.isNaN(n)) return feederRef
  const tens = Math.floor(n / 10)
  const ones = n % 10
  if (ones === 0) {
    return tens <= 1 ? feederRef : `${feederRef}-${(tens - 1) * 10}`
  }
  if (tens === 1 && opts?.nonSktUnder10 && opts.jbxHas10) {
    return `${feederRef}-10`
  }
  if (tens <= 1) return feederRef
  return `${feederRef}-${(tens - 1) * 10}`
}

function slugId(...parts) {
  return parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Normaliza typos Excel: SSB-…-Q3410 → SSB-…-Q34-10 */
function normalizeCircuitRef(circuit) {
  const one = circuit.replace(/\s+/g, ' ').trim().split(/\s+/)[0].toUpperCase()
  return one.replace(/^(SSB-[A-Z0-9]+-Q)(\d{2})(\d{2})$/i, '$1$2-$3')
}

function defaultName(tag, desc, sktMeta) {
  if (desc) return desc
  if (sktMeta?.desc) return sktMeta.desc
  if (isJbxTag(tag, desc)) return 'CAJA DE CONEXIÓN'
  if (isSktTag(tag)) return 'ENCHUFE'
  return tag
}

const file = JSON.parse(fs.readFileSync(OUT, 'utf8'))

function ensureEq(id, patch) {
  let eq = file.equipment.find((e) => e.id === id)
  if (!eq) {
    eq = { id, ...patch }
    file.equipment.push(eq)
  } else {
    Object.assign(eq, patch)
  }
  return eq
}

function upsertCircuit(c) {
  const i = file.circuits.findIndex(
    (x) =>
      x.id === c.id ||
      (c.circuitRef && x.circuitRef === c.circuitRef) ||
      (x.originId === c.originId &&
        x.destinationId === c.destinationId &&
        LEGACY_NOTES.has(x.notes)),
  )
  if (i >= 0) file.circuits[i] = { ...file.circuits[i], ...c }
  else file.circuits.push(c)
}

const before = file.circuits.length
file.circuits = file.circuits.filter((c) => !LEGACY_NOTES.has(c.notes))
console.log('Removed previous jbx-chain circuits:', before - file.circuits.length)

/** circuitRef → feed circuit (SSB-*-Qnn → root; JBX/SKT/TBX/…) */
const feedByRef = new Map()
for (const c of file.circuits) {
  if (
    c.circuitRef &&
    /^SSB-[A-Z0-9]+-Q\d+$/i.test(c.circuitRef) &&
    /^SSB-/i.test(c.originId) &&
    !/^SPARE-/i.test(c.destinationId) &&
    !c.spare
  ) {
    feedByRef.set(c.circuitRef.toUpperCase(), c)
  }
}

const jbxSheet = parseSheet('worksheets/sheet8.xml')
const sktSheet = parseSheet('worksheets/sheet9.xml')

/** @type {Map<string, object>} */
const socketsByTag = new Map()
for (const [rn, row] of sktSheet) {
  const tag = str(row.B)
  if (!tag || !/^SKT-/i.test(tag)) continue
  const key = tag.toUpperCase()
  socketsByTag.set(key, {
    tag: key,
    rn,
    desc: str(row.C),
    local: str(row.D),
    dedicated: str(row.K) === '✓' || str(row.K) === '√',
    eq1: str(row.M)?.toUpperCase() ?? null,
    eq1desc: str(row.N),
    eq2: str(row.O)?.toUpperCase() ?? null,
    eq2desc: str(row.P),
  })
}

const jbxRows = []
/** Filas cuyo Circuit cuelga de la propia JBX (p. ej. JBX-4SFS0001-01). */
const jbxSelfRows = []
for (const [rn, row] of [...jbxSheet.entries()].sort((a, b) => a[0] - b[0])) {
  const circuit = str(row.L)
  if (!circuit) continue
  const desc = str(row.D)
  const tag = tagFromRow(row, desc)
  const circuitOne = normalizeCircuitRef(circuit)

  const selfM = circuitOne.match(/^(JBX-[A-Z0-9]+)-(\d+)$/i)
  if (selfM) {
    jbxSelfRows.push({
      rn,
      tag: tag ? tag.toUpperCase() : null,
      desc,
      service: str(row.E) || 'NV',
      pnKW: num(row.G),
      circuit: circuitOne.toUpperCase(),
      jbxId: selfM[1].toUpperCase(),
      suffix: selfM[2],
      cableType: str(row.M),
      parallel: num(row.N) || 1,
      section: row.O != null ? String(row.O).split(/\s+/)[0] : null,
    })
    continue
  }

  if (!/^SSB-/i.test(circuitOne)) continue
  if (!/^SSB-[A-Z0-9]+-Q\d+/i.test(circuitOne)) continue
  jbxRows.push({
    rn,
    tag: tag ? tag.toUpperCase() : null,
    desc,
    service: str(row.E) || 'NV',
    pnKW: num(row.G),
    circuit: circuitOne,
    cableType: str(row.M),
    parallel: num(row.N) || 1,
    section: row.O != null ? String(row.O).split(/\s+/)[0] : null,
  })
}

/** Agrupar por alimentación Qxx */
const byFeeder = new Map()
for (const row of jbxRows) {
  const m = row.circuit.match(/^(SSB-[A-Z0-9]+-Q\d+)/i)
  if (!m) continue
  const feeder = m[1].toUpperCase()
  if (!byFeeder.has(feeder)) byFeeder.set(feeder, [])
  byFeeder.get(feeder).push(row)
}

let added = 0
let eqDedicated = 0
let feedersOk = 0
let feedersMissing = 0
const missingFeeds = []
const touchedSkts = new Set()

function linkDedicated(sktTag, voltage, service, parentCircuitRefForId) {
  const sktMeta = socketsByTag.get(sktTag)
  if (!sktMeta?.dedicated) return
  for (const [eqId, eqDesc] of [
    [sktMeta.eq1, sktMeta.eq1desc],
    [sktMeta.eq2, sktMeta.eq2desc],
  ]) {
    if (!eqId) continue
    ensureEq(eqId, {
      name: eqDesc || eqId,
      kind: 'consumidor',
      voltage,
      spare: false,
      virtual: false,
    })
    upsertCircuit({
      id: slugId('jbx-ded', sktTag, eqId),
      excelRow: sktMeta.rn ?? null,
      circuitRef: `${parentCircuitRefForId}-${eqId}`,
      name: `${sktTag} → ${eqId}`,
      originId: sktTag,
      destinationId: eqId,
      lineType: 'normal',
      service: service || 'NV',
      protectionName: eqId,
      protectionModel: null,
      protectionCurrentA: null,
      pnKW: null,
      voltage,
      parallelCables: 1,
      cableSection: null,
      spare: false,
      virtual: false,
      notes: NOTE,
    })
    added++
    eqDedicated++
  }
}

for (const [feederRef, rows] of byFeeder) {
  const feed = feedByRef.get(feederRef)
  if (!feed) {
    feedersMissing++
    if (missingFeeds.length < 40) missingFeeds.push(feederRef)
    continue
  }
  feedersOk++

  // Sufijos numéricos: procesar 10 antes que 11/21 (Excel a veces desordena)
  rows.sort((a, b) => {
    const sa = a.circuit.slice(feederRef.length + 1) || '0'
    const sb = b.circuit.slice(feederRef.length + 1) || '0'
    const na = parseInt(sa, 10)
    const nb = parseInt(sb, 10)
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
    return sa.localeCompare(sb)
  })

  const voltage = String(feed.voltage || '230').replace(/\s*V$/i, '')
  const rootId = feed.destinationId
  const rootRow = rows.find((r) => r.circuit === feederRef) || rows[0]
  ensureEq(rootId, {
    name: rootRow?.desc || defaultName(rootId, null, socketsByTag.get(rootId)),
    kind: 'consumidor',
    voltage,
    spare: false,
    virtual: false,
    local: socketsByTag.get(rootId)?.local || undefined,
  })

  if (feed.cableType == null && rootRow?.cableType) {
    feed.cableType = rootRow.cableType
  }
  if (!feed.cableSection && rootRow?.section) {
    feed.cableSection = rootRow.section
  }

  const jbxByRef = new Map([[feederRef, rootId]])
  const jbxHas10 = rows.some(
    (r) => r.circuit === `${feederRef}-10` && isJbxTag(r.tag, r.desc),
  )

  if (isSktTag(rootId)) touchedSkts.add(rootId)

  for (const row of rows) {
    if (row.circuit === feederRef) continue
    const suf = row.circuit.slice(feederRef.length + 1)
    if (!suf) continue

    let tag = row.tag
    if (!tag && isJbxTag(null, row.desc)) {
      console.warn('JBX without tag', row.rn, row.circuit)
      continue
    }
    if (!tag) {
      console.warn('Row without tag', row.rn, row.circuit, row.desc)
      continue
    }

    const nonSktUnder10 = !isSktTag(tag) && !isJbxTag(tag, row.desc)
    const parentRef = parentCircuitRef(feederRef, suf, {
      jbxHas10,
      nonSktUnder10,
    })
    const originId = jbxByRef.get(parentRef)
    if (!originId) {
      console.warn('Missing parent', parentRef, 'for', row.circuit)
      continue
    }

    const sktMeta = socketsByTag.get(tag)
    const name = defaultName(tag, row.desc, sktMeta)

    ensureEq(tag, {
      name,
      kind: 'consumidor',
      voltage,
      local: sktMeta?.local || undefined,
      spare: false,
      virtual: false,
      description: sktMeta?.dedicated
        ? `Dedicado${sktMeta.eq1 ? `: ${sktMeta.eq1}` : ''}`
        : undefined,
    })

    if (isJbxTag(tag, row.desc)) {
      jbxByRef.set(row.circuit, tag)
    }
    if (isSktTag(tag)) touchedSkts.add(tag)

    const ssbShort = feederRef.replace(/^SSB-/i, '')
    upsertCircuit({
      id: slugId('jbx', ssbShort, suf),
      excelRow: row.rn,
      circuitRef: row.circuit,
      name: `${originId} → ${tag}`,
      originId,
      destinationId: tag,
      lineType: 'normal',
      service: row.service || feed.service || 'NV',
      protectionName: `${feederRef.replace(/^SSB-[A-Z0-9]+-/i, '')}-${suf}`,
      protectionModel: null,
      protectionCurrentA: null,
      pnKW: row.pnKW,
      pKWe: row.pnKW,
      qKVAr: row.pnKW != null ? row.pnKW * 0.75 : null,
      sKVA: row.pnKW != null ? row.pnKW * 1.25 : null,
      ibA: row.pnKW != null ? (row.pnKW * 1000) / (Number(voltage) * 0.8 || 184) : null,
      voltage,
      parallelCables: row.parallel,
      cableSection: row.section,
      cableType: row.cableType,
      spare: false,
      virtual: false,
      notes: NOTE,
    })
    added++

    if (isSktTag(tag)) {
      linkDedicated(tag, voltage, row.service || feed.service, row.circuit)
    }
  }

  // Dedicados del SKT raíz (salida plana SSB→SKT)
  if (isSktTag(rootId)) {
    linkDedicated(rootId, voltage, feed.service, feederRef)
  }
}

/** Hijos con Circuit = JBX-xxxx-nn (p. ej. 400 Hz JBX-4SFS0001-01 → RLP-…). */
let jbxSelfAdded = 0
let jbxSelfMissingParent = 0
const eqById = new Map(file.equipment.map((e) => [e.id, e]))
for (const row of jbxSelfRows) {
  const originId = row.jbxId
  if (!eqById.has(originId) && !file.equipment.some((e) => e.id === originId)) {
    jbxSelfMissingParent++
    console.warn('JBX self-child sin padre en topología', row.circuit, row.tag)
    continue
  }
  let tag = row.tag
  if (!tag) {
    console.warn('JBX self-child without tag', row.rn, row.circuit, row.desc)
    continue
  }
  const parentEq = eqById.get(originId) || file.equipment.find((e) => e.id === originId)
  const voltage = String(parentEq?.voltage || '115').replace(/\s*V$/i, '')
  const sktMeta = socketsByTag.get(tag)
  const name = defaultName(tag, row.desc, sktMeta)
  ensureEq(tag, {
    name,
    kind: 'consumidor',
    voltage,
    local: sktMeta?.local || undefined,
    spare: false,
    virtual: false,
  })
  eqById.set(tag, file.equipment.find((e) => e.id === tag))
  if (isSktTag(tag)) touchedSkts.add(tag)

  upsertCircuit({
    id: slugId('jbx', originId.replace(/^JBX-/i, ''), row.suffix),
    excelRow: row.rn,
    circuitRef: row.circuit,
    name: `${originId} → ${tag}`,
    originId,
    destinationId: tag,
    lineType: 'normal',
    service: row.service || 'NV',
    protectionName: row.suffix,
    protectionModel: null,
    protectionCurrentA: null,
    pnKW: row.pnKW,
    pKWe: row.pnKW,
    qKVAr: row.pnKW != null ? row.pnKW * 0.75 : null,
    sKVA: row.pnKW != null ? row.pnKW * 1.25 : null,
    ibA:
      row.pnKW != null
        ? (row.pnKW * 1000) / (Number(voltage) * 0.8 || 184)
        : null,
    voltage,
    parallelCables: row.parallel,
    cableSection: row.section,
    cableType: row.cableType,
    spare: false,
    virtual: false,
    notes: NOTE,
  })
  added++
  jbxSelfAdded++
  if (isSktTag(tag)) {
    linkDedicated(tag, voltage, row.service, row.circuit)
  }
}

/** SKT ya alimentados desde SSB/JBX en topología pero sin fila nested: dedicados */
for (const c of file.circuits) {
  if (!isSktTag(c.destinationId)) continue
  if (touchedSkts.has(c.destinationId)) continue
  const meta = socketsByTag.get(c.destinationId)
  if (!meta?.dedicated) continue
  const v = String(c.voltage || '230').replace(/\s*V$/i, '')
  touchedSkts.add(c.destinationId)
  linkDedicated(
    c.destinationId,
    v,
    c.service || 'NV',
    c.circuitRef || c.destinationId,
  )
}

fs.writeFileSync(OUT, JSON.stringify(file, null, 4) + '\n', 'utf8')

console.log('Excel feeders:', byFeeder.size)
console.log('Matched SSB feeds:', feedersOk)
console.log('Missing SSB feeds:', feedersMissing)
console.log('JBX self-circuit rows:', jbxSelfRows.length)
console.log('JBX self-circuit added:', jbxSelfAdded)
console.log('JBX self-circuit missing parent:', jbxSelfMissingParent)
if (missingFeeds.length) console.log('Missing sample:', missingFeeds)
console.log('Added/updated chain circuits:', added)
console.log('Dedicated SKT→equipment links:', eqDedicated)
console.log(
  'Chain circuits now:',
  file.circuits.filter((c) => c.notes === NOTE).length,
)
console.log(
  'Sample 4SFS0001 kids:',
  file.circuits
    .filter((c) => c.originId === 'JBX-4SFS0001')
    .map((c) => ({ ref: c.circuitRef, dest: c.destinationId })),
)
console.log(
  'Sample 1160 Q01 kids:',
  file.circuits
    .filter((c) => c.originId === 'JBX-2PWS1013')
    .map((c) => c.circuitRef),
)
console.log(
  'Sample 2235 nest count:',
  file.circuits.filter(
    (c) => c.notes === NOTE && /^SSB-2PWS2235/i.test(c.circuitRef || ''),
  ).length,
)
