import type { VesselId } from '../vessels/vesselCatalog'
import type { EnergizationEntry } from './types'

const LEGACY_STORAGE_KEY = 'scada-board-energizations-v1'

export type PersistedBoardEnergizations = {
  version: 1
  enabled: boolean
  fileName: string | null
  /** Huella del Excel completo (todas las filas leídas). */
  fingerprint: string
  /** Solo filas que cruzan con circuitRef del unifilar (compacto). */
  entries: EnergizationEntry[]
  /** ISO · LWW cloud / local */
  updatedAt?: string
}

function storageKey(vesselId: VesselId): string {
  return `scada-vessel-${vesselId}-energizations-v1`
}

function normCode(raw: string): string {
  return raw.trim().toUpperCase()
}

/** Huella estable del contenido relevante del Excel (código + SI/NO). */
export function energizationEntriesFingerprint(
  entries: EnergizationEntry[],
): string {
  return entries
    .map((e) => `${normCode(e.cableCode)}|${e.energized ? '1' : '0'}`)
    .sort()
    .join('\n')
}

function parseStored(raw: string | null): PersistedBoardEnergizations | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as PersistedBoardEnergizations
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Lee energizaciones del buque. Si no hay clave por buque pero existe la
 * clave global antigua, la migra a este buque (una sola vez).
 */
export function loadPersistedBoardEnergizations(
  vesselId: VesselId,
): PersistedBoardEnergizations | null {
  try {
    const keyed = parseStored(localStorage.getItem(storageKey(vesselId)))
    if (keyed) return keyed

    const legacy = parseStored(localStorage.getItem(LEGACY_STORAGE_KEY))
    if (!legacy?.entries.length) return null
    const ok = savePersistedBoardEnergizations(vesselId, legacy)
    if (ok) localStorage.removeItem(LEGACY_STORAGE_KEY)
    return legacy
  } catch {
    return null
  }
}

/** @returns false si no se pudo escribir (p. ej. cuota localStorage). */
export function savePersistedBoardEnergizations(
  vesselId: VesselId,
  data: PersistedBoardEnergizations,
): boolean {
  try {
    const payload: PersistedBoardEnergizations = {
      ...data,
      updatedAt: data.updatedAt ?? new Date().toISOString(),
    }
    localStorage.setItem(storageKey(vesselId), JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

export function clearPersistedBoardEnergizations(vesselId: VesselId): void {
  try {
    localStorage.removeItem(storageKey(vesselId))
  } catch {
    /* ignore */
  }
}

export function getEnergizationsUpdatedAt(
  data: PersistedBoardEnergizations | null,
): string {
  if (data?.updatedAt) return data.updatedAt
  return '1970-01-01T00:00:00.000Z'
}
