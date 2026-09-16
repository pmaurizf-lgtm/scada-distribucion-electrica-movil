/**
 * Estado de energizaciones a bordo (Excel de sesión).
 * No persiste en localStorage ni Firebase.
 */
import { useSyncExternalStore } from 'react'
import { getTopology } from '../topology'
import type { DistributionData } from '../types'
import { parseEnergizationsExcel } from './parseEnergizationsExcel'
import { resolveEnergizations } from './resolveEnergizations'
import {
  EMPTY_ENERGIZATION_OVERLAY,
  type EnergizationEntry,
  type EnergizationImportStats,
  type EnergizationOverlayState,
} from './types'

export type { EnergizationEntry, EnergizationImportStats, EnergizationOverlayState }
export { legBoardClass, eqBoardClass, boardBreakerFlags } from './boardClasses'
export { parseEnergizationsExcel } from './parseEnergizationsExcel'
export { resolveEnergizations } from './resolveEnergizations'

let cachedEntries: EnergizationEntry[] | null = null
let meta: Omit<
  EnergizationOverlayState,
  'energizedCircuitIds' | 'deadCircuitIds' | 'energizedEquipmentIds'
> = {
  active: false,
  fileName: null,
  notice: null,
  stats: null,
  revision: 0,
}

let cachedState: EnergizationOverlayState = { ...EMPTY_ENERGIZATION_OVERLAY }

const listeners = new Set<() => void>()

function applyResolve(data: DistributionData, fileName: string | null) {
  if (!cachedEntries?.length) {
    cachedState = { ...EMPTY_ENERGIZATION_OVERLAY, ...meta }
    return
  }
  const resolved = resolveEnergizations(data, cachedEntries)
  meta = {
    ...meta,
    active: true,
    fileName,
    stats: resolved.stats,
    notice: fileName
      ? `Energizaciones «${fileName}»: ${resolved.stats.energized} cables SI · ${resolved.stats.dead} NO · ${resolved.stats.matched} cruzados con el unifilar (${resolved.stats.skippedUnknown} sin match). Solo esta sesión.`
      : meta.notice,
  }
  cachedState = {
    ...meta,
    energizedCircuitIds: resolved.energizedCircuitIds,
    deadCircuitIds: resolved.deadCircuitIds,
    energizedEquipmentIds: resolved.energizedEquipmentIds,
  }
}

function emit() {
  for (const l of listeners) l()
}

export function getEnergizationOverlay(): EnergizationOverlayState {
  return cachedState
}

export function subscribeEnergization(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useEnergizationOverlay(): EnergizationOverlayState {
  return useSyncExternalStore(
    subscribeEnergization,
    getEnergizationOverlay,
    getEnergizationOverlay,
  )
}

export function loadEnergizationsFromExcel(
  buffer: ArrayBuffer,
  fileName: string,
  data: DistributionData = getTopology(),
): EnergizationImportStats {
  cachedEntries = parseEnergizationsExcel(buffer)
  meta = { ...meta, revision: meta.revision + 1 }
  applyResolve(data, fileName)
  emit()
  return cachedState.stats ?? {
    rowsRead: 0,
    matched: 0,
    energized: 0,
    dead: 0,
    skippedUnknown: 0,
  }
}

/** Re-cruza tras cargar otra lista de circuitos en sesión. */
export function refreshEnergizationsForTopology(
  data: DistributionData = getTopology(),
): void {
  if (!cachedEntries?.length) return
  meta = { ...meta, revision: meta.revision + 1 }
  applyResolve(data, meta.fileName)
  emit()
}

export function clearEnergizations(): void {
  cachedEntries = null
  meta = {
    active: false,
    fileName: null,
    notice: null,
    stats: null,
    revision: meta.revision + 1,
  }
  cachedState = { ...EMPTY_ENERGIZATION_OVERLAY, revision: meta.revision }
  emit()
}

export function clearEnergizationNotice(): void {
  if (!meta.notice) return
  meta = { ...meta, notice: null }
  cachedState = { ...cachedState, notice: null }
  emit()
}
