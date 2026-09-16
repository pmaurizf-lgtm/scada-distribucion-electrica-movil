import type { EnergizationEntry } from './types'

const STORAGE_KEY = 'scada-board-energizations-v1'

export type PersistedBoardEnergizations = {
  version: 1
  enabled: boolean
  fileName: string | null
  fingerprint: string
  entries: EnergizationEntry[]
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

export function loadPersistedBoardEnergizations(): PersistedBoardEnergizations | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedBoardEnergizations
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return null
    return parsed
  } catch {
    return null
  }
}

export function savePersistedBoardEnergizations(
  data: PersistedBoardEnergizations,
): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    /* quota / modo privado */
  }
}

export function clearPersistedBoardEnergizations(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
