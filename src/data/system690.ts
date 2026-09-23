import type {
  Circuit,
  DistributionData,
  Equipment,
  EquipmentKind,
  LineType,
  ServiceClass,
} from '../types'
import raw from './system690.json'
import topologyRevC from './topologyRevC.json'
import dcp10Map from './dcp10Map.json'
import nme674Map from './nme674Map.json'
import { augmentSpareCircuits } from '../utils/spareCircuits'
import { mergeAbtDownstream } from '../abtDownstream/merge'

interface RawEquipment {
  id: string
  name: string
  local?: string | null
  localName?: string | null
  kind: EquipmentKind
  virtual?: boolean
}

interface RawCircuit {
  id: string
  excelRow?: number | null
  circuitRef?: string | null
  name: string
  originId: string
  destinationId: string
  lineType: LineType
  service?: ServiceClass | null
  protectionName: string
  protectionModel?: string | null
  protectionCurrentA?: number | null
  pKWe?: number | null
  qKVAr?: number | null
  sKVA?: number | null
  ibA?: number | null
  voltage?: number | null
  pnKW?: number | null
  parallelCables?: number
  cableSection?: string | null
  cableType?: string | null
  cableLengthM?: number | null
  cableWeightKg?: number | null
  virtual?: boolean
}

interface RawSystem {
  title: string
  vessel: string
  sourceFile?: string
  equipment: RawEquipment[]
  circuits: RawCircuit[]
}

const system = raw as RawSystem
const dcp10ByPuma = dcp10Map as Record<string, string>
const nme674ByPuma = nme674Map as Record<string, string>

/** Nombre de archivo Excel sin sufijo «_trabajo» ni extensión. */
export function displaySourceFileName(fileName: string): string {
  return fileName
    .replace(/_trabajo(?=\.[^.]+$)/i, '')
    .replace(/_trabajo$/i, '')
    .replace(/\.[^.]+$/, '')
}

const base: DistributionData = {
  title: system.title,
  vessel: system.vessel,
  sourceFile: system.sourceFile,
  equipment: system.equipment.map(
    (eq): Equipment => ({
      id: eq.id,
      name: eq.name,
      kind: eq.kind,
      local: eq.local || undefined,
      localName: eq.localName || undefined,
      voltage: '690 V',
      virtual: eq.virtual,
      dcp10Id: dcp10ByPuma[eq.id] ?? eq.id,
      nme674Id: nme674ByPuma[eq.id],
    }),
  ),
  circuits: system.circuits.map(
    (c): Circuit => ({
      id: c.id,
      name: c.name,
      originId: c.originId,
      destinationId: c.destinationId,
      circuitRef: c.circuitRef || undefined,
      lineType: c.lineType,
      service: c.service ?? null,
      protectionName: c.protectionName,
      protectionModel: c.protectionModel || undefined,
      protectionCurrentA: c.protectionCurrentA ?? null,
      pKWe: c.pKWe ?? null,
      qKVAr: c.qKVAr ?? null,
      sKVA: c.sKVA ?? null,
      ibA: c.ibA ?? null,
      pnKW: c.pnKW ?? null,
      voltage: c.voltage != null ? `${c.voltage} V` : '690 V',
      parallelCables: c.parallelCables,
      cableSection: c.cableSection || undefined,
      cableType: c.cableType || undefined,
      cableLengthM: c.cableLengthM ?? null,
      cableWeightKg: c.cableWeightKg ?? null,
      virtual: c.virtual,
      excelRow: c.excelRow ?? null,
    }),
  ),
}

/** Topología embebida Rev.D (lista actual; se actualiza en releases). */
export const embeddedRevD: DistributionData = augmentSpareCircuits(
  mergeAbtDownstream(base),
)

/**
 * Alias histórico: el parser de Excel y spares MSB usan Rev.D como plantilla
 * de paneles virtuales.
 */
export const embeddedSystem690: DistributionData = embeddedRevD

/**
 * Rev.C (Excel) trae `local` pero a menudo sin `localName` / `nme674Id`.
 * Completa denominaciones con los mapas y, si falta el nombre de local,
 * el de Rev.D (mismo tag PUMA).
 */
function enrichRevCTopology(
  data: DistributionData,
  localNameSource: DistributionData,
): DistributionData {
  const localNameById = new Map<string, string>()
  for (const e of localNameSource.equipment) {
    const ln = e.localName?.trim()
    if (ln) localNameById.set(e.id, ln)
  }
  return {
    ...data,
    equipment: data.equipment.map((eq) => {
      const nme = eq.nme674Id || nme674ByPuma[eq.id]
      const localName =
        eq.localName?.trim() || localNameById.get(eq.id) || undefined
      const dcp10Id = eq.spare
        ? eq.dcp10Id
        : eq.dcp10Id || dcp10ByPuma[eq.id] || eq.id
      return {
        ...eq,
        ...(nme ? { nme674Id: nme } : {}),
        ...(localName ? { localName } : {}),
        ...(dcp10Id ? { dcp10Id } : {}),
      }
    }),
  }
}

/** Topología embebida Rev.C (consulta; congelada en build). */
export const embeddedRevC: DistributionData = enrichRevCTopology(
  topologyRevC as DistributionData,
  embeddedRevD,
)

export type CircuitListRevision = 'C' | 'D'

/**
 * Topología activa del unifilar.
 * Por defecto Rev.C; conmuta a Rev.D (o Excel de sesión sobre D).
 */
export let system690: DistributionData = embeddedRevC

export function setSessionSystem690(data: DistributionData): void {
  system690 = data
}

export function restoreEmbeddedSystem690(
  revision: CircuitListRevision = 'C',
): void {
  system690 = revision === 'D' ? embeddedRevD : embeddedRevC
}

/** Denominación DCP-10 (Excel F/J) a partir del tag PUMA (E/I) */
export function dcp10Of(pumaId: string): string | undefined {
  const eq = system690.equipment.find((e) => e.id === pumaId)
  return eq?.dcp10Id ?? dcp10ByPuma[pumaId]
}
