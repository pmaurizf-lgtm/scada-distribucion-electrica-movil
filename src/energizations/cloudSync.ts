import type { VesselId } from '../vessels/vesselCatalog'
import type { EnergizationEntry } from './types'
import {
  isCloudSyncConfigured,
  isNewerIso,
  pullVesselBlob,
  pushVesselBlob,
  subscribeVesselBlob,
} from '../cloud/vesselBlobSync'

export const ENERGIZATIONS_CLOUD_COLLECTION = 'energizations'

export type EnergizationsCloudPayload = {
  vesselId: VesselId
  updatedAt: string
  enabled: boolean
  fileName: string | null
  fingerprint: string
  entries: EnergizationEntry[]
}

function pendingKey(vesselId: VesselId): string {
  return `scada-vessel-${vesselId}-energizations-cloud-pending-v1`
}

export function loadEnergizationsPending(vesselId: VesselId): boolean {
  try {
    return localStorage.getItem(pendingKey(vesselId)) === '1'
  } catch {
    return false
  }
}

export function saveEnergizationsPending(
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

function parseEntry(raw: unknown): EnergizationEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.cableCode !== 'string') return null
  if (typeof o.originId !== 'string' || typeof o.destinationId !== 'string') {
    return null
  }
  return {
    cableCode: o.cableCode,
    originId: o.originId,
    destinationId: o.destinationId,
    energized: Boolean(o.energized),
  }
}

export function parseEnergizationsCloudPayload(
  raw: Record<string, unknown> | null,
  vesselId: VesselId,
): EnergizationsCloudPayload | null {
  if (!raw) return null
  if (typeof raw.updatedAt !== 'string' || !raw.updatedAt) return null
  if (!Array.isArray(raw.entries)) return null
  const entries: EnergizationEntry[] = []
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

export async function pullEnergizationsState(
  vesselId: VesselId,
): Promise<EnergizationsCloudPayload | null> {
  if (!isCloudSyncConfigured()) return null
  const raw = await pullVesselBlob<Record<string, unknown>>(
    vesselId,
    ENERGIZATIONS_CLOUD_COLLECTION,
  )
  return parseEnergizationsCloudPayload(raw, vesselId)
}

export async function pushEnergizationsState(
  payload: EnergizationsCloudPayload,
): Promise<void> {
  if (!isCloudSyncConfigured()) return
  await pushVesselBlob(payload.vesselId, ENERGIZATIONS_CLOUD_COLLECTION, {
    vesselId: payload.vesselId,
    updatedAt: payload.updatedAt,
    enabled: payload.enabled,
    fileName: payload.fileName,
    fingerprint: payload.fingerprint,
    entries: payload.entries,
  })
}

export function subscribeEnergizationsState(
  vesselId: VesselId,
  onChange: (data: EnergizationsCloudPayload | null) => void,
  onError?: (err: Error) => void,
) {
  if (!isCloudSyncConfigured()) return null
  return subscribeVesselBlob<Record<string, unknown>>(
    vesselId,
    ENERGIZATIONS_CLOUD_COLLECTION,
    (raw) => onChange(parseEnergizationsCloudPayload(raw, vesselId)),
    onError,
  )
}

export function compareEnergizationsLww(
  localUpdatedAt: string | null | undefined,
  remote: EnergizationsCloudPayload | null,
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
