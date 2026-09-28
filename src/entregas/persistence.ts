import type { VesselId } from '../vessels/vesselCatalog'
import type { EntregaEntry } from './types'

export type PersistedEntregas = {
  version: 1
  enabled: boolean
  fileName: string | null
  fingerprint: string
  entries: EntregaEntry[]
  updatedAt?: string
}

function storageKey(vesselId: VesselId): string {
  return `scada-vessel-${vesselId}-entregas-v1`
}

function normRef(raw: string): string {
  return raw.trim().toUpperCase()
}

export function entregaEntriesFingerprint(entries: EntregaEntry[]): string {
  return entries
    .map(
      (e) =>
        `${normRef(e.equipmentRef)}|${e.installComplete ? '1' : '0'}|${
          e.delivered ? '1' : '0'
        }`,
    )
    .sort()
    .join('\n')
}

function parseStored(raw: string | null): PersistedEntregas | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as PersistedEntregas
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return null
    return parsed
  } catch {
    return null
  }
}

export function loadPersistedEntregas(
  vesselId: VesselId,
): PersistedEntregas | null {
  try {
    return parseStored(localStorage.getItem(storageKey(vesselId)))
  } catch {
    return null
  }
}

export function savePersistedEntregas(
  vesselId: VesselId,
  data: PersistedEntregas,
): boolean {
  try {
    const payload: PersistedEntregas = {
      ...data,
      updatedAt: data.updatedAt ?? new Date().toISOString(),
    }
    localStorage.setItem(storageKey(vesselId), JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

export function clearPersistedEntregas(vesselId: VesselId): void {
  try {
    localStorage.removeItem(storageKey(vesselId))
  } catch {
    /* ignore */
  }
}

export function getEntregasUpdatedAt(data: PersistedEntregas | null): string {
  if (data?.updatedAt) return data.updatedAt
  return '1970-01-01T00:00:00.000Z'
}
