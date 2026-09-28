/**
 * Estado entregas (Excel admin): instalación completa + entregado, por buque.
 * Cada Excel nuevo se acumula (merge por equipo); los ya verificados se conservan.
 */
import { useSyncExternalStore } from 'react'
import { getTopology } from '../topology'
import type { DistributionData } from '../types'
import type { VesselId } from '../vessels/vesselCatalog'
import { parseEntregasExcel } from './parseEntregasExcel'
import {
  clearPersistedEntregas,
  entregaEntriesFingerprint,
  getEntregasUpdatedAt,
  loadPersistedEntregas,
  savePersistedEntregas,
} from './persistence'
import type { EntregasCloudPayload } from './cloudSync'
import { mergeEntregaEntries, resolveEntregas } from './resolveEntregas'
import {
  EMPTY_ENTREGA_OVERLAY,
  type EntregaEntry,
  type EntregaImportStats,
  type EntregaOverlayState,
} from './types'

export type { EntregaEntry, EntregaImportStats, EntregaOverlayState }
export { eqEntregaClass, isEntregaLayerVisible } from './boardClasses'
export { parseEntregasExcel } from './parseEntregasExcel'
export { resolveEntregas, mergeEntregaEntries } from './resolveEntregas'
export { entregaEntriesFingerprint } from './persistence'

export type LoadEntregasResult = EntregaImportStats & {
  unchanged: boolean
  persisted: boolean
}

let activeVesselId: VesselId | null = null
let cachedEntries: EntregaEntry[] | null = null
let cachedFingerprint: string | null = null
let cachedUpdatedAt = '1970-01-01T00:00:00.000Z'
let suppressCloudPublish = false
const cloudPublishListeners = new Set<() => void>()
let meta: Omit<EntregaOverlayState, 'byEquipmentId'> = {
  enabled: false,
  hasData: false,
  fileName: null,
  notice: null,
  stats: null,
  revision: 0,
}

let cachedState: EntregaOverlayState = { ...EMPTY_ENTREGA_OVERLAY }

const listeners = new Set<() => void>()

function emptyMeta(revision: number) {
  return {
    enabled: false,
    hasData: false,
    fileName: null as string | null,
    notice: null as string | null,
    stats: null as EntregaImportStats | null,
    revision,
  }
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
    clearPersistedEntregas(activeVesselId)
    return true
  }
  return savePersistedEntregas(activeVesselId, {
    version: 1,
    enabled: meta.enabled,
    fileName: meta.fileName,
    fingerprint: cachedFingerprint,
    entries: cachedEntries,
    updatedAt: cachedUpdatedAt,
  })
}

function applyResolve(
  data: DistributionData,
  notice: string | null = null,
  upserted = 0,
) {
  if (!cachedEntries?.length) {
    cachedState = {
      ...EMPTY_ENTREGA_OVERLAY,
      ...meta,
      byEquipmentId: new Map(),
    }
    return
  }
  const resolved = resolveEntregas(data, cachedEntries, { upserted })
  meta = {
    ...meta,
    hasData: true,
    stats: {
      ...resolved.stats,
      rowsRead: cachedEntries.length,
      totalStored: resolved.byEquipmentId.size,
    },
    notice,
  }
  cachedState = {
    ...meta,
    byEquipmentId: resolved.byEquipmentId,
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
  const stored = loadPersistedEntregas(vesselId)
  activeVesselId = vesselId
  cachedUpdatedAt = getEntregasUpdatedAt(stored)
  if (!stored?.entries.length) {
    cachedEntries = null
    cachedFingerprint = null
    meta = emptyMeta(meta.revision + 1)
    cachedState = {
      ...EMPTY_ENTREGA_OVERLAY,
      revision: meta.revision,
      byEquipmentId: new Map(),
    }
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

export function setEntregasVessel(
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

export function getEntregaOverlay(): EntregaOverlayState {
  return cachedState
}

export function getEntregasVesselId(): VesselId | null {
  return activeVesselId
}

export function subscribeEntrega(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useEntregaOverlay(): EntregaOverlayState {
  return useSyncExternalStore(
    subscribeEntrega,
    getEntregaOverlay,
    getEntregaOverlay,
  )
}

export function loadEntregasFromExcel(
  buffer: ArrayBuffer,
  fileName: string,
  data: DistributionData = getTopology(),
  vesselId?: VesselId,
): LoadEntregasResult {
  if (vesselId && activeVesselId !== vesselId) {
    if (activeVesselId && cachedEntries?.length && cachedFingerprint) {
      persistCurrent()
    }
    loadVesselIntoMemory(vesselId, data)
  }
  if (!activeVesselId) {
    throw new Error('No hay buque activo para estado entregas.')
  }

  const incoming = parseEntregasExcel(buffer)
  if (!incoming.length) {
    const notice = `Excel «${fileName}» sin filas válidas (col. A equipo, col. H instalación SI/NO).`
    meta = { ...meta, notice }
    cachedState = { ...cachedState, notice }
    emit()
    return {
      rowsRead: 0,
      matched: 0,
      incomplete: 0,
      complete: 0,
      delivered: 0,
      skippedUnknown: 0,
      upserted: 0,
      totalStored: cachedEntries?.length ?? 0,
      unchanged: true,
      persisted: true,
    }
  }

  const { merged, upserted } = mergeEntregaEntries(
    cachedEntries ?? [],
    incoming,
  )
  const fingerprint = entregaEntriesFingerprint(merged)
  const unchanged =
    cachedFingerprint != null &&
    fingerprint === cachedFingerprint &&
    cachedEntries != null

  if (unchanged) {
    meta = {
      ...meta,
      enabled: true,
      fileName,
      notice: `Excel «${fileName}» sin cambios respecto al memorizado de ${activeVesselId} (${incoming.length} filas). Capa activa.`,
    }
    bumpRevision()
    bumpUpdatedAt()
    applyResolve(data, meta.notice, 0)
    const persisted = persistCurrent()
    emit()
    notifyCloudPublish()
    return {
      ...(cachedState.stats ?? {
        rowsRead: incoming.length,
        matched: 0,
        incomplete: 0,
        complete: 0,
        delivered: 0,
        skippedUnknown: 0,
        upserted: 0,
        totalStored: cachedEntries?.length ?? 0,
      }),
      unchanged: true,
      persisted,
    }
  }

  cachedEntries = merged
  cachedFingerprint = fingerprint
  meta = {
    ...meta,
    enabled: true,
    fileName,
    notice: null,
  }
  bumpRevision()
  bumpUpdatedAt()
  applyResolve(data, null, upserted)
  const persisted = persistCurrent()
  const stats = cachedState.stats!
  const baseNotice = `Estado entregas «${fileName}» (${activeVesselId}): +${upserted} equipos · total ${stats.totalStored} · ${stats.complete} inst. OK · ${stats.incomplete} pendientes · ${stats.delivered} entregados (${stats.skippedUnknown} sin match en este Excel).`
  const notice = persisted
    ? `${baseNotice} Sincronizando…`
    : `${baseNotice} Aviso: no se pudo guardar en este navegador.`
  meta = { ...meta, notice, stats }
  cachedState = { ...cachedState, notice, stats }
  emit()
  notifyCloudPublish()
  return {
    ...stats,
    unchanged: false,
    persisted,
  }
}

export function refreshEntregasForTopology(
  data: DistributionData = getTopology(),
): void {
  if (!cachedEntries?.length) return
  bumpRevision()
  applyResolve(data, meta.notice)
  persistCurrent()
  emit()
}

export function setEntregasEnabled(enabled: boolean): void {
  if (!cachedEntries?.length || !activeVesselId) return
  if (meta.enabled === enabled) return
  const notice = enabled
    ? `Capa estado entregas activada (${activeVesselId} · ${meta.fileName ?? 'memorizado'}).`
    : `Capa estado entregas desactivada (${activeVesselId}; datos memorizados).`
  meta = { ...meta, enabled, notice }
  bumpRevision()
  bumpUpdatedAt()
  applyResolve(getTopology(), notice)
  persistCurrent()
  emit()
  notifyCloudPublish()
}

export function clearEntregas(): void {
  cachedEntries = null
  cachedFingerprint = null
  meta = emptyMeta(meta.revision + 1)
  cachedState = {
    ...EMPTY_ENTREGA_OVERLAY,
    revision: meta.revision,
    byEquipmentId: new Map(),
  }
  bumpUpdatedAt()
  if (activeVesselId) {
    savePersistedEntregas(activeVesselId, {
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

export function getEntregasCloudSnapshot(): EntregasCloudPayload | null {
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

export function getEntregasUpdatedAtIso(): string {
  return cachedUpdatedAt
}

export function adoptEntregasFromCloud(
  remote: EntregasCloudPayload,
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
      cachedState = {
        ...EMPTY_ENTREGA_OVERLAY,
        revision: meta.revision,
        byEquipmentId: new Map(),
      }
      clearPersistedEntregas(activeVesselId)
      emit()
      return
    }
    cachedEntries = remote.entries
    cachedFingerprint =
      remote.fingerprint || entregaEntriesFingerprint(remote.entries)
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

export function subscribeEntregasCloudPublish(
  listener: () => void,
): () => void {
  cloudPublishListeners.add(listener)
  return () => cloudPublishListeners.delete(listener)
}

export function clearEntregaNotice(): void {
  if (!meta.notice) return
  meta = { ...meta, notice: null }
  cachedState = { ...cachedState, notice: null }
  emit()
}
