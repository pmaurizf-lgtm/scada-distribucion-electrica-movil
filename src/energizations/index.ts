/**
 * Energizaciones a bordo (Excel admin).
 * Se memorizan en localStorage hasta cargar otro Excel con cambios.
 */
import { useSyncExternalStore } from 'react'
import { getTopology } from '../topology'
import type { DistributionData } from '../types'
import { parseEnergizationsExcel } from './parseEnergizationsExcel'
import {
  clearPersistedBoardEnergizations,
  energizationEntriesFingerprint,
  loadPersistedBoardEnergizations,
  savePersistedBoardEnergizations,
} from './persistence'
import { resolveEnergizations } from './resolveEnergizations'
import {
  EMPTY_ENERGIZATION_OVERLAY,
  type EnergizationEntry,
  type EnergizationImportStats,
  type EnergizationOverlayState,
} from './types'

export type { EnergizationEntry, EnergizationImportStats, EnergizationOverlayState }
export {
  legBoardClass,
  eqBoardClass,
  boardBreakerFlags,
  isBoardLayerVisible,
} from './boardClasses'
export { parseEnergizationsExcel } from './parseEnergizationsExcel'
export { resolveEnergizations } from './resolveEnergizations'
export { energizationEntriesFingerprint } from './persistence'

export type LoadEnergizationsResult = EnergizationImportStats & {
  unchanged: boolean
}

let cachedEntries: EnergizationEntry[] | null = null
let cachedFingerprint: string | null = null
let meta: Omit<
  EnergizationOverlayState,
  'energizedCircuitIds' | 'deadCircuitIds' | 'energizedEquipmentIds'
> = {
  enabled: false,
  hasData: false,
  fileName: null,
  notice: null,
  stats: null,
  revision: 0,
}

let cachedState: EnergizationOverlayState = { ...EMPTY_ENERGIZATION_OVERLAY }

const listeners = new Set<() => void>()

function persistCurrent(): void {
  if (!cachedEntries?.length || !cachedFingerprint) {
    clearPersistedBoardEnergizations()
    return
  }
  savePersistedBoardEnergizations({
    version: 1,
    enabled: meta.enabled,
    fileName: meta.fileName,
    fingerprint: cachedFingerprint,
    entries: cachedEntries,
  })
}

function applyResolve(data: DistributionData, notice: string | null = null) {
  if (!cachedEntries?.length) {
    cachedState = { ...EMPTY_ENERGIZATION_OVERLAY, ...meta }
    return
  }
  const resolved = resolveEnergizations(data, cachedEntries)
  meta = {
    ...meta,
    hasData: true,
    stats: resolved.stats,
    notice,
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

function bumpRevision() {
  meta = { ...meta, revision: meta.revision + 1 }
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
): LoadEnergizationsResult {
  const entries = parseEnergizationsExcel(buffer)
  const fingerprint = energizationEntriesFingerprint(entries)
  const unchanged =
    cachedFingerprint != null &&
    fingerprint === cachedFingerprint &&
    cachedEntries != null

  if (unchanged) {
    meta = {
      ...meta,
      enabled: true,
      fileName,
      notice: `Excel «${fileName}» sin cambios respecto al memorizado (${entries.length} filas). Capa activa.`,
    }
    bumpRevision()
    applyResolve(data, meta.notice)
    persistCurrent()
    emit()
    return {
      ...(cachedState.stats ?? {
        rowsRead: entries.length,
        matched: 0,
        energized: 0,
        dead: 0,
        skippedUnknown: entries.length,
      }),
      unchanged: true,
    }
  }

  cachedEntries = entries
  cachedFingerprint = fingerprint
  meta = {
    ...meta,
    enabled: true,
    fileName,
    notice: null,
  }
  bumpRevision()
  applyResolve(data, null)
  const notice = `Energizaciones «${fileName}» memorizadas: ${cachedState.stats?.energized ?? 0} cables SI · ${cachedState.stats?.dead ?? 0} NO · ${cachedState.stats?.matched ?? 0} cruzados con el unifilar (${cachedState.stats?.skippedUnknown ?? 0} sin match).`
  meta = { ...meta, notice }
  cachedState = { ...cachedState, notice }
  persistCurrent()
  emit()
  return {
    ...(cachedState.stats ?? {
      rowsRead: entries.length,
      matched: 0,
      energized: 0,
      dead: 0,
      skippedUnknown: entries.length,
    }),
    unchanged: false,
  }
}

/** Re-cruza tras cargar otra lista de circuitos en sesión. */
export function refreshEnergizationsForTopology(
  data: DistributionData = getTopology(),
): void {
  if (!cachedEntries?.length) return
  bumpRevision()
  applyResolve(data, meta.notice)
  emit()
}

export function setBoardEnergizationsEnabled(enabled: boolean): void {
  if (!cachedEntries?.length) return
  if (meta.enabled === enabled) return
  const notice = enabled
    ? `Capa de energizaciones activada (${meta.fileName ?? 'memorizado'}).`
    : 'Capa de energizaciones desactivada (datos memorizados).'
  meta = { ...meta, enabled, notice }
  bumpRevision()
  applyResolve(getTopology(), notice)
  persistCurrent()
  emit()
}

export function clearEnergizations(): void {
  cachedEntries = null
  cachedFingerprint = null
  meta = {
    enabled: false,
    hasData: false,
    fileName: null,
    notice: null,
    stats: null,
    revision: meta.revision + 1,
  }
  cachedState = { ...EMPTY_ENERGIZATION_OVERLAY, revision: meta.revision }
  clearPersistedBoardEnergizations()
  emit()
}

export function clearEnergizationNotice(): void {
  if (!meta.notice) return
  meta = { ...meta, notice: null }
  cachedState = { ...cachedState, notice: null }
  emit()
}

function initFromStorage(): void {
  const stored = loadPersistedBoardEnergizations()
  if (!stored?.entries.length) return
  cachedEntries = stored.entries
  cachedFingerprint = stored.fingerprint
  meta = {
    enabled: stored.enabled,
    hasData: true,
    fileName: stored.fileName,
    notice: null,
    stats: null,
    revision: 0,
  }
  applyResolve(getTopology(), null)
}

initFromStorage()
