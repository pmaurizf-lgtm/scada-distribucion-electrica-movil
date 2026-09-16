import type { VesselId } from '../vessels/vesselCatalog'
import type { EnergizationEntry } from './types'

const LEGACY_STORAGE_KEY = 'scada-board-energizations-v1'

export type PersistedBoardEnergizations = {
  version: 1
  enabled: boolean
  fileName: string | null
  fingerprint: string
  entries: EnergizationEntry[]
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
    savePersistedBoardEnergizations(vesselId, legacy)
    localStorage.removeItem(LEGACY_STORAGE_KEY)
    return legacy
  } catch {
    return null
  }
}

export function savePersistedBoardEnergizations(
  vesselId: VesselId,
  data: PersistedBoardEnergizations,
): void {
  try {
    localStorage.setItem(storageKey(vesselId), JSON.stringify(data))
  } catch {
    /* quota / modo privado */
  }
}

export function clearPersistedBoardEnergizations(vesselId: VesselId): void {
  try {
    localStorage.removeItem(storageKey(vesselId))
  } catch {
    /* ignore */
  }
}
