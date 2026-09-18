/**
 * Energizaciones a bordo (Excel admin), independientes por buque.
 * Se memorizan en localStorage (solo cables cruzados con el unifilar).
 */
import { useSyncExternalStore } from 'react'
import { getTopology } from '../topology'
import type { DistributionData } from '../types'
import type { VesselId } from '../vessels/vesselCatalog'
import { parseEnergizationsExcel } from './parseEnergizationsExcel'
import {
  clearPersistedBoardEnergizations,
  energizationEntriesFingerprint,
  getEnergizationsUpdatedAt,
  loadPersistedBoardEnergizations,
  savePersistedBoardEnergizations,
} from './persistence'
import type { EnergizationsCloudPayload } from './cloudSync'
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
  persisted: boolean
}

let activeVesselId: VesselId | null = null
let cachedEntries: EnergizationEntry[] | null = null
let cachedFingerprint: string | null = null
/** ISO LWW · mutaciones locales / adopción cloud */
let cachedUpdatedAt = '1970-01-01T00:00:00.000Z'
let suppressCloudPublish = false
const cloudPublishListeners = new Set<() => void>()
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

/** Solo filas cuyo código existe como circuitRef (cabecera Excel ≈ 24k → ~cientos). */
function entriesMatchingTopology(
  entries: EnergizationEntry[],
  data: DistributionData,
): EnergizationEntry[] {
  const refs = new Set<string>()
  for (const c of data.circuits) {
    if (!c.circuitRef) continue
    refs.add(c.circuitRef.trim().toUpperCase())
  }
  return entries.filter((e) => refs.has(e.cableCode.trim().toUpperCase()))
}

function bumpUpdatedAt(iso?: string) {
  cachedUpdatedAt = iso ?? new Date().toISOString()
}

function notifyCloudPublish() {
  if (suppressCloudPublish) return
  for (const l of cloudPublishListeners) l()
}

function persistCurrent(): boolean {
  if (!activeVesselId) return false
  if (!cachedEntries?.length || !cachedFingerprint) {
    clearPersistedBoardEnergizations(activeVesselId)
    return true
  }
  return savePersistedBoardEnergizations(activeVesselId, {
    version: 1,
    enabled: meta.enabled,
    fileName: meta.fileName,
    fingerprint: cachedFingerprint,
    entries: cachedEntries,
    updatedAt: cachedUpdatedAt,
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
  cachedUpdatedAt = getEnergizationsUpdatedAt(stored)
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
 * Persiste el buque actual antes de cambiar.
 */
export function setEnergizationsVessel(
  vesselId: VesselId,
  data: DistributionData = getTopology(),
): void {
  if (activeVesselId === vesselId) return
  if (activeVesselId && cachedEntries?.length && cachedFingerprint) {
    persistCurrent()
  }
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
    if (activeVesselId && cachedEntries?.length && cachedFingerprint) {
      persistCurrent()
    }
    loadVesselIntoMemory(vesselId, data)
  }
  if (!activeVesselId) {
    throw new Error('No hay buque activo para energizaciones.')
  }

  const allEntries = parseEnergizationsExcel(buffer)
  const fingerprint = energizationEntriesFingerprint(allEntries)
  const matchedEntries = entriesMatchingTopology(allEntries, data)
  const unchanged =
    cachedFingerprint != null &&
    fingerprint === cachedFingerprint &&
    cachedEntries != null

  if (unchanged) {
    meta = {
      ...meta,
      enabled: true,
      fileName,
      notice: `Excel «${fileName}» sin cambios respecto al memorizado de ${activeVesselId} (${allEntries.length} filas). Capa activa.`,
    }
    bumpRevision()
    bumpUpdatedAt()
    applyResolve(data, meta.notice)
    const persisted = persistCurrent()
    if (!persisted) {
      meta = {
        ...meta,
        notice: `Capa activa en ${activeVesselId}, pero no se pudo guardar en este navegador (almacenamiento lleno).`,
      }
      cachedState = { ...cachedState, notice: meta.notice }
    }
    emit()
    notifyCloudPublish()
    return {
      ...(cachedState.stats ?? {
        rowsRead: allEntries.length,
        matched: matchedEntries.length,
        energized: 0,
        dead: 0,
        skippedUnknown: allEntries.length - matchedEntries.length,
      }),
      unchanged: true,
      persisted,
    }
  }

  cachedEntries = matchedEntries
  cachedFingerprint = fingerprint
  meta = {
    ...meta,
    enabled: true,
    fileName,
    notice: null,
  }
  bumpRevision()
  bumpUpdatedAt()
  applyResolve(data, null)
  const stats: EnergizationImportStats = {
    rowsRead: allEntries.length,
    matched: matchedEntries.length,
    energized: cachedState.stats?.energized ?? 0,
    dead: cachedState.stats?.dead ?? 0,
    skippedUnknown: allEntries.length - matchedEntries.length,
  }
  meta = { ...meta, stats }
  cachedState = { ...cachedState, stats }
  const persisted = persistCurrent()
  const baseNotice = `Energizaciones «${fileName}» memorizadas (${activeVesselId}): ${stats.energized} cables SI · ${stats.dead} NO · ${stats.matched} cruzados con el unifilar (${stats.skippedUnknown} sin match).`
  const notice = persisted
    ? `${baseNotice} Sincronizando entre dispositivos…`
    : `${baseNotice} Aviso: no se pudo guardar en este navegador (almacenamiento lleno); se perderá al cambiar de buque.`
  meta = { ...meta, notice }
  cachedState = { ...cachedState, notice }
  emit()
  notifyCloudPublish()
  return {
    ...stats,
    unchanged: false,
    persisted,
  }
}

/** Re-cruza tras cargar otra lista de circuitos en sesión. */
export function refreshEnergizationsForTopology(
  data: DistributionData = getTopology(),
): void {
  if (!cachedEntries?.length) return
  cachedEntries = entriesMatchingTopology(cachedEntries, data)
  bumpRevision()
  applyResolve(data, meta.notice)
  persistCurrent()
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
  bumpUpdatedAt()
  applyResolve(getTopology(), notice)
  persistCurrent()
  emit()
  notifyCloudPublish()
}

export function clearEnergizations(): void {
  cachedEntries = null
  cachedFingerprint = null
  meta = emptyMeta(meta.revision + 1)
  cachedState = { ...EMPTY_ENERGIZATION_OVERLAY, revision: meta.revision }
  bumpUpdatedAt()
  if (activeVesselId) {
    /* Tombstone local vacío con updatedAt para que el cloud propague el borrado. */
    savePersistedBoardEnergizations(activeVesselId, {
      version: 1,
      enabled: false,
      fileName: null,
      fingerprint: '',
      entries: [],
      updatedAt: cachedUpdatedAt,
    })
  }
  emit()
  notifyCloudPublish()
}

export function getEnergizationsCloudSnapshot(): EnergizationsCloudPayload | null {
  if (!activeVesselId) return null
  return {
    vesselId: activeVesselId,
    updatedAt: cachedUpdatedAt,
    enabled: meta.enabled,
    fileName: meta.fileName,
    fingerprint: cachedFingerprint ?? '',
    entries: cachedEntries ?? [],
  }
}

export function getEnergizationsUpdatedAtIso(): string {
  return cachedUpdatedAt
}

/** Adopta estado remoto (LWW). No dispara publish. */
export function adoptEnergizationsFromCloud(
  remote: EnergizationsCloudPayload,
  data: DistributionData = getTopology(),
): void {
  if (!activeVesselId || remote.vesselId !== activeVesselId) return
  suppressCloudPublish = true
  try {
    cachedUpdatedAt = remote.updatedAt
    if (!remote.entries.length) {
      cachedEntries = null
      cachedFingerprint = null
      meta = emptyMeta(meta.revision + 1)
      cachedState = { ...EMPTY_ENERGIZATION_OVERLAY, revision: meta.revision }
      clearPersistedBoardEnergizations(activeVesselId)
      emit()
      return
    }
    cachedEntries = remote.entries
    cachedFingerprint = remote.fingerprint || energizationEntriesFingerprint(remote.entries)
    meta = {
      enabled: remote.enabled,
      hasData: true,
      fileName: remote.fileName,
      notice: null,
      stats: null,
      revision: meta.revision + 1,
    }
    applyResolve(data, null)
    persistCurrent()
    emit()
  } finally {
    suppressCloudPublish = false
  }
}

export function subscribeEnergizationsCloudPublish(
  listener: () => void,
): () => void {
  cloudPublishListeners.add(listener)
  return () => cloudPublishListeners.delete(listener)
}

export function clearEnergizationNotice(): void {
  if (!meta.notice) return
  meta = { ...meta, notice: null }
  cachedState = { ...cachedState, notice: null }
  emit()
}
