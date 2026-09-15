import { useCallback, useEffect, useRef, useState } from 'react'
import type { VesselId } from '../vessels/vesselCatalog'
import {
  mergeNoteListsFromServer,
  notesFingerprint,
} from './merge'
import { isNotesSyncConfigured } from './syncConfig'
import type { InspectionNote } from './types'

export type NotesSyncState = 'disabled' | 'offline' | 'syncing' | 'ok' | 'error'

export type NotesSyncInfo = {
  enabled: boolean
  state: NotesSyncState
  lastError: string | null
  lastOkAt: string | null
  /** Visibles en la última lectura de Firebase (null = aún no). */
  cloudVisible: number | null
  syncNow: () => void
  enqueuePush: (id: string, snapshot?: InspectionNote) => void
  adoptAndPushAll: (notes: InspectionNote[]) => Promise<void>
}

function pendingKey(vesselId: VesselId): string {
  return `scada-vessel-${vesselId}-notes-pending-v1`
}

function loadPending(vesselId: VesselId): Set<string> {
  try {
    const raw = localStorage.getItem(pendingKey(vesselId))
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

function savePending(vesselId: VesselId, ids: Set<string>): void {
  try {
    localStorage.setItem(pendingKey(vesselId), JSON.stringify([...ids]))
  } catch {
    /* ignore */
  }
}

export function useNotesCloudSync(
  vesselId: VesselId,
  notes: InspectionNote[],
  setNotes: (
    next: InspectionNote[] | ((prev: InspectionNote[]) => InspectionNote[]),
  ) => void,
): NotesSyncInfo {
  const enabled = isNotesSyncConfigured()
  const [state, setState] = useState<NotesSyncState>(
    enabled ? (navigator.onLine ? 'syncing' : 'offline') : 'disabled',
  )
  const [lastError, setLastError] = useState<string | null>(null)
  const [lastOkAt, setLastOkAt] = useState<string | null>(null)
  const [cloudVisible, setCloudVisible] = useState<number | null>(null)
  const notesRef = useRef(notes)
  notesRef.current = notes
  const pending = useRef<Set<string>>(loadPending(vesselId))
  const pendingNotes = useRef<Map<string, InspectionNote>>(new Map())
  const localEpoch = useRef(0)

  const markOk = useCallback(() => {
    setLastError(null)
    setLastOkAt(new Date().toISOString())
    setState(navigator.onLine ? 'ok' : 'offline')
  }, [])

  const markError = useCallback((err: unknown) => {
    const msg = err instanceof Error ? err.message : 'Error de sincronización'
    setLastError(msg)
    setState(navigator.onLine ? 'error' : 'offline')
  }, [])

  const pushIds = useCallback(
    async (ids: Iterable<string>) => {
      if (!enabled || !navigator.onLine) return
      const { pushVesselNote } = await import('./firebaseSync')
      const byId = new Map(notesRef.current.map((n) => [n.id, n]))
      for (const id of ids) {
        const note = pendingNotes.current.get(id) ?? byId.get(id)
        if (!note) {
          pending.current.delete(id)
          pendingNotes.current.delete(id)
          continue
        }
        await pushVesselNote(note)
        pending.current.delete(id)
        pendingNotes.current.delete(id)
      }
      savePending(vesselId, pending.current)
    },
    [enabled, vesselId],
  )

  const enqueuePush = useCallback(
    (id: string, snapshot?: InspectionNote) => {
      pending.current.add(id)
      const note = snapshot ?? notesRef.current.find((n) => n.id === id)
      if (note) pendingNotes.current.set(id, note)
      savePending(vesselId, pending.current)
      if (!enabled) return
      if (!navigator.onLine) {
        setState('offline')
        return
      }
      setState('syncing')
      window.setTimeout(() => {
        void pushIds([id]).then(markOk).catch(markError)
      }, 0)
    },
    [enabled, markError, markOk, pushIds, vesselId],
  )

  const pullAndMerge = useCallback(async () => {
    if (!enabled) return
    const epochAtStart = localEpoch.current
    const { pullVesselNotes, restoreAllBulkWipedNotes } = await import(
      './firebaseSync'
    )
    await restoreAllBulkWipedNotes()
    const remote = await pullVesselNotes(vesselId)
    const remoteLive = remote.filter((n) => !n.deletedAt).length
    setCloudVisible(remoteLive)
    if (epochAtStart !== localEpoch.current) {
      await pushIds([...pending.current])
      return
    }
    const merged = mergeNoteListsFromServer(notesRef.current, remote)
    for (const [id, snap] of [...pendingNotes.current.entries()]) {
      const rem = remote.find((r) => r.id === id)
      if (snap.deletedAt && rem && !rem.deletedAt) {
        pending.current.delete(id)
        pendingNotes.current.delete(id)
        continue
      }
      const cur = merged.find((n) => n.id === id)
      if (!cur) {
        merged.push(snap)
        continue
      }
      const idx = merged.findIndex((n) => n.id === id)
      merged[idx] = mergeNoteListsFromServer([cur], [snap])[0]!
    }
    notesRef.current = merged
    setNotes(merged)
    const remoteIds = new Set(remote.map((n) => n.id))
    for (const n of merged) {
      const rem = remote.find((r) => r.id === n.id)
      if (n.deletedAt && rem && !rem.deletedAt) continue
      if (
        !rem ||
        n.updatedAt > rem.updatedAt ||
        (!n.deletedAt && rem.deletedAt)
      ) {
        pending.current.add(n.id)
        pendingNotes.current.set(n.id, n)
      }
    }
    for (const n of merged) {
      if (!remoteIds.has(n.id)) {
        pending.current.add(n.id)
        pendingNotes.current.set(n.id, n)
      }
    }
    savePending(vesselId, pending.current)
    await pushIds([...pending.current])
  }, [enabled, setNotes, pushIds, vesselId])

  const syncNow = useCallback(() => {
    if (!enabled) return
    if (!navigator.onLine) {
      setState('offline')
      return
    }
    setState('syncing')
    void pullAndMerge().then(markOk).catch(markError)
  }, [enabled, markError, markOk, pullAndMerge])

  const adoptAndPushAll = useCallback(
    async (next: InspectionNote[]) => {
      localEpoch.current += 1
      notesRef.current = next
      for (const n of next) {
        if (n.deletedAt) continue
        pending.current.add(n.id)
        pendingNotes.current.set(n.id, n)
      }
      savePending(vesselId, pending.current)
      if (!enabled) return
      if (!navigator.onLine) {
        setState('offline')
        return
      }
      setState('syncing')
      try {
        await pushIds([...pending.current])
        markOk()
      } catch (err) {
        markError(err)
        throw err
      }
    },
    [enabled, markError, markOk, pushIds, vesselId],
  )

  useEffect(() => {
    pending.current = loadPending(vesselId)
    setCloudVisible(null)
  }, [vesselId])

  useEffect(() => {
    if (!enabled) {
      setState('disabled')
      return
    }
    let unsub: (() => void) | null = null
    let cancelled = false
    const start = async () => {
      const { ensureNotesAuth, subscribeVesselNotes } = await import(
        './firebaseSync'
      )
      await ensureNotesAuth()
      if (cancelled) return
      if (navigator.onLine) {
        setState('syncing')
        try {
          await pullAndMerge()
          markOk()
        } catch (err) {
          markError(err)
        }
      } else {
        setState('offline')
      }
      unsub = subscribeVesselNotes(
        vesselId,
        (remote) => {
          setCloudVisible(remote.filter((n) => !n.deletedAt).length)
          setNotes((prev) => {
            let merged = mergeNoteListsFromServer(prev, remote)
            for (const [id, snap] of pendingNotes.current) {
              const rem = remote.find((r) => r.id === id)
              if (snap.deletedAt && rem && !rem.deletedAt) continue
              const cur = merged.find((n) => n.id === id)
              if (!cur) {
                merged = [...merged, snap]
                continue
              }
              merged = merged.map((n) =>
                n.id === id ? mergeNoteListsFromServer([n], [snap])[0]! : n,
              )
            }
            if (notesFingerprint(merged) === notesFingerprint(prev)) {
              return prev
            }
            notesRef.current = merged
            return merged
          })
        },
        (err) => markError(err),
      )
    }
    void start().catch(markError)
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [enabled, markError, markOk, pullAndMerge, setNotes, vesselId])

  useEffect(() => {
    if (!enabled) return
    const onOnline = () => {
      setState('syncing')
      void pullAndMerge().then(markOk).catch(markError)
    }
    const onOffline = () => setState('offline')
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (!navigator.onLine) return
      setState('syncing')
      void pullAndMerge().then(markOk).catch(markError)
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onVisible)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onVisible)
    }
  }, [enabled, markError, markOk, pullAndMerge])

  return {
    enabled,
    state,
    lastError,
    lastOkAt,
    cloudVisible,
    syncNow,
    enqueuePush,
    adoptAndPushAll,
  }
}
