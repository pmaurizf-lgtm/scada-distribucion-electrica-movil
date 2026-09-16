import { system690 } from '../data/system690'
import {
  isNoteDeleted,
  type InspectionNote,
} from '../notes/types'
import type { DistributionData } from '../types'
import {
  buildOrderedFeedChain,
  feedLineLabel,
  formatChainArrow,
  type FeedChainHop,
  type FeedLineKind,
} from './feedChain'
import type { StartupGroup, StartupReport } from './types'

/** Fila de la tabla resumen (un escalón de la cadena por fila). */
export interface StartupTableRow {
  /** Primera fila del bloque destino (incluye resumen de cadena). */
  isDestStart: boolean
  /** Primera fila de la línea Normal/Alternativa dentro del destino. */
  isLineStart: boolean
  destEquip: string
  destLocal: string
  destName: string
  lineKind: FeedLineKind
  lineLabel: string
  step: number
  hopEquip: string
  hopLocal: string
  hopName: string
  hopProt: string
  /** Solo en isDestStart + línea normal: cadena completa con flechas. */
  chainSummary: string
  hops: FeedChainHop[]
}

function dash(v?: string | null): string {
  const s = (v ?? '').trim()
  return s || '—'
}

function pushChainRows(
  rows: StartupTableRow[],
  dest: {
    equipmentId: string
    equipmentName: string
    local?: string
  },
  lineKind: FeedLineKind,
  hops: FeedChainHop[],
  isFirstLineOfDest: boolean,
): void {
  if (!hops.length) return
  const lineLabel = feedLineLabel(lineKind)
  const summary = formatChainArrow(hops)

  hops.forEach((h, i) => {
    const isDestStart = isFirstLineOfDest && i === 0
    rows.push({
      isDestStart,
      isLineStart: i === 0,
      destEquip: dest.equipmentId,
      destLocal: dash(dest.local),
      destName: dest.equipmentName,
      lineKind,
      lineLabel,
      step: h.step,
      hopEquip: h.equipmentId,
      hopLocal: dash(h.local),
      hopName: h.equipmentName,
      hopProt: dash(h.protectionName),
      chainSummary: isDestStart ? summary : '',
      hops,
    })
  })
}

/**
 * Tabla por destino: cadena Normal (+ Alternativa / AUX 24 V si existen),
 * un escalón por fila (fuente → destino).
 */
export function buildStartupTableRows(
  report: StartupReport,
  data: DistributionData = system690,
): StartupTableRow[] {
  const rows: StartupTableRow[] = []

  const dests = report.groups.flatMap((g) =>
    g.destinations.length
      ? g.destinations
      : [
          {
            equipmentId: g.originId,
            equipmentName: g.originName,
            local: g.originLocal,
            query: g.originId,
            protectionName: '—',
            circuitId: '',
            lineType: 'normal' as const,
          },
        ],
  )

  dests.sort((a, b) => a.equipmentId.localeCompare(b.equipmentId, 'es'))

  for (const d of dests) {
    const norm = buildOrderedFeedChain(d.equipmentId, data, 'normal')
    const alt = buildOrderedFeedChain(d.equipmentId, data, 'alternativa')
    const aux = buildOrderedFeedChain(d.equipmentId, data, 'aux')

    const destInfo = {
      equipmentId: d.equipmentId,
      equipmentName: d.equipmentName,
      local: d.local,
    }

    if (!norm.length && !alt.length && !aux.length) {
      rows.push({
        isDestStart: true,
        isLineStart: true,
        destEquip: d.equipmentId,
        destLocal: dash(d.local),
        destName: d.equipmentName,
        lineKind: 'normal',
        lineLabel: feedLineLabel('normal'),
        step: 1,
        hopEquip: d.equipmentId,
        hopLocal: dash(d.local),
        hopName: d.equipmentName,
        hopProt: '—',
        chainSummary: d.equipmentId,
        hops: [],
      })
      continue
    }

    pushChainRows(rows, destInfo, 'normal', norm, true)
    pushChainRows(rows, destInfo, 'alternativa', alt, !norm.length)
    pushChainRows(
      rows,
      destInfo,
      'aux',
      aux,
      !norm.length && !alt.length,
    )
  }

  return rows
}

export function summarizeGroups(groups: StartupGroup[]): string {
  const nDest = groups.reduce((a, g) => a + g.destinations.length, 0)
  return `${groups.length} origen${groups.length === 1 ? '' : 'es'} · ${nDest} destino${nDest === 1 ? '' : 's'}`
}

export type StartupBoardKind = 'SSB' | 'TRF'

export type StartupBoardRow = {
  kind: StartupBoardKind
  equipmentId: string
  name: string
  nme674Id: string
  local: string
  localName: string
  /** Notas de inspección asociadas al equipo (y a sus interruptores). */
  notes: string
}

/** @deprecated Usar StartupBoardRow */
export type StartupSsbRow = StartupBoardRow

function isSsbEquipmentId(id: string): boolean {
  return /^SSB-/i.test(id)
}

/** TRF aguas abajo de LCS (no TRF-6PWS de la cadena ABT). */
function isDownstreamLcsTrfId(id: string): boolean {
  return /^TRF-/i.test(id) && !/^TRF-6PWS/i.test(id)
}

/**
 * TRF interno de SSB-4PWS: Q04 → TRF → BUS-SSB-*-115 → Q51/Q52…
 * (no listar; sí listar TRF externos alimentados desde SSB, p. ej. TRF-4PWS2201).
 */
function feedsSsb115InternalBus(
  trfId: string,
  data: DistributionData,
): boolean {
  return data.circuits.some(
    (c) =>
      c.originId === trfId &&
      (/^BUS-SSB-.+-115$/i.test(c.destinationId) ||
        c.notes === 'ssb-115-bus'),
  )
}

/** TRF de informe: externos (LCS→TRF o SSB→TRF→otro), no internos 115 V. */
function isReportTrf(trfId: string, data: DistributionData): boolean {
  if (!isDownstreamLcsTrfId(trfId)) return false
  if (feedsSsb115InternalBus(trfId, data)) return false
  return true
}

function circuitBelongsToBoard(
  circuitId: string,
  boardId: string,
  data: DistributionData,
): boolean {
  const c = data.circuits.find((x) => x.id === circuitId)
  if (!c) return false
  return c.originId === boardId || c.destinationId === boardId
}

function formatNoteBlock(note: InspectionNote, circuitLabel?: string): string {
  const bullets = note.lines
    .map((l) => `${l.resolved ? '☑' : '☐'} ${l.text.trim()}`)
    .filter((l) => l.length > 2)
    .join('\n')
  if (!bullets) return ''
  const who = note.author?.trim() || '—'
  const head = circuitLabel
    ? `${circuitLabel} · ${who}`
    : who
  return `${head}\n${bullets}`
}

/** Texto de notas para la columna Excel de un SSB/TRF. */
export function formatNotesForStartupBoard(
  equipmentId: string,
  notes: InspectionNote[],
  data: DistributionData = system690,
): string {
  const related = notes
    .filter((n) => !isNoteDeleted(n))
    .filter((n) => {
      if (n.target.kind === 'equipment') {
        return n.target.equipmentId === equipmentId
      }
      return circuitBelongsToBoard(n.target.circuitId, equipmentId, data)
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  if (!related.length) return ''

  return related
    .map((note) => {
      if (note.target.kind === 'equipment') {
        return formatNoteBlock(note)
      }
      const circuitId = note.target.circuitId
      const c = data.circuits.find((x) => x.id === circuitId)
      const label =
        c?.protectionName?.trim() ||
        c?.circuitRef?.trim() ||
        circuitId
      return formatNoteBlock(note, label)
    })
    .filter(Boolean)
    .join('\n\n')
}

function boardRowFromEquipment(
  kind: StartupBoardKind,
  id: string,
  eqById: Map<string, { name?: string; nme674Id?: string; local?: string; localName?: string }>,
  notes: InspectionNote[],
  data: DistributionData,
): StartupBoardRow {
  const eq = eqById.get(id)
  return {
    kind,
    equipmentId: id,
    name: eq?.name?.trim() || id,
    nme674Id: eq?.nme674Id?.trim() || '—',
    local: eq?.local?.trim() || '—',
    localName: eq?.localName?.trim() || '—',
    notes: formatNotesForStartupBoard(id, notes, data),
  }
}

/**
 * SSB y TRF únicos en las cadenas Normal / Alternativa / AUX.
 * Incluye TRF externos alimentados desde SSB; excluye TRF internos
 * SSB-4PWS (salida a BUS-115 con Q51/Q52…).
 */
export function collectStartupBoards(
  report: StartupReport,
  data: DistributionData = system690,
  notes: InspectionNote[] = [],
): StartupBoardRow[] {
  const eqById = new Map(data.equipment.map((e) => [e.id, e]))
  const ssbIds = new Set<string>()
  const trfIds = new Set<string>()

  const dests = report.groups.flatMap((g) =>
    g.destinations.length
      ? g.destinations.map((d) => d.equipmentId)
      : [g.originId],
  )

  const consider = (id: string) => {
    if (isSsbEquipmentId(id)) ssbIds.add(id)
    if (isReportTrf(id, data)) trfIds.add(id)
  }

  for (const destId of dests) {
    consider(destId)
    for (const kind of ['normal', 'alternativa', 'aux'] as const) {
      const hops = buildOrderedFeedChain(destId, data, kind)
      for (const h of hops) consider(h.equipmentId)
    }
  }

  const rows: StartupBoardRow[] = [
    ...[...ssbIds]
      .sort((a, b) => a.localeCompare(b, 'es'))
      .map((id) => boardRowFromEquipment('SSB', id, eqById, notes, data)),
    ...[...trfIds]
      .sort((a, b) => a.localeCompare(b, 'es'))
      .map((id) => boardRowFromEquipment('TRF', id, eqById, notes, data)),
  ]
  return rows
}

/** @deprecated Usar collectStartupBoards */
export function collectStartupSsbs(
  report: StartupReport,
  data: DistributionData = system690,
  notes: InspectionNote[] = [],
): StartupBoardRow[] {
  return collectStartupBoards(report, data, notes).filter((r) => r.kind === 'SSB')
}

