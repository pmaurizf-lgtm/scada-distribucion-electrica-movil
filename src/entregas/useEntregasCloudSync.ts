import { useCallback, useEffect, useRef } from 'react'
import type { VesselId } from '../vessels/vesselCatalog'
import { isCloudSyncConfigured } from '../cloud/vesselBlobSync'
import {
  adoptEntregasFromCloud,
  getEntregasCloudSnapshot,
  getEntregasUpdatedAtIso,
  subscribeEntregasCloudPublish,
} from './index'
import {
  compareEntregasLww,
  loadEntregasPending,
  pullEntregasState,
  pushEntregasState,
  saveEntregasPending,
  subscribeEntregasState,
  type EntregasCloudPayload,
} from './cloudSync'

/**
 * Sync estado entregas del buque con Firestore
 * (vessels/{id}/entregas/state · LWW por updatedAt).
 */
export function useEntregasCloudSync(vesselId: VesselId): {
  enabled: boolean
} {
  const enabled = isCloudSyncConfigured()
  const ignoreRemoteUntil = useRef(0)
  const localEpoch = useRef(0)

  const publishLocal = useCallback(() => {
    const snap = getEntregasCloudSnapshot()
    if (!snap || snap.vesselId !== vesselId) return
    if (
      !snap.entries.length &&
      snap.updatedAt <= '1970-01-01T00:00:00.000Z'
    ) {
      return
    }
    saveEntregasPending(vesselId, true)
    if (!enabled || !navigator.onLine) return
    ignoreRemoteUntil.current = performance.now() + 1500
    localEpoch.current += 1
    const epoch = localEpoch.current
    void pushEntregasState(snap)
      .then(() => {
        if (epoch !== localEpoch.current) return
        saveEntregasPending(vesselId, false)
      })
      .catch(() => {
        /* pending */
      })
  }, [enabled, vesselId])

  useEffect(() => {
    if (!enabled) return
    let unsub: (() => void) | null = null
    let cancelled = false

    const adoptIfNewer = (remote: EntregasCloudPayload | null) => {
      if (performance.now() < ignoreRemoteUntil.current) return
      const localAt = getEntregasUpdatedAtIso()
      const action = compareEntregasLww(localAt, remote)
      if (action === 'adopt-remote' && remote) {
        adoptEntregasFromCloud(remote)
        saveEntregasPending(vesselId, false)
      } else if (action === 'push-local' || loadEntregasPending(vesselId)) {
        publishLocal()
      }
    }

    const boot = async () => {
      try {
        if (!navigator.onLine) return
        const remote = await pullEntregasState(vesselId)
        if (cancelled) return
        adoptIfNewer(remote)
      } catch {
        /* ignore */
      }
      if (cancelled) return
      unsub = subscribeEntregasState(
        vesselId,
        (remote) => {
          if (!cancelled) adoptIfNewer(remote)
        },
        () => {},
      )
    }

    void boot()
    const unsubPublish = subscribeEntregasCloudPublish(() => {
      publishLocal()
    })

    const onOnline = () => {
      void pullEntregasState(vesselId)
        .then((remote) => {
          if (!cancelled) adoptIfNewer(remote)
        })
        .catch(() => {})
    }
    window.addEventListener('online', onOnline)

    return () => {
      cancelled = true
      unsub?.()
      unsubPublish()
      window.removeEventListener('online', onOnline)
    }
  }, [enabled, vesselId, publishLocal])

  return { enabled }
}
