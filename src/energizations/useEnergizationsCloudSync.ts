import { useCallback, useEffect, useRef } from 'react'
import type { VesselId } from '../vessels/vesselCatalog'
import { isCloudSyncConfigured } from '../cloud/vesselBlobSync'
import {
  adoptEnergizationsFromCloud,
  getEnergizationsCloudSnapshot,
  getEnergizationsUpdatedAtIso,
  subscribeEnergizationsCloudPublish,
} from './index'
import {
  compareEnergizationsLww,
  loadEnergizationsPending,
  pullEnergizationsState,
  pushEnergizationsState,
  saveEnergizationsPending,
  subscribeEnergizationsState,
  type EnergizationsCloudPayload,
} from './cloudSync'

/**
 * Sync energizaciones del buque con Firestore
 * (vessels/{id}/energizations/state · LWW por updatedAt).
 */
export function useEnergizationsCloudSync(vesselId: VesselId): {
  enabled: boolean
} {
  const enabled = isCloudSyncConfigured()
  const ignoreRemoteUntil = useRef(0)
  const localEpoch = useRef(0)

  const publishLocal = useCallback(() => {
    const snap = getEnergizationsCloudSnapshot()
    if (!snap || snap.vesselId !== vesselId) return
    /* Solo publicar si hay datos o un clear reciente (updatedAt real). */
    if (
      !snap.entries.length &&
      snap.updatedAt <= '1970-01-01T00:00:00.000Z'
    ) {
      return
    }
    saveEnergizationsPending(vesselId, true)
    if (!enabled || !navigator.onLine) return
    ignoreRemoteUntil.current = performance.now() + 1500
    localEpoch.current += 1
    const epoch = localEpoch.current
    void pushEnergizationsState(snap)
      .then(() => {
        if (epoch !== localEpoch.current) return
        saveEnergizationsPending(vesselId, false)
      })
      .catch(() => {
        /* pending */
      })
  }, [enabled, vesselId])

  useEffect(() => {
    if (!enabled) return
    let unsub: (() => void) | null = null
    let cancelled = false

    const adoptIfNewer = (remote: EnergizationsCloudPayload | null) => {
      if (performance.now() < ignoreRemoteUntil.current) return
      const localAt = getEnergizationsUpdatedAtIso()
      const action = compareEnergizationsLww(localAt, remote)
      if (action === 'adopt-remote' && remote) {
        adoptEnergizationsFromCloud(remote)
        saveEnergizationsPending(vesselId, false)
      } else if (action === 'push-local' || loadEnergizationsPending(vesselId)) {
        publishLocal()
      }
    }

    const boot = async () => {
      try {
        if (!navigator.onLine) return
        const remote = await pullEnergizationsState(vesselId)
        if (cancelled) return
        adoptIfNewer(remote)
      } catch {
        /* ignore */
      }
      if (cancelled) return
      unsub = subscribeEnergizationsState(
        vesselId,
        (remote) => {
          if (!cancelled) adoptIfNewer(remote)
        },
        () => {},
      )
    }

    void boot()
    const unsubPublish = subscribeEnergizationsCloudPublish(() => {
      publishLocal()
    })

    const onOnline = () => {
      void pullEnergizationsState(vesselId)
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
