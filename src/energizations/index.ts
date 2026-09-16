/**
 * Energizaciones a bordo (Excel admin), independientes por buque.
 * Se memorizan en localStorage hasta cargar otro Excel con cambios.
 */
import { useSyncExternalStore } from 'react'
import { getTopology } from '../topology'
import type { DistributionData } from '../types'
import type { VesselId } from '../vessels/vesselCatalog'
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

let activeVesselId: VesselId | null = null
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

function emptyMeta(revision: number) {
  return {
    enabled: false,
    hasData: false,
    fileName: null as string | null,
    notice: null as string | null,
    stats: null as EnergizationImportStats | null,
    revision,
  }
}

function persistCurrent(): void {
  if (!activeVesselId) return
  if (!cachedEntries?.length || !cachedFingerprint) {
    clearPersistedBoardEnergizations(activeVesselId)
    return
  }
  savePersistedBoardEnergizations(activeVesselId, {
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

function loadVesselIntoMemory(
  vesselId: VesselId,
  data: DistributionData = getTopology(),
): void {
  const stored = loadPersistedBoardEnergizations(vesselId)
  activeVesselId = vesselId
  if (!stored?.entries.length) {
    cachedEntries = null
    cachedFingerprint = null
    meta = emptyMeta(meta.revision + 1)
    cachedState = { ...EMPTY_ENERGIZATION_OVERLAY, revision: meta.revision }
    return
  }
  cachedEntries = stored.entries
  cachedFingerprint = stored.fingerprint
  meta = {
    enabled: stored.enabled,
    hasData: true,
    fileName: stored.fileName,
    notice: null,
    stats: null,
    revision: meta.revision + 1,
  }
  applyResolve(data, null)
}

/**
 * Activa el contexto de energizaciones del buque (carga su Excel memorizado).
 * Llamar al montar el unifilar o al cambiar de buque.
 */
export function setEnergizationsVessel(
  vesselId: VesselId,
  data: DistributionData = getTopology(),
): void {
  if (activeVesselId === vesselId) return
  loadVesselIntoMemory(vesselId, data)
  emit()
}

export function getEnergizationOverlay(): EnergizationOverlayState {
  return cachedState
}

export function getEnergizationsVesselId(): VesselId | null {
  return activeVesselId
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
  vesselId?: VesselId,
): LoadEnergizationsResult {
  if (vesselId && activeVesselId !== vesselId) {
    loadVesselIntoMemory(vesselId, data)
  }
  if (!activeVesselId) {
    throw new Error('No hay buque activo para energizaciones.')
  }

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
      notice: `Excel «${fileName}» sin cambios respecto al memorizado de ${activeVesselId} (${entries.length} filas). Capa activa.`,
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
  const notice = `Energizaciones «${fileName}» memorizadas (${activeVesselId}): ${cachedState.stats?.energized ?? 0} cables SI · ${cachedState.stats?.dead ?? 0} NO · ${cachedState.stats?.matched ?? 0} cruzados con el unifilar (${cachedState.stats?.skippedUnknown ?? 0} sin match).`
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
  if (!cachedEntries?.length || !activeVesselId) return
  if (meta.enabled === enabled) return
  const notice = enabled
    ? `Capa de energizaciones activada (${activeVesselId} · ${meta.fileName ?? 'memorizado'}).`
    : `Capa de energizaciones desactivada (${activeVesselId}; datos memorizados).`
  meta = { ...meta, enabled, notice }
  bumpRevision()
  applyResolve(getTopology(), notice)
  persistCurrent()
  emit()
}

export function clearEnergizations(): void {
  cachedEntries = null
  cachedFingerprint = null
  meta = emptyMeta(meta.revision + 1)
  cachedState = { ...EMPTY_ENERGIZATION_OVERLAY, revision: meta.revision }
  if (activeVesselId) clearPersistedBoardEnergizations(activeVesselId)
  emit()
}

export function clearEnergizationNotice(): void {
  if (!meta.notice) return
  meta = { ...meta, notice: null }
  cachedState = { ...cachedState, notice: null }
  emit()
}
