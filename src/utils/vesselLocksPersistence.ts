/**
 * Candados LOTO por buque (independientes).
 * El unifilar (circuitos / interruptores) es compartido.
 * Sync cloud: vessels/{vesselId}/locks/state (LWW por updatedAt).
 */
import type { CircuitLockInfo } from './parseLocksExcel'
import type { VesselId } from '../vessels/vesselCatalog'
import { vesselUsesSeedLocks } from '../vessels/vesselCatalog'
import lockListSeed from '../data/lockList.json'

const SEED_LOCKS: Record<string, CircuitLockInfo> = (
  lockListSeed as { locks?: Record<string, CircuitLockInfo> }
).locks ?? {}

export type PersistedVesselLocks = {
  v: 1
  lockedCircuits: string[]
  lockInfoByCircuit: Record<string, CircuitLockInfo>
  /** ISO · LWW cloud / local */
  updatedAt: string
  /** @deprecated alias de updatedAt en lecturas antiguas */
  savedAt?: string
}

function storageKey(vesselId: VesselId): string {
  return `scada-vessel-${vesselId}-locks-v1`
}

export function defaultLocksForVessel(vesselId: VesselId): {
  lockedCircuits: string[]
  lockInfoByCircuit: Record<string, CircuitLockInfo>
  updatedAt: string
} {
  /** Epoch bajo: un remoto en la nube siempre gana al seed local. */
  const updatedAt = '1970-01-01T00:00:00.000Z'
  if (vesselUsesSeedLocks(vesselId)) {
    return {
      lockedCircuits: Object.keys(SEED_LOCKS),
      lockInfoByCircuit: { ...SEED_LOCKS },
      updatedAt,
    }
  }
  return { lockedCircuits: [], lockInfoByCircuit: {}, updatedAt }
}

export function loadVesselLocks(vesselId: VesselId): {
  lockedCircuits: string[]
  lockInfoByCircuit: Record<string, CircuitLockInfo>
  updatedAt: string
} {
  try {
    const raw = localStorage.getItem(storageKey(vesselId))
    if (!raw) return defaultLocksForVessel(vesselId)
    const parsed = JSON.parse(raw) as PersistedVesselLocks
    if (
      parsed?.v !== 1 ||
      !Array.isArray(parsed.lockedCircuits) ||
      typeof parsed.lockInfoByCircuit !== 'object' ||
      parsed.lockInfoByCircuit == null
    ) {
      return defaultLocksForVessel(vesselId)
    }
    const updatedAt =
      (typeof parsed.updatedAt === 'string' && parsed.updatedAt) ||
      (typeof parsed.savedAt === 'string' && parsed.savedAt) ||
      '1970-01-01T00:00:00.000Z'
    return {
      lockedCircuits: parsed.lockedCircuits,
      lockInfoByCircuit: { ...parsed.lockInfoByCircuit },
      updatedAt,
    }
  } catch {
    return defaultLocksForVessel(vesselId)
  }
}

export function saveVesselLocks(
  vesselId: VesselId,
  data: {
    lockedCircuits: Set<string> | string[]
    lockInfoByCircuit: Record<string, CircuitLockInfo>
    /** Si se omite, se usa ahora (mutación local). */
    updatedAt?: string
  },
): string {
  const updatedAt = data.updatedAt ?? new Date().toISOString()
  try {
    const locked = Array.isArray(data.lockedCircuits)
      ? data.lockedCircuits
      : [...data.lockedCircuits]
    const payload: PersistedVesselLocks = {
      v: 1,
      lockedCircuits: locked,
      lockInfoByCircuit: { ...data.lockInfoByCircuit },
      updatedAt,
      savedAt: updatedAt,
    }
    localStorage.setItem(storageKey(vesselId), JSON.stringify(payload))
  } catch {
    /* cuota / modo privado */
  }
  return updatedAt
}

export { SEED_LOCKS as F111_SEED_LOCKS }
