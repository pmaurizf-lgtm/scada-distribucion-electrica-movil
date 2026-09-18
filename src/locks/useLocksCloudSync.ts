import { useCallback, useEffect, useRef } from 'react'
import type { VesselId } from '../vessels/vesselCatalog'
import { isCloudSyncConfigured } from '../cloud/vesselBlobSync'
import type { CircuitLockInfo } from '../utils/parseLocksExcel'
import {
  compareLocksLww,
  loadLocksPending,
  pullLocksState,
  pushLocksState,
  saveLocksPending,
  subscribeLocksState,
  type LocksCloudPayload,
} from './cloudSync'

export type LocksSnapshot = {
  updatedAt: string
  lockedCircuits: string[]
  lockInfoByCircuit: Record<string, CircuitLockInfo>
  fileName?: string | null
  source?: string
}

/**
 * Sincroniza candados LOTO del buque (Excel / manual) con Firestore.
 * Un documento vessels/{id}/locks/state · LWW por updatedAt.
 */
export function useLocksCloudSync(
  vesselId: VesselId,
  getLocal: () => LocksSnapshot,
  applyRemote: (remote: LocksSnapshot) => void,
): {
  enabled: boolean
  /** Tras mutación local (Excel, poner/quitar candado, reset). */
  publishLocal: (snapshot?: LocksSnapshot) => void
} {
  const enabled = isCloudSyncConfigured()
  const getLocalRef = useRef(getLocal)
  getLocalRef.current = getLocal
  const applyRemoteRef = useRef(applyRemote)
  applyRemoteRef.current = applyRemote
  /** Ignora snapshots remotos que rebotan nuestro propio push. */
  const ignoreRemoteUntil = useRef(0)
  const localEpoch = useRef(0)

  const publishLocal = useCallback(
    (snapshot?: LocksSnapshot) => {
      const local = snapshot ?? getLocalRef.current()
      saveLocksPending(vesselId, true)
      if (!enabled || !navigator.onLine) return
      ignoreRemoteUntil.current = performance.now() + 1500
      localEpoch.current += 1
      const epoch = localEpoch.current
      void pushLocksState({
        vesselId,
        updatedAt: local.updatedAt,
        lockedCircuits: local.lockedCircuits,
        lockInfoByCircuit: local.lockInfoByCircuit,
        fileName: local.fileName ?? null,
        source: local.source,
      })
        .then(() => {
          if (epoch !== localEpoch.current) return
          saveLocksPending(vesselId, false)
        })
        .catch(() => {
          /* pending queda a true */
        })
    },
    [enabled, vesselId],
  )

  useEffect(() => {
    if (!enabled) return
    let unsub: (() => void) | null = null
    let cancelled = false

    const adoptIfNewer = (remote: LocksCloudPayload | null) => {
      if (performance.now() < ignoreRemoteUntil.current) return
      const local = getLocalRef.current()
      const action = compareLocksLww(local.updatedAt, remote)
      const pending = loadLocksPending(vesselId)

      if (action === 'adopt-remote' && remote) {
        applyRemoteRef.current({
          updatedAt: remote.updatedAt,
          lockedCircuits: remote.lockedCircuits,
          lockInfoByCircuit: remote.lockInfoByCircuit,
          fileName: remote.fileName ?? null,
          source: remote.source,
        })
        saveLocksPending(vesselId, false)
        return
      }

      /*
       * Solo empujar si hay pending (Excel/edición) o no hay remoto.
       * Si el localStorage parece más nuevo sin pending, adoptar remoto:
       * evita que el móvil pise la lista publicada desde escritorio.
       */
      if (pending || (action === 'push-local' && !remote)) {
        publishLocal(local)
        return
      }

      if (remote && action === 'push-local' && !pending) {
        applyRemoteRef.current({
          updatedAt: remote.updatedAt,
          lockedCircuits: remote.lockedCircuits,
          lockInfoByCircuit: remote.lockInfoByCircuit,
          fileName: remote.fileName ?? null,
          source: remote.source,
        })
      }
    }

    const boot = async () => {
      try {
        if (!navigator.onLine) return
        const remote = await pullLocksState(vesselId)
        if (cancelled) return
        adoptIfNewer(remote)
      } catch {
        /* offline / rules */
      }
      if (cancelled) return
      unsub = subscribeLocksState(
        vesselId,
        (remote) => {
          if (cancelled) return
          adoptIfNewer(remote)
        },
        () => {
          /* ignore */
        },
      )
    }

    void boot()

    const onOnline = () => {
      void pullLocksState(vesselId)
        .then((remote) => {
          if (!cancelled) adoptIfNewer(remote)
        })
        .catch(() => {})
    }
    window.addEventListener('online', onOnline)

    return () => {
      cancelled = true
      unsub?.()
      window.removeEventListener('online', onOnline)
    }
  }, [enabled, vesselId, publishLocal])

  return { enabled, publishLocal }
}
