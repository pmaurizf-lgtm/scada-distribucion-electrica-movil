/**
 * Bloque constructivo asociado a un local / SSB.
 * Datos: src/data/localBlocks.json (scripts/import-local-blocks.mjs).
 */
import localBlocksJson from '../data/localBlocks.json'
import { localLookupKeys, normalizeLocalCode } from '../deckPlans/normalize'

type LocalBlocksFile = {
  byEquipmentId?: Record<string, string>
  byNme?: Record<string, string>
  byLocal?: Record<string, string>
}

const data = localBlocksJson as LocalBlocksFile
const byEquipmentId = data.byEquipmentId ?? {}
const byNme = data.byNme ?? {}
const byLocal = data.byLocal ?? {}

function blockForLocalRaw(rawLocal: string | null | undefined): string | undefined {
  if (!rawLocal?.trim()) return undefined
  for (const key of localLookupKeys(rawLocal)) {
    const hit = byLocal[key]
    if (hit) return hit
  }
  const norm = normalizeLocalCode(rawLocal)
  if (norm && byLocal[norm]) return byLocal[norm]
  return undefined
}

/**
 * Resuelve el bloque para una fila SSB/TRF del informe.
 * Prioridad: id equipo (SSB) → NME → código de local (compartimentos).
 */
export function resolveEquipmentBlock(opts: {
  equipmentId?: string | null
  nme674Id?: string | null
  local?: string | null
}): string {
  const id = opts.equipmentId?.trim().toUpperCase()
  if (id && byEquipmentId[id]) return byEquipmentId[id]!

  const nme = opts.nme674Id?.trim()
  if (nme && nme !== '—' && byNme[nme]) return byNme[nme]!

  const fromLocal = blockForLocalRaw(opts.local)
  if (fromLocal) return fromLocal

  return '—'
}
