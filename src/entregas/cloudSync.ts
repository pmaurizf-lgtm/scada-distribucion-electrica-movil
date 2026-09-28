import type { VesselId } from '../vessels/vesselCatalog'
import type { EntregaEntry } from './types'
import {
  isCloudSyncConfigured,
  isNewerIso,
  pullVesselBlob,
  pushVesselBlob,
  subscribeVesselBlob,
} from '../cloud/vesselBlobSync'

export const ENTREGAS_CLOUD_COLLECTION = 'entregas'

export type EntregasCloudPayload = {
  vesselId: VesselId
  updatedAt: string
  enabled: boolean
  fileName: string | null
  fingerprint: string
  entries: EntregaEntry[]
}

function pendingKey(vesselId: VesselId): string {
  return `scada-vessel-${vesselId}-entregas-cloud-pending-v1`
}

export function loadEntregasPending(vesselId: VesselId): boolean {
  try {
    return localStorage.getItem(pendingKey(vesselId)) === '1'
  } catch {
    return false
  }
}

export function saveEntregasPending(
  vesselId: VesselId,
  pending: boolean,
): void {
  try {
    if (pending) localStorage.setItem(pendingKey(vesselId), '1')
    else localStorage.removeItem(pendingKey(vesselId))
  } catch {
    /* ignore */
  }
}

function parseEntry(raw: unknown): EntregaEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.equipmentRef !== 'string') return null
  return {
    equipmentRef: o.equipmentRef,
    installComplete: Boolean(o.installComplete),
    delivered: Boolean(o.delivered),
  }
}

export function parseEntregasCloudPayload(
  raw: Record<string, unknown> | null,
  vesselId: VesselId,
): EntregasCloudPayload | null {
  if (!raw) return null
  if (typeof raw.updatedAt !== 'string' || !raw.updatedAt) return null
  if (!Array.isArray(raw.entries)) return null
  const entries: EntregaEntry[] = []
  for (const row of raw.entries) {
    const e = parseEntry(row)
    if (e) entries.push(e)
  }
  return {
    vesselId,
    updatedAt: raw.updatedAt,
    enabled: Boolean(raw.enabled),
    fileName: typeof raw.fileName === 'string' ? raw.fileName : null,
    fingerprint: typeof raw.fingerprint === 'string' ? raw.fingerprint : '',
    entries,
  }
}

export async function pullEntregasState(
  vesselId: VesselId,
): Promise<EntregasCloudPayload | null> {
  if (!isCloudSyncConfigured()) return null
  const raw = await pullVesselBlob<Record<string, unknown>>(
    vesselId,
    ENTREGAS_CLOUD_COLLECTION,
  )
  return parseEntregasCloudPayload(raw, vesselId)
}

export async function pushEntregasState(
  payload: EntregasCloudPayload,
): Promise<void> {
  if (!isCloudSyncConfigured()) return
  await pushVesselBlob(payload.vesselId, ENTREGAS_CLOUD_COLLECTION, {
    vesselId: payload.vesselId,
    updatedAt: payload.updatedAt,
    enabled: payload.enabled,
    fileName: payload.fileName,
    fingerprint: payload.fingerprint,
    entries: payload.entries,
  })
}

export function subscribeEntregasState(
  vesselId: VesselId,
  onChange: (data: EntregasCloudPayload | null) => void,
  onError?: (err: Error) => void,
) {
  if (!isCloudSyncConfigured()) return null
  return subscribeVesselBlob<Record<string, unknown>>(
    vesselId,
    ENTREGAS_CLOUD_COLLECTION,
    (raw) => onChange(parseEntregasCloudPayload(raw, vesselId)),
    onError,
  )
}

export function compareEntregasLww(
  localUpdatedAt: string | null | undefined,
  remote: EntregasCloudPayload | null,
): 'adopt-remote' | 'push-local' | 'noop' {
  if (!remote) {
    return localUpdatedAt && localUpdatedAt > '1970-01-01T00:00:00.000Z'
      ? 'push-local'
      : 'noop'
  }
  if (isNewerIso(remote.updatedAt, localUpdatedAt)) return 'adopt-remote'
  if (isNewerIso(localUpdatedAt, remote.updatedAt)) return 'push-local'
  return 'noop'
}
