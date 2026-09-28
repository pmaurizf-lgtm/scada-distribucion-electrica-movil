import type { DistributionData } from '../types'
import { findEquipmentByQuery } from '../utils/upstream'
import type { EntregaEntry, EntregaImportStats } from './types'

export type ResolvedEntregas = {
  byEquipmentId: Map<
    string,
    { installComplete: boolean; delivered: boolean }
  >
  /** Entradas que cruzan con el unifilar (equipmentRef → PUMA id). */
  matchedEntries: EntregaEntry[]
  stats: EntregaImportStats
}

/**
 * Cruza filas Excel con equipos del unifilar (PUMA / DCP-10 / nombre).
 * Conserva el `equipmentRef` original pero indexa por `equipment.id`.
 */
export function resolveEntregas(
  data: DistributionData,
  entries: EntregaEntry[],
  opts?: { upserted?: number },
): ResolvedEntregas {
  const byEquipmentId = new Map<
    string,
    { installComplete: boolean; delivered: boolean }
  >()
  const matchedEntries: EntregaEntry[] = []
  let incomplete = 0
  let complete = 0
  let delivered = 0

  for (const entry of entries) {
    const found = findEquipmentByQuery(data.equipment, entry.equipmentRef)
    if (!found) continue
    matchedEntries.push(entry)
    /* Última apariencia gana si el mismo PUMA llega por refs distintas. */
    byEquipmentId.set(found.id, {
      installComplete: entry.installComplete,
      delivered: entry.delivered,
    })
  }

  for (const flags of byEquipmentId.values()) {
    if (flags.installComplete) complete += 1
    else incomplete += 1
    if (flags.delivered) delivered += 1
  }

  const stats: EntregaImportStats = {
    rowsRead: entries.length,
    matched: byEquipmentId.size,
    incomplete,
    complete,
    delivered,
    skippedUnknown: Math.max(0, entries.length - matchedEntries.length),
    upserted: opts?.upserted ?? 0,
    totalStored: byEquipmentId.size,
  }

  return { byEquipmentId, matchedEntries, stats }
}

/** Fusiona por equipmentRef normalizado; el Excel nuevo pisa el anterior. */
export function mergeEntregaEntries(
  existing: EntregaEntry[],
  incoming: EntregaEntry[],
): { merged: EntregaEntry[]; upserted: number } {
  const map = new Map<string, EntregaEntry>()
  for (const e of existing) {
    map.set(e.equipmentRef.trim().toUpperCase(), e)
  }
  let upserted = 0
  for (const e of incoming) {
    const key = e.equipmentRef.trim().toUpperCase()
    const prev = map.get(key)
    if (
      !prev ||
      prev.installComplete !== e.installComplete ||
      prev.delivered !== e.delivered ||
      prev.equipmentRef !== e.equipmentRef
    ) {
      upserted += 1
    }
    map.set(key, e)
  }
  return { merged: [...map.values()], upserted }
}
