import type { CircuitLockInfo } from '../utils/parseLocksExcel'
import type { VesselId } from '../vessels/vesselCatalog'
import {
  isCloudSyncConfigured,
  isNewerIso,
  pullVesselBlob,
  pushVesselBlob,
  subscribeVesselBlob,
} from '../cloud/vesselBlobSync'

export const LOCKS_CLOUD_COLLECTION = 'locks'

export type LocksCloudPayload = {
  vesselId: VesselId
  updatedAt: string
  lockedCircuits: string[]
  lockInfoByCircuit: Record<string, CircuitLockInfo>
  source?: string
}

function pendingKey(vesselId: VesselId): string {
  return `scada-vessel-${vesselId}-locks-cloud-pending-v1`
}

export function loadLocksPending(vesselId: VesselId): boolean {
  try {
    return localStorage.getItem(pendingKey(vesselId)) === '1'
  } catch {
    return false
  }
}

export function saveLocksPending(vesselId: VesselId, pending: boolean): void {
  try {
    if (pending) localStorage.setItem(pendingKey(vesselId), '1')
    else localStorage.removeItem(pendingKey(vesselId))
  } catch {
    /* ignore */
  }
}

export function parseLocksCloudPayload(
  raw: Record<string, unknown> | null,
  vesselId: VesselId,
): LocksCloudPayload | null {
  if (!raw) return null
  if (typeof raw.updatedAt !== 'string' || !raw.updatedAt) return null
  if (!Array.isArray(raw.lockedCircuits)) return null
  if (typeof raw.lockInfoByCircuit !== 'object' || raw.lockInfoByCircuit == null) {
    return null
  }
  const lockedCircuits = raw.lockedCircuits.filter(
    (x): x is string => typeof x === 'string',
  )
  const lockInfoByCircuit = {
    ...(raw.lockInfoByCircuit as Record<string, CircuitLockInfo>),
  }
  return {
    vesselId,
    updatedAt: raw.updatedAt,
    lockedCircuits,
    lockInfoByCircuit,
    source: typeof raw.source === 'string' ? raw.source : undefined,
  }
}

export async function pullLocksState(
  vesselId: VesselId,
): Promise<LocksCloudPayload | null> {
  if (!isCloudSyncConfigured()) return null
  const raw = await pullVesselBlob<Record<string, unknown>>(
    vesselId,
    LOCKS_CLOUD_COLLECTION,
  )
  return parseLocksCloudPayload(raw, vesselId)
}

export async function pushLocksState(payload: LocksCloudPayload): Promise<void> {
  if (!isCloudSyncConfigured()) return
  await pushVesselBlob(vesselIdOf(payload), LOCKS_CLOUD_COLLECTION, {
    vesselId: payload.vesselId,
    updatedAt: payload.updatedAt,
    lockedCircuits: payload.lockedCircuits,
    lockInfoByCircuit: payload.lockInfoByCircuit,
    source: payload.source ?? null,
  })
}

function vesselIdOf(p: LocksCloudPayload): VesselId {
  return p.vesselId
}

export function subscribeLocksState(
  vesselId: VesselId,
  onChange: (data: LocksCloudPayload | null) => void,
  onError?: (err: Error) => void,
) {
  if (!isCloudSyncConfigured()) return null
  return subscribeVesselBlob<Record<string, unknown>>(
    vesselId,
    LOCKS_CLOUD_COLLECTION,
    (raw) => onChange(parseLocksCloudPayload(raw, vesselId)),
    onError,
  )
}

/** LWW: devuelve qué hacer con local vs remoto. */
export function compareLocksLww(
  localUpdatedAt: string | null | undefined,
  remote: LocksCloudPayload | null,
): 'adopt-remote' | 'push-local' | 'noop' {
  if (!remote) {
    return localUpdatedAt ? 'push-local' : 'noop'
  }
  if (isNewerIso(remote.updatedAt, localUpdatedAt)) return 'adopt-remote'
  if (isNewerIso(localUpdatedAt, remote.updatedAt)) return 'push-local'
  return 'noop'
}
