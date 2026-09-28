import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import { system690 } from '../data/system690'
import {
  buildOpenProtectionStatus,
  toProtectionStatusMap,
} from '../data/sampleProtectionStatus'
import type { ProtectionStatusMap } from '../types'
import { computeEnergyFlow, toggleProtectionState } from '../utils/energyFlow'
import { findEquipmentByQuery, getUpstreamTrace } from '../utils/upstream'
import { isPendingFeed } from '../utils/cascadeModel'
import {
  clearPersistedSim,
  savePersistedSim,
} from '../utils/simPersistence'
import {
  applyLocksToProtectionStatus,
  parseLockEntriesFromWorkbook,
  parseLockTargetsFromWorkbook,
  remapLocksToTopology,
  resolveLockCircuitIds,
  resolveLockEntries,
  type CircuitLockInfo,
} from '../utils/parseLocksExcel'
import {
  defaultLocksForTopology,
  loadVesselLocksForTopology,
  saveVesselLocks,
} from '../utils/vesselLocksPersistence'
import {
  VESSELS,
  vesselById,
  type VesselId,
} from '../vessels/vesselCatalog'
import { LockInfoProvider } from '../locks/LockInfoContext'
import { useLocksCloudSync } from '../locks/useLocksCloudSync'
import { LockBalloon, placeLockBalloon } from './LockBalloon'
import { useIsMobileUi } from '../hooks/useIsMobileUi'
import {
  CascadeView,
  type CascadeFocus,
  type CascadeViewHandle,
  type LockTool,
} from './CascadeView'
import { NavantiaLogo } from './NavantiaLogo'
import { StartupFeedsPanel } from './StartupFeedsPanel'
import { NoteEditorModal } from './NoteEditorModal'
import { DeckPlanHost } from './DeckPlanHost'
import { requestOpenDeckPlan } from '../deckPlans'
import { NotesPanel } from './NotesPanel'
import { useNotes } from '../notes/NotesContext'
import { useUserProfile } from '../notes/UserProfileContext'
import { useAuth } from '../auth'
import {
  clearTopologyNotice,
  circuitListRevisionLabel,
  loadTopologyFromExcel,
  resetTopologyToEmbedded,
  selectCircuitListRevision,
  useTopologyState,
  type CircuitListRevision,
} from '../topology'
import {
  clearEnergizations,
  isBoardLayerVisible,
  loadEnergizationsFromExcel,
  refreshEnergizationsForTopology,
  setBoardEnergizationsEnabled,
  setEnergizationsVessel,
  useEnergizationOverlay,
} from '../energizations'
import { useEnergizationsCloudSync } from '../energizations/useEnergizationsCloudSync'
import {
  clearEntregas,
  isEntregaLayerVisible,
  loadEntregasFromExcel,
  refreshEntregasForTopology,
  setEntregasEnabled,
  setEntregasVessel,
  useEntregaOverlay,
} from '../entregas'
import { useEntregasCloudSync } from '../entregas/useEntregasCloudSync'

const ZOOM_MIN = 0.25
const ZOOM_MAX = 2.5
const ZOOM_STEP = 0.15
const MAX_LOCK_EXCEL_BYTES = 8 * 1024 * 1024
const MAX_CIRCUIT_LIST_BYTES = 32 * 1024 * 1024
const MAX_ENERGIZATION_BYTES = 16 * 1024 * 1024
const MAX_ENTREGAS_BYTES = 16 * 1024 * 1024
const ALLOWED_LOCK_EXCEL_RE = /\.(xlsx|xls|xlsm)$/i

const REST_STATUS_SOURCE = 'reposo · todos abiertos · gens parados'

function withLocksOpen(
  base: ProtectionStatusMap,
  lockedIds: Iterable<string>,
): ProtectionStatusMap {
  return applyLocksToProtectionStatus(base, [...lockedIds])
}

function locksStatusLine(
  vesselId: VesselId,
  lockCount: number,
): string {
  const name = vesselById(vesselId).label
  return lockCount
    ? `${name} · reposo · ${lockCount} candados LOTO · gens parados`
    : `${name} · ${REST_STATUS_SOURCE}`
}

type ScadaCanvasProps = {
  vesselId: VesselId
  onVesselChange: (id: VesselId) => void
}

export function ScadaCanvas({ vesselId, onVesselChange }: ScadaCanvasProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const circuitListInputRef = useRef<HTMLInputElement>(null)
  const energizationInputRef = useRef<HTMLInputElement>(null)
  const entregasInputRef = useRef<HTMLInputElement>(null)
  const candadosDetailsRef = useRef<HTMLDetailsElement>(null)
  const appMenuRef = useRef<HTMLDetailsElement>(null)
  const cascadeRef = useRef<CascadeViewHandle>(null)
  const isMobile = useIsMobileUi()
  const { notes } = useNotes()
  const { displayName, openProfilePrompt } = useUserProfile()
  const { signOutUser, isAdmin } = useAuth()
  const topo = useTopologyState()
  const energ = useEnergizationOverlay()
  const entregas = useEntregaOverlay()

  useEffect(() => {
    setEnergizationsVessel(vesselId, system690)
    setEntregasVessel(vesselId, system690)
  }, [vesselId])

  const [notesPanelOpen, setNotesPanelOpen] = useState(false)
  const [chromeCollapsed, setChromeCollapsed] = useState(false)
  const [topologyBusy, setTopologyBusy] = useState(false)
  const [protectionStatus, setProtectionStatus] = useState<ProtectionStatusMap>(
    () => {
      const locks = loadVesselLocksForTopology(vesselId, system690)
      return withLocksOpen(
        toProtectionStatusMap(buildOpenProtectionStatus(system690)),
        locks.lockedCircuits,
      )
    },
  )
  const [lockedCircuits, setLockedCircuits] = useState<Set<string>>(() => {
    return new Set(
      loadVesselLocksForTopology(vesselId, system690).lockedCircuits,
    )
  })
  const [lockInfoByCircuit, setLockInfoByCircuit] = useState<
    Record<string, CircuitLockInfo>
  >(() => ({
    ...loadVesselLocksForTopology(vesselId, system690).lockInfoByCircuit,
  }))
  const [locksFileName, setLocksFileName] = useState<string | null>(
    () => loadVesselLocksForTopology(vesselId, system690).fileName,
  )
  const [locksUpdatedAt, setLocksUpdatedAt] = useState(
    () => loadVesselLocksForTopology(vesselId, system690).updatedAt,
  )
  const locksUpdatedAtRef = useRef(locksUpdatedAt)
  const lockedCircuitsRef = useRef(lockedCircuits)
  const lockInfoRef = useRef(lockInfoByCircuit)
  const locksFileNameRef = useRef(locksFileName)
  lockedCircuitsRef.current = lockedCircuits
  lockInfoRef.current = lockInfoByCircuit
  locksFileNameRef.current = locksFileName
  locksUpdatedAtRef.current = locksUpdatedAt
  const applyingLocksRemoteRef = useRef(false)

  const getLocksSnapshot = useCallback(
    () => ({
      updatedAt: locksUpdatedAtRef.current,
      lockedCircuits: [...lockedCircuitsRef.current],
      lockInfoByCircuit: lockInfoRef.current,
      fileName: locksFileNameRef.current,
    }),
    [],
  )

  const applyRemoteLocks = useCallback(
    (remote: {
      updatedAt: string
      lockedCircuits: string[]
      lockInfoByCircuit: Record<string, CircuitLockInfo>
      fileName?: string | null
    }) => {
      const remapped = remapLocksToTopology(
        system690,
        remote.lockInfoByCircuit,
      )
      applyingLocksRemoteRef.current = true
      locksUpdatedAtRef.current = remote.updatedAt
      setLocksUpdatedAt(remote.updatedAt)
      setLockedCircuits(new Set(remapped.lockedCircuits))
      setLockInfoByCircuit({ ...remapped.lockInfoByCircuit })
      setLocksFileName(remote.fileName ?? null)
      setProtectionStatus((prev) =>
        applyLocksToProtectionStatus(prev, remapped.lockedCircuits),
      )
      saveVesselLocks(vesselId, {
        lockedCircuits: remapped.lockedCircuits,
        lockInfoByCircuit: remapped.lockInfoByCircuit,
        updatedAt: remote.updatedAt,
        fileName: remote.fileName ?? null,
      })
      setStatusSource(
        locksStatusLine(vesselId, remapped.lockedCircuits.length) +
          ' · sync nube',
      )
    },
    [vesselId],
  )

  const { publishLocal: publishLocks } = useLocksCloudSync(
    vesselId,
    getLocksSnapshot,
    applyRemoteLocks,
  )
  useEnergizationsCloudSync(vesselId)
  useEntregasCloudSync(vesselId)

  const bumpPublishLocks = useCallback(
    (
      fileName?: string | null,
      /** Obligatorio tras setState: el ref aún puede tener la lista anterior (p. ej. seed 332). */
      snapshot?: {
        lockedCircuits: string[] | Set<string>
        lockInfoByCircuit: Record<string, CircuitLockInfo>
      },
    ) => {
      if (fileName !== undefined) {
        setLocksFileName(fileName)
        locksFileNameRef.current = fileName
      }
      const lockedArr = snapshot
        ? Array.isArray(snapshot.lockedCircuits)
          ? [...snapshot.lockedCircuits]
          : [...snapshot.lockedCircuits]
        : [...lockedCircuitsRef.current]
      const info = snapshot
        ? { ...snapshot.lockInfoByCircuit }
        : { ...lockInfoRef.current }
      if (snapshot) {
        lockedCircuitsRef.current = new Set(lockedArr)
        lockInfoRef.current = info
      }
      const updatedAt = new Date().toISOString()
      locksUpdatedAtRef.current = updatedAt
      setLocksUpdatedAt(updatedAt)
      saveVesselLocks(vesselId, {
        lockedCircuits: lockedArr,
        lockInfoByCircuit: info,
        updatedAt,
        fileName: locksFileNameRef.current,
      })
      publishLocks({
        updatedAt,
        lockedCircuits: lockedArr,
        lockInfoByCircuit: info,
        fileName: locksFileNameRef.current,
        source: fileName ? 'excel' : 'local',
      })
    },
    [publishLocks, vesselId],
  )

  const [lockBalloon, setLockBalloon] = useState<{
    info: CircuitLockInfo
    protectionName?: string
    x: number
    y: number
  } | null>(null)
  const [runningGenerators, setRunningGenerators] = useState<Set<string>>(
    () => new Set(),
  )
  const [lockTool, setLockTool] = useState<LockTool>('none')
  const [zoom, setZoom] = useState(1)
  const [statusSource, setStatusSource] = useState(() => {
    if (topo.sessionOverride && topo.fileName) {
      return `lista circuitos (sesión): ${topo.fileName}`
    }
    const n = loadVesselLocksForTopology(vesselId, system690).lockedCircuits
      .length
    return locksStatusLine(vesselId, n)
  })
  const [locateQuery, setLocateQuery] = useState('')
  const [feedsQuery, setFeedsQuery] = useState('')
  const [searchHint, setSearchHint] = useState<string | null>(null)
  const [focus, setFocus] = useState<CascadeFocus | null>(null)
  const [locateEquipmentId, setLocateEquipmentId] = useState<string | null>(
    null,
  )
  const [startupMode, setStartupMode] = useState(false)
  const [simulationActive, setSimulationActive] = useState(false)

  useEffect(() => {
    // Cada carga: reposo limpio (sin flujo ni candados de sesiones anteriores)
    clearPersistedSim()
  }, [])

  useEffect(() => {
    if (!topo.notice) return
    setSearchHint(topo.notice)
    // Quitar el aviso del store en el siguiente tick para no encadenar updates.
    const t = window.setTimeout(() => clearTopologyNotice(), 0)
    return () => window.clearTimeout(t)
  }, [topo.notice])

  useEffect(() => {
    if (!energ.notice) return
    setSearchHint(energ.notice)
  }, [energ.notice])

  useEffect(() => {
    if (!entregas.notice) return
    setSearchHint(entregas.notice)
  }, [entregas.notice])

  useEffect(() => {
    if (!energ.hasData) return
    refreshEnergizationsForTopology(system690)
  }, [topo.revision, energ.hasData])

  useEffect(() => {
    if (!entregas.hasData) return
    refreshEntregasForTopology(system690)
  }, [topo.revision, entregas.hasData])

  useEffect(() => {
    if (isMobile) {
      setChromeCollapsed(true)
      setSimulationActive(false)
      setLockTool('none')
      setStartupMode(false)
    }
  }, [isMobile])

  const hideChromeForCanvas = useCallback(() => {
    if (!isMobile) return
    setChromeCollapsed(true)
  }, [isMobile])

  useEffect(() => {
    const onInteract = () => hideChromeForCanvas()
    window.addEventListener('scada-canvas-interact', onInteract)
    return () => window.removeEventListener('scada-canvas-interact', onInteract)
  }, [hideChromeForCanvas])

  const showChromeMenu = useCallback(() => {
    setChromeCollapsed(false)
  }, [])

  useEffect(() => {
    savePersistedSim({
      protectionStatus,
      lockedCircuits,
      runningGenerators,
    })
  }, [protectionStatus, lockedCircuits, runningGenerators])

  useEffect(() => {
    if (applyingLocksRemoteRef.current) {
      applyingLocksRemoteRef.current = false
      return
    }
    saveVesselLocks(vesselId, {
      lockedCircuits,
      lockInfoByCircuit,
      updatedAt: locksUpdatedAtRef.current,
      fileName: locksFileName,
    })
  }, [vesselId, lockedCircuits, lockInfoByCircuit, locksFileName])

  const switchVessel = useCallback(
    (next: VesselId) => {
      if (next === vesselId) return
      saveVesselLocks(vesselId, {
        lockedCircuits,
        lockInfoByCircuit,
        updatedAt: locksUpdatedAtRef.current,
        fileName: locksFileName,
      })
      const loaded = loadVesselLocksForTopology(next, system690)
      locksUpdatedAtRef.current = loaded.updatedAt
      setLocksUpdatedAt(loaded.updatedAt)
      setLockedCircuits(new Set(loaded.lockedCircuits))
      setLockInfoByCircuit({ ...loaded.lockInfoByCircuit })
      setLocksFileName(loaded.fileName)
      setProtectionStatus((prev) =>
        withLocksOpen(prev, loaded.lockedCircuits),
      )
      setLockBalloon(null)
      setStatusSource(
        `${vesselById(next).label} · ${loaded.lockedCircuits.length} candados LOTO`,
      )
      onVesselChange(next)
    },
    [vesselId, lockedCircuits, lockInfoByCircuit, locksFileName, onVesselChange],
  )

  const searchableEquipment = useMemo(
    () =>
      system690.equipment.filter(
        (e) =>
          !e.virtual &&
          !e.id.startsWith('BUS-') &&
          !e.id.startsWith('SPARE-') &&
          e.id !== 'ORIGEN-PENDIENTE',
      ),
    [topo.revision],
  )

  const { energizedCircuitIds, energizedEquipmentIds, energizedBusHalves } =
    useMemo(
      () =>
        computeEnergyFlow(system690, protectionStatus, runningGenerators),
      [protectionStatus, runningGenerators, topo.revision],
    )

  const toggleGenerator = useCallback(
    (genId: string) => {
      if (!simulationActive) {
        setSearchHint(
          'Pulsa «Simular estado» para operar generadores e interruptores.',
        )
        return
      }
      setRunningGenerators((prev) => {
        const next = new Set(prev)
        if (next.has(genId)) next.delete(genId)
        else next.add(genId)
        return next
      })
      setStatusSource('simulación · generador conmutado')
    },
    [simulationActive],
  )

  const resetToRestState = useCallback(() => {
    const defaults = defaultLocksForTopology(vesselId, system690)
    setProtectionStatus(
      withLocksOpen(
        toProtectionStatusMap(buildOpenProtectionStatus(system690)),
        defaults.lockedCircuits,
      ),
    )
    setRunningGenerators(new Set())
    setLockedCircuits(new Set(defaults.lockedCircuits))
    setLockInfoByCircuit({ ...defaults.lockInfoByCircuit })
    setLocksFileName(defaults.fileName)
    setLockBalloon(null)
    setLockTool('none')
    setStatusSource(locksStatusLine(vesselId, defaults.lockedCircuits.length))
    locksUpdatedAtRef.current = new Date().toISOString()
    setLocksUpdatedAt(locksUpdatedAtRef.current)
    saveVesselLocks(vesselId, {
      ...defaults,
      updatedAt: locksUpdatedAtRef.current,
      fileName: defaults.fileName,
    })
    clearPersistedSim()
    window.setTimeout(() => {
      publishLocks({
        updatedAt: locksUpdatedAtRef.current,
        lockedCircuits: defaults.lockedCircuits,
        lockInfoByCircuit: defaults.lockInfoByCircuit,
        fileName: defaults.fileName,
        source: 'reset',
      })
    }, 0)
  }, [vesselId, publishLocks])

  const handleSimulateToggle = useCallback(() => {
    setSimulationActive((active) => {
      if (active) {
        resetToRestState()
        return false
      }
      setStatusSource('simulación activa · puede operar interruptores')
      return true
    })
  }, [resetToRestState])

  const handleToggleProtection = useCallback(
    (circuitId: string) => {
      if (!simulationActive) {
        setSearchHint(
          'Pulsa «Simular estado» para abrir o cerrar interruptores.',
        )
        return false
      }
      const circuit = system690.circuits.find((c) => c.id === circuitId)
      if (circuit && isPendingFeed(circuit)) {
        setSearchHint(
          'Alimentación pendiente de identificar: no se puede operar hasta conocer el origen.',
        )
        return false
      }
      if (lockedCircuits.has(circuitId)) {
        setSearchHint(
          `Interruptor bloqueado con candado: no se puede cerrar hasta quitar el candado.`,
        )
        return false
      }
      setProtectionStatus((prev) =>
        toggleProtectionState(prev, circuitId, system690),
      )
      setStatusSource('simulación manual')
      return true
    },
    [lockedCircuits, simulationActive],
  )

  const handleLockCircuit = useCallback((circuitId: string) => {
    if (!simulationActive) {
      setSearchHint(
        'Pulsa «Simular estado» para operar interruptores (candados incluidos).',
      )
      return
    }
    const circuit = system690.circuits.find((c) => c.id === circuitId)
    const nextLocked = new Set(lockedCircuitsRef.current).add(circuitId)
    const prevInfo = lockInfoRef.current[circuitId]
    const nextInfo = {
      ...lockInfoRef.current,
      [circuitId]: {
        lockNumber: prevInfo?.lockNumber ?? '—',
        interruptor:
          prevInfo?.interruptor ??
          circuit?.circuitRef ??
          (circuit
            ? `${circuit.originId}-${circuit.protectionName}`
            : circuitId),
        shortName: prevInfo?.shortName ?? circuit?.protectionName,
        siteEquipment: prevInfo?.siteEquipment ?? circuit?.originId,
        local: prevInfo?.local,
        comment: prevInfo?.comment,
      },
    }
    lockInfoRef.current = nextInfo
    setLockedCircuits(nextLocked)
    setLockInfoByCircuit(nextInfo)
    setProtectionStatus((prev) => ({ ...prev, [circuitId]: 'abierta' }))
    setStatusSource('candado aplicado · interruptor abierto y bloqueado')
    bumpPublishLocks(undefined, {
      lockedCircuits: nextLocked,
      lockInfoByCircuit: nextInfo,
    })
  }, [simulationActive, bumpPublishLocks])

  const handleUnlockCircuit = useCallback((circuitId: string) => {
    if (!simulationActive) {
      setSearchHint(
        'Pulsa «Simular estado» para operar interruptores (candados incluidos).',
      )
      return
    }
    const nextLocked = new Set(lockedCircuitsRef.current)
    nextLocked.delete(circuitId)
    const nextInfo = { ...lockInfoRef.current }
    delete nextInfo[circuitId]
    setLockedCircuits(nextLocked)
    setLockInfoByCircuit(nextInfo)
    setLockBalloon(null)
    setStatusSource('candado retirado · interruptor manipulable')
    bumpPublishLocks(undefined, {
      lockedCircuits: nextLocked,
      lockInfoByCircuit: nextInfo,
    })
  }, [simulationActive, bumpPublishLocks])

  const showLockInfo = useCallback(
    (info: CircuitLockInfo, rect: DOMRect) => {
      const { x, y } = placeLockBalloon(rect)
      const circuitId = Object.entries(lockInfoByCircuit).find(
        ([, v]) =>
          v.lockNumber === info.lockNumber &&
          v.interruptor === info.interruptor,
      )?.[0]
      const protectionName = circuitId
        ? system690.circuits.find((c) => c.id === circuitId)?.protectionName
        : info.comment || info.shortName
      setLockBalloon({ info, protectionName, x, y })
    },
    [lockInfoByCircuit],
  )

  const zoomIn = () => {
    const next = Math.min(ZOOM_MAX, Math.round((zoom + ZOOM_STEP) * 100) / 100)
    if (cascadeRef.current) cascadeRef.current.zoomAtCenter(next)
    else setZoom(next)
  }
  const zoomOut = () => {
    const next = Math.max(ZOOM_MIN, Math.round((zoom - ZOOM_STEP) * 100) / 100)
    if (cascadeRef.current) cascadeRef.current.zoomAtCenter(next)
    else setZoom(next)
  }
  const zoomReset = () => {
    if (cascadeRef.current) cascadeRef.current.zoomAtCenter(1)
    else setZoom(1)
  }

  const closeCandadosMenu = useCallback(() => {
    const el = candadosDetailsRef.current
    if (el) el.open = false
  }, [])

  const closeAppMenu = useCallback(() => {
    const el = appMenuRef.current
    if (el) el.open = false
    closeCandadosMenu()
  }, [closeCandadosMenu])

  const openNotesUnresolved = notes.reduce(
    (sum, n) => sum + n.lines.filter((l) => !l.resolved).length,
    0,
  )

  const handleLockExcelChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      if (!ALLOWED_LOCK_EXCEL_RE.test(file.name) || !file.size) {
        setSearchHint('Archivo Excel de candados no válido.')
        e.target.value = ''
        return
      }
      if (file.size > MAX_LOCK_EXCEL_BYTES) {
        setSearchHint(
          `Excel demasiado grande (${Math.round(file.size / 1024 / 1024)} MiB). Máx. ${Math.round(
            MAX_LOCK_EXCEL_BYTES / 1024 / 1024,
          )} MiB.`,
        )
        e.target.value = ''
        return
      }
      try {
        const buf = await file.arrayBuffer()
        const entries = parseLockEntriesFromWorkbook(buf)
        if (entries.length > 0) {
          const { locks, unresolved } = resolveLockEntries(
            system690,
            entries,
            searchableEquipment,
          )
          const circuitIds = Object.keys(locks)
          if (!circuitIds.length) {
            setSearchHint(
              `Ningún candado aplicable (${unresolved.slice(0, 3).join(', ') || 'sin coincidencias'}).`,
            )
            return
          }
          setLockInfoByCircuit(locks)
          setLockedCircuits(new Set(circuitIds))
          setProtectionStatus((prev) =>
            applyLocksToProtectionStatus(prev, circuitIds),
          )
          setLockTool('none')
          const extra =
            unresolved.length > 0
              ? ` · ${unresolved.length} no resueltos`
              : ''
          setStatusSource(
            `candados Excel: ${file.name} · ${circuitIds.length} interruptores${extra}`,
          )
          setSearchHint(
            `Candados cargados: ${circuitIds.length} interruptores (nº LOTO en col. L)${extra}. Pulsa el candado para ver el número. Se sincronizan en la nube.`,
          )
          closeCandadosMenu()
          bumpPublishLocks(file.name, {
            lockedCircuits: circuitIds,
            lockInfoByCircuit: locks,
          })
          return
        }

        const targets = parseLockTargetsFromWorkbook(buf)
        if (!targets.length) {
          setSearchHint(
            'El Excel no contiene IDs de interruptor (col. D) ni lista de equipos reconocible.',
          )
          return
        }
        const { circuitIds, unresolved } = resolveLockCircuitIds(
          system690,
          targets,
          searchableEquipment,
        )
        if (!circuitIds.length) {
          setSearchHint(
            `Ningún candado aplicable (${unresolved.slice(0, 3).join(', ') || 'sin coincidencias'}).`,
          )
          return
        }
        setLockedCircuits(new Set(circuitIds))
        const nextInfo = { ...lockInfoRef.current }
        for (const id of circuitIds) {
          if (!nextInfo[id]) {
            nextInfo[id] = {
              lockNumber: '—',
              interruptor: id,
            }
          }
        }
        setLockInfoByCircuit(nextInfo)
        setProtectionStatus((prev) => {
          const next = { ...prev }
          for (const id of circuitIds) next[id] = 'abierta'
          return next
        })
        setLockTool('none')
        const extra =
          unresolved.length > 0
            ? ` · ${unresolved.length} no resueltos`
            : ''
        setStatusSource(
          `candados Excel: ${file.name} · ${circuitIds.length} interruptores${extra}`,
        )
        setSearchHint(
          `Candados cargados: ${circuitIds.length} interruptores abiertos y bloqueados${extra}. Se sincronizan en la nube.`,
        )
        closeCandadosMenu()
        bumpPublishLocks(file.name, {
          lockedCircuits: circuitIds,
          lockInfoByCircuit: nextInfo,
        })
      } catch {
        setSearchHint(
          'No se pudo leer el Excel de candados (col. D interruptor, L nº candado; CCM: cruzar D con N).',
        )
      }
      e.target.value = ''
    },
    [closeCandadosMenu, searchableEquipment, bumpPublishLocks],
  )

  const handleCircuitListExcelChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      if (!ALLOWED_LOCK_EXCEL_RE.test(file.name) || !file.size) {
        setSearchHint('Archivo de lista de circuitos no válido (.xlsx / .xlsm).')
        return
      }
      if (file.size > MAX_CIRCUIT_LIST_BYTES) {
        setSearchHint(
          `Excel demasiado grande (${Math.round(file.size / 1024 / 1024)} MiB). Máx. ${Math.round(
            MAX_CIRCUIT_LIST_BYTES / 1024 / 1024,
          )} MiB.`,
        )
        return
      }
      setTopologyBusy(true)
      setSearchHint('Cargando lista de circuitos en el unifilar…')
      try {
        const buf = await file.arrayBuffer()
        loadTopologyFromExcel(buf, file.name)
        refreshEnergizationsForTopology(system690)
        refreshEntregasForTopology(system690)
      } catch (err) {
        setSearchHint(
          err instanceof Error
            ? err.message
            : 'No se pudo leer la lista de circuitos.',
        )
      } finally {
        setTopologyBusy(false)
      }
    },
    [],
  )

  const handleRestoreEmbeddedTopology = useCallback(() => {
    resetTopologyToEmbedded()
    refreshEnergizationsForTopology(system690)
    refreshEntregasForTopology(system690)
  }, [])

  const handleCircuitListRevisionChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const next = e.target.value as CircuitListRevision
      if (next !== 'C' && next !== 'D') return
      selectCircuitListRevision(next)
      refreshEnergizationsForTopology(system690)
      refreshEntregasForTopology(system690)
    },
    [],
  )

  const handleEnergizationExcelChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      if (!ALLOWED_LOCK_EXCEL_RE.test(file.name) || !file.size) {
        setSearchHint('Archivo de energizaciones no válido (.xlsx / .xlsm).')
        return
      }
      if (file.size > MAX_ENERGIZATION_BYTES) {
        setSearchHint(
          `Excel demasiado grande (${Math.round(file.size / 1024 / 1024)} MiB). Máx. ${Math.round(
            MAX_ENERGIZATION_BYTES / 1024 / 1024,
          )} MiB.`,
        )
        return
      }
      setSearchHint('Cargando energizaciones a bordo…')
      try {
        const buf = await file.arrayBuffer()
        const stats = loadEnergizationsFromExcel(
          buf,
          file.name,
          system690,
          vesselId,
        )
        if (stats.unchanged) return
        if (stats.matched === 0) {
          setSearchHint(
            `Ningún código de cable del Excel coincide con circuitRef del unifilar (${stats.skippedUnknown} filas leídas).`,
          )
        }
      } catch (err) {
        setSearchHint(
          err instanceof Error
            ? err.message
            : 'No se pudo leer el Excel de energizaciones.',
        )
      }
    },
    [vesselId],
  )

  const handleEntregasExcelChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      if (!ALLOWED_LOCK_EXCEL_RE.test(file.name) || !file.size) {
        setSearchHint('Archivo de estado entregas no válido (.xlsx / .xlsm).')
        return
      }
      if (file.size > MAX_ENTREGAS_BYTES) {
        setSearchHint(
          `Excel demasiado grande (${Math.round(file.size / 1024 / 1024)} MiB). Máx. ${Math.round(
            MAX_ENTREGAS_BYTES / 1024 / 1024,
          )} MiB.`,
        )
        return
      }
      setSearchHint('Cargando estado entregas…')
      try {
        const buf = await file.arrayBuffer()
        const stats = loadEntregasFromExcel(
          buf,
          file.name,
          system690,
          vesselId,
        )
        if (stats.unchanged) return
        if (stats.matched === 0 && stats.upserted === 0) {
          setSearchHint(
            `Ningún equipo del Excel coincide con el unifilar (${stats.skippedUnknown} filas leídas). Col. A = equipo, H = instalación SI/NO.`,
          )
        }
      } catch (err) {
        setSearchHint(
          err instanceof Error
            ? err.message
            : 'No se pudo leer el Excel de estado entregas.',
        )
      }
    },
    [vesselId],
  )

  const handleLocate = (e: FormEvent) => {
    e.preventDefault()
    const found = findEquipmentByQuery(searchableEquipment, locateQuery)
    if (!found) {
      setSearchHint(`No se encontró «${locateQuery}» en el unifilar.`)
      setLocateEquipmentId(null)
      return
    }
    setLocateEquipmentId(found.id)
    setFocus(null)
    if (isMobile) setChromeCollapsed(true)
    const dcp =
      found.dcp10Id && found.dcp10Id !== found.id ? ` / ${found.dcp10Id}` : ''
    const nme = found.nme674Id ? ` / NME ${found.nme674Id}` : ''
    setSearchHint(
      `${found.id}${dcp}${nme} · ${found.name} — localizado en el unifilar.`,
    )
  }

  const handleFeedsSearch = (e: FormEvent) => {
    e.preventDefault()
    const found = findEquipmentByQuery(searchableEquipment, feedsQuery)
    if (!found) {
      setSearchHint(`No se encontró «${feedsQuery}» para el árbol.`)
      setFocus(null)
      return
    }
    const trace = getUpstreamTrace(found.id, system690.circuits)
    setLocateEquipmentId(null)
    setFocus({ equipmentId: found.id, trace })
    if (isMobile) setChromeCollapsed(true)
    const dcp =
      found.dcp10Id && found.dcp10Id !== found.id ? ` / ${found.dcp10Id}` : ''
    setSearchHint(
      `${found.id}${dcp} · ${found.name} — árbol con ${trace.circuits.length} alimentaciones aguas arriba.`,
    )
  }

  const closedCount = Object.values(protectionStatus).filter(
    (s) => s === 'cerrada',
  ).length
  const openCount = Object.values(protectionStatus).filter(
    (s) => s === 'abierta',
  ).length

  const collapseAll = () => {
    setFocus(null)
    setLocateEquipmentId(null)
    setSearchHint(null)
    cascadeRef.current?.collapseAll()
  }

  const boardLayerOn = isBoardLayerVisible(energ)
  const entregaLayerOn = isEntregaLayerVisible(entregas)

  const shellClass = [
    'app-shell',
    'app-shell--cascade',
    isMobile ? 'app-shell--mobile' : '',
    isMobile && chromeCollapsed ? 'app-shell--chrome-collapsed' : '',
    boardLayerOn ? 'scada--board-energizations' : '',
    entregaLayerOn ? 'scada--entregas' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={shellClass}>
      {startupMode ? (
        <StartupFeedsPanel
          onClose={() => setStartupMode(false)}
          protectionStatus={protectionStatus}
          lockedCircuits={lockedCircuits}
          energizedCircuitIds={energizedCircuitIds}
          energizedEquipmentIds={energizedEquipmentIds}
        />
      ) : (
        <>
      <div className="app-shell__chrome">
        <header className="topbar">
          <div className="topbar__brand">
            <div className="topbar__brand-lead">
              <NavantiaLogo />
              <details
                ref={appMenuRef}
                className="app-menu"
              >
                <summary
                  className="app-menu__summary"
                  title="Opciones de la aplicación"
                  aria-label="Menú"
                >
                  <span className="app-menu__burger" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                </summary>
                <div className="app-menu__panel" role="menu">
                  <label className="app-menu__field">
                    <span className="app-menu__label">Lista circuitos</span>
                    <select
                      className="app-menu__select"
                      value={topo.listRevision}
                      aria-label="Revisión de lista de circuitos"
                      title="El unifilar y los informes usan la revisión seleccionada"
                      onChange={handleCircuitListRevisionChange}
                    >
                      <option value="C">
                        {circuitListRevisionLabel('C')}
                      </option>
                      <option value="D">
                        {circuitListRevisionLabel('D')}
                      </option>
                    </select>
                  </label>

                  <label className="app-menu__field">
                    <span className="app-menu__label">Buque</span>
                    <select
                      className="app-menu__select"
                      value={vesselId}
                      aria-label="Cambiar buque"
                      onChange={(e) => {
                        switchVessel(e.target.value as VesselId)
                        closeAppMenu()
                      }}
                    >
                      {VESSELS.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="app-menu__divider" role="separator" />

                  <button
                    type="button"
                    role="menuitem"
                    className={`app-menu__item${startupMode ? ' app-menu__item--on' : ''}`}
                    onClick={() => {
                      setStartupMode(true)
                      closeAppMenu()
                      if (isMobile) setChromeCollapsed(true)
                    }}
                  >
                    Puesta en marcha
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={`app-menu__item${notesPanelOpen ? ' app-menu__item--on' : ''}`}
                    onClick={() => {
                      setNotesPanelOpen(true)
                      closeAppMenu()
                      if (isMobile) setChromeCollapsed(true)
                    }}
                  >
                    Notas
                    {openNotesUnresolved > 0 ? (
                      <span className="notes-badge notes-badge--topbar">
                        {openNotesUnresolved}
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="app-menu__item"
                    onClick={() => {
                      requestOpenDeckPlan()
                      closeAppMenu()
                      if (isMobile) setChromeCollapsed(true)
                    }}
                  >
                    Planos
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="app-menu__item"
                    onClick={() => {
                      openProfilePrompt(
                        'Edita el nombre que firmará las notas de revisión.',
                      )
                      closeAppMenu()
                    }}
                    title={
                      displayName
                        ? `Usuario: ${displayName}`
                        : 'Configurar nombre de usuario'
                    }
                  >
                    Usuario
                    {displayName ? ` · ${displayName}` : ''}
                    {isAdmin ? ' · Admin' : ''}
                  </button>

                  <div className="app-menu__divider" role="separator" />

                  <button
                    type="button"
                    role="menuitem"
                    className={`app-menu__item${simulationActive ? ' app-menu__item--on' : ''}`}
                    onClick={() => {
                      handleSimulateToggle()
                      closeAppMenu()
                    }}
                  >
                    {simulationActive ? 'Dejar de simular' : 'Simular estado'}
                  </button>

                  {isAdmin && (
                    <details
                      ref={candadosDetailsRef}
                      className={`app-menu__sub${lockTool !== 'none' ? ' app-menu__sub--active' : ''}`}
                    >
                      <summary className="app-menu__sub-summary">
                        Candados
                        {lockTool !== 'none' ? ' · activo' : ''}
                      </summary>
                      <div className="app-menu__sub-panel">
                        <p
                          className="app-menu__meta"
                          title={locksFileName ?? undefined}
                        >
                          {locksFileName
                            ? `Archivo: ${locksFileName}`
                            : 'Archivo: (ningún Excel cargado)'}
                          {locksUpdatedAt > '1970-01-01T00:00:00.000Z' && (
                            <>
                              <br />
                              Actualizado:{' '}
                              {new Date(locksUpdatedAt).toLocaleString(
                                'es-ES',
                                {
                                  dateStyle: 'short',
                                  timeStyle: 'short',
                                },
                              )}
                            </>
                          )}
                          <br />
                          {lockedCircuits.size} interruptores con candado
                        </p>
                        <button
                          type="button"
                          className={`app-menu__item${lockTool === 'lock' ? ' app-menu__item--on' : ''}`}
                          disabled={!simulationActive}
                          onClick={() => {
                            setLockTool((t) => (t === 'lock' ? 'none' : 'lock'))
                            closeAppMenu()
                          }}
                        >
                          Poner candado
                        </button>
                        <button
                          type="button"
                          className={`app-menu__item${lockTool === 'unlock' ? ' app-menu__item--on' : ''}`}
                          disabled={!simulationActive}
                          onClick={() => {
                            setLockTool((t) =>
                              t === 'unlock' ? 'none' : 'unlock',
                            )
                            closeAppMenu()
                          }}
                        >
                          Quitar candado
                        </button>
                        <button
                          type="button"
                          className="app-menu__item"
                          onClick={() => {
                            fileInputRef.current?.click()
                            closeAppMenu()
                          }}
                        >
                          Cargar Excel…
                        </button>
                      </div>
                    </details>
                  )}

                  {isAdmin && (
                    <details className="app-menu__sub">
                      <summary
                        className={`app-menu__sub-summary${topo.sessionOverride ? ' app-menu__sub-summary--on' : ''}`}
                      >
                        {topologyBusy ? 'Actualizar…' : 'Actualizar Rev.D'}
                      </summary>
                      <div className="app-menu__sub-panel">
                        <button
                          type="button"
                          className="app-menu__item"
                          disabled={
                            topologyBusy || topo.listRevision !== 'D'
                          }
                          onClick={() => {
                            circuitListInputRef.current?.click()
                            closeAppMenu()
                          }}
                        >
                          Cargar Excel Rev.D…
                        </button>
                        <button
                          type="button"
                          className="app-menu__item"
                          disabled={!topo.sessionOverride || topologyBusy}
                          onClick={() => {
                            handleRestoreEmbeddedTopology()
                            closeAppMenu()
                          }}
                        >
                          Restaurar Rev.D embebida
                        </button>
                      </div>
                    </details>
                  )}

                  {isAdmin && (
                    <details className="app-menu__sub">
                      <summary
                        className={`app-menu__sub-summary${boardLayerOn ? ' app-menu__sub-summary--on' : ''}`}
                      >
                        Energizaciones
                      </summary>
                      <div className="app-menu__sub-panel">
                        <button
                          type="button"
                          className={`app-menu__item${boardLayerOn ? ' app-menu__item--on' : ''}`}
                          disabled={!energ.hasData}
                          onClick={() => {
                            setBoardEnergizationsEnabled(!energ.enabled)
                            closeAppMenu()
                          }}
                        >
                          {boardLayerOn ? 'Desactivar capa' : 'Activar capa'}
                        </button>
                        <button
                          type="button"
                          className="app-menu__item"
                          onClick={() => {
                            energizationInputRef.current?.click()
                            closeAppMenu()
                          }}
                        >
                          Cargar Excel…
                        </button>
                        <button
                          type="button"
                          className="app-menu__item"
                          disabled={!energ.hasData}
                          onClick={() => {
                            clearEnergizations()
                            setSearchHint('Energizaciones borradas.')
                            closeAppMenu()
                          }}
                        >
                          Borrar datos
                        </button>
                      </div>
                    </details>
                  )}

                  {isAdmin && (
                    <details className="app-menu__sub">
                      <summary
                        className={`app-menu__sub-summary${entregaLayerOn ? ' app-menu__sub-summary--on' : ''}`}
                        title="Col. A equipo · H instalación SI/NO · col. Entregado (opcional) SI/NO. Cada Excel se acumula."
                      >
                        Estado entregas
                      </summary>
                      <div className="app-menu__sub-panel">
                        <button
                          type="button"
                          className={`app-menu__item${entregaLayerOn ? ' app-menu__item--on' : ''}`}
                          disabled={!entregas.hasData}
                          onClick={() => {
                            setEntregasEnabled(!entregas.enabled)
                            closeAppMenu()
                          }}
                        >
                          {entregaLayerOn ? 'Desactivar capa' : 'Activar capa'}
                        </button>
                        <button
                          type="button"
                          className="app-menu__item"
                          title="Suma equipos al listado ya verificado (no sustituye)"
                          onClick={() => {
                            entregasInputRef.current?.click()
                            closeAppMenu()
                          }}
                        >
                          Cargar Excel…
                        </button>
                        <button
                          type="button"
                          className="app-menu__item"
                          disabled={!entregas.hasData}
                          onClick={() => {
                            clearEntregas()
                            setSearchHint('Estado entregas borrado.')
                            closeAppMenu()
                          }}
                        >
                          Borrar datos
                        </button>
                      </div>
                    </details>
                  )}

                  <div className="app-menu__divider" role="separator" />

                  <button
                    type="button"
                    role="menuitem"
                    className="app-menu__item"
                    onClick={() => {
                      collapseAll()
                      closeAppMenu()
                    }}
                  >
                    Plegar todo
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="app-menu__item"
                    onClick={() => {
                      closeAppMenu()
                      void signOutUser()
                    }}
                  >
                    Salir
                  </button>
                </div>
              </details>
            </div>
            <div className="topbar__brand-meta">
              <p className="topbar__brand-title">
                {vesselById(vesselId).label}
              </p>
              <p className="topbar__brand-sub">
                {circuitListRevisionLabel(topo.listRevision)}
                {topo.sessionOverride ? ' · sesión' : ''}
                {energ.hasData
                  ? energ.enabled
                    ? ' · energizaciones on'
                    : ' · energizaciones (capa off)'
                  : ''}
                {entregas.hasData
                  ? entregas.enabled
                    ? ' · entregas on'
                    : ' · entregas (capa off)'
                  : ''}
              </p>
            </div>
          </div>

          {isMobile && !chromeCollapsed && (
            <button
              type="button"
              className="btn topbar__chrome-toggle"
              aria-expanded={true}
              onClick={() => setChromeCollapsed(true)}
              title="Ocultar barra y trabajar a pantalla completa"
            >
              Ocultar ▴
            </button>
          )}

          <div className="topbar__main">
            <div className="topbar__row topbar__row--tools">

              {isAdmin && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    hidden
                    onChange={handleLockExcelChange}
                  />
                  <input
                    ref={circuitListInputRef}
                    type="file"
                    accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    hidden
                    onChange={(e) => void handleCircuitListExcelChange(e)}
                  />
                  <input
                    ref={energizationInputRef}
                    type="file"
                    accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    hidden
                    onChange={(e) => void handleEnergizationExcelChange(e)}
                  />
                  <input
                    ref={entregasInputRef}
                    type="file"
                    accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    hidden
                    onChange={(e) => void handleEntregasExcelChange(e)}
                  />
                </>
              )}

              <div className="zoom-controls" role="group" aria-label="Zoom">
                <button
                  type="button"
                  className="btn btn--zoom"
                  onClick={zoomOut}
                  title="Alejar"
                >
                  −
                </button>
                <button
                  type="button"
                  className="btn btn--zoom btn--zoom-label"
                  onClick={zoomReset}
                  title="Ajustar a vista / 100%"
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  type="button"
                  className="btn btn--zoom"
                  onClick={zoomIn}
                  title="Acercar"
                >
                  +
                </button>
              </div>
              <div className="topbar__legend" aria-label="Leyenda de tensiones">
                <span className="toggle">
                  <span className="legend-line legend-line--v690" />
                  690 V
                </span>
                <span className="toggle">
                  <span className="legend-line legend-line--v440" />
                  440 V
                </span>
                <span className="toggle">
                  <span className="legend-line legend-line--v230" />
                  230 V
                </span>
                <span className="toggle">
                  <span className="legend-line legend-line--v115" />
                  115 V
                </span>
                <span className="toggle">
                  <span className="legend-line legend-line--v24" />
                  24 V
                </span>
                <span className="toggle">
                  <span className="legend-line legend-line--v400hz" />
                  400 Hz
                </span>
                <span className="toggle">
                  <span className="legend-line legend-line--alum" />
                  Alumbrado
                </span>
              </div>
            </div>

            <div className="topbar__row topbar__row--search">
              <form className="search search--locate" onSubmit={handleLocate}>
                <span
                  className="search__label"
                  title="Busca y centra el equipo en el unifilar (PUMA o DCP-10)"
                >
                  Localizar
                </span>
                <label className="search__field">
                  <span className="sr-only">Localizar equipo en unifilar</span>
                  <input
                    type="search"
                    placeholder="PUMA o DCP-10 (ej. LCS-4PWS0003)…"
                    value={locateQuery}
                    onChange={(e) => {
                      setLocateQuery(e.target.value)
                      setSearchHint(null)
                    }}
                    list="equipment-suggestions-locate"
                    enterKeyHint="search"
                  />
                </label>
                <datalist id="equipment-suggestions-locate">
                  {searchableEquipment.map((eq) => (
                    <option key={`puma-${eq.id}`} value={eq.id}>
                      {eq.dcp10Id && eq.dcp10Id !== eq.id
                        ? `PUMA · ${eq.name}`
                        : eq.name}
                    </option>
                  ))}
                  {searchableEquipment.map((eq) =>
                    eq.dcp10Id && eq.dcp10Id !== eq.id ? (
                      <option key={`dcp-${eq.id}`} value={eq.dcp10Id}>
                        {`DCP-10 · ${eq.id} · ${eq.name}`}
                      </option>
                    ) : null,
                  )}
                </datalist>
                <button type="submit" className="btn btn--primary">
                  Ir
                </button>
                {locateEquipmentId && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      cascadeRef.current?.goBack()
                      setLocateQuery('')
                      setSearchHint(null)
                    }}
                  >
                    Volver
                  </button>
                )}
              </form>

              <form
                className="search search--feeds"
                onSubmit={handleFeedsSearch}
              >
                <span
                  className="search__label"
                  title="Árbol de alimentaciones (busca por PUMA o DCP-10)"
                >
                  Árbol
                </span>
                <label className="search__field">
                  <span className="sr-only">Árbol de alimentaciones</span>
                  <input
                    type="search"
                    placeholder="Árbol: PUMA o DCP-10…"
                    value={feedsQuery}
                    onChange={(e) => {
                      setFeedsQuery(e.target.value)
                      setSearchHint(null)
                    }}
                    list="equipment-suggestions-feeds"
                    enterKeyHint="search"
                  />
                </label>
                <datalist id="equipment-suggestions-feeds">
                  {searchableEquipment.map((eq) => (
                    <option key={`feeds-puma-${eq.id}`} value={eq.id}>
                      {eq.dcp10Id && eq.dcp10Id !== eq.id
                        ? `PUMA · ${eq.name}`
                        : eq.name}
                    </option>
                  ))}
                  {searchableEquipment.map((eq) =>
                    eq.dcp10Id && eq.dcp10Id !== eq.id ? (
                      <option key={`feeds-dcp-${eq.id}`} value={eq.dcp10Id}>
                        {`DCP-10 · ${eq.id} · ${eq.name}`}
                      </option>
                    ) : null,
                  )}
                </datalist>
                <button type="submit" className="btn btn--feeds">
                  Ver árbol
                </button>
                {focus && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setFocus(null)
                      setFeedsQuery('')
                      setSearchHint(null)
                    }}
                  >
                    Limpiar
                  </button>
                )}
              </form>
            </div>
          </div>
        </header>

        {searchHint && <div className="banner">{searchHint}</div>}
        {lockTool !== 'none' && (
          <div className="banner banner--tool">
            {lockTool === 'lock'
              ? 'Modo poner candado activo: pulsa un interruptor para abrirlo y bloquearlo.'
              : 'Modo quitar candado activo: pulsa un interruptor bloqueado para liberarlo.'}
          </div>
        )}
        {isMobile &&
          lockTool === 'none' &&
          !searchHint &&
          !simulationActive &&
          !chromeCollapsed && (
          <div className="banner">
            Localizar / Ver árbol · Puesta en marcha · Simular / Candados.
            Doble toque para plegar/desplegar · mantén pulsado para info.
            Arrastra o pellizca para zoom y para ocultar el menú.
          </div>
        )}
        {!isMobile && lockTool === 'none' && !searchHint && !simulationActive && (
          <div className="banner">
            Pulsa «Simular estado» para poder abrir o cerrar interruptores y
            arrancar generadores. Doble clic en cuadros o equipos para
            plegar/desplegar.
          </div>
        )}
        {lockTool === 'none' && !searchHint && simulationActive && (
          <div className="banner">
            {runningGenerators.size === 0
              ? 'Simulación activa: pulsa un generador (G) para arrancarlo (ON), cierra su QG* y luego los interruptores de salida / QBT para ver el flujo de energía.'
              : `Simulación activa: ${runningGenerators.size} generador${runningGenerators.size === 1 ? '' : 'es'} en marcha. Cierra QG* / salidas / QBT para ver el flujo.`}
          </div>
        )}
      </div>

      <main className="workspace workspace--cascade">
        <LockInfoProvider
          byCircuitId={lockInfoByCircuit}
          onLockInfo={showLockInfo}
        >
          <CascadeView
            ref={cascadeRef}
            protectionStatus={protectionStatus}
            energizedCircuitIds={energizedCircuitIds}
            energizedEquipmentIds={energizedEquipmentIds}
            energizedBusHalves={energizedBusHalves}
            runningGenerators={runningGenerators}
            lockedCircuits={lockedCircuits}
            lockTool={lockTool}
            zoom={zoom}
            onZoomChange={setZoom}
            focus={focus}
            locateEquipmentId={locateEquipmentId}
            chromeCollapsed={isMobile && chromeCollapsed}
            onCanvasInteract={hideChromeForCanvas}
            onToggleProtection={handleToggleProtection}
            onLockCircuit={handleLockCircuit}
            onUnlockCircuit={handleUnlockCircuit}
            onToggleGenerator={toggleGenerator}
            onClearFocus={() => {
              setFocus(null)
              setSearchHint(null)
            }}
            onClearLocate={() => {
              setLocateEquipmentId(null)
              setSearchHint(null)
            }}
          />
        </LockInfoProvider>
      </main>

      {lockBalloon && (
        <LockBalloon
          info={lockBalloon.info}
          protectionName={lockBalloon.protectionName}
          x={lockBalloon.x}
          y={lockBalloon.y}
          onClose={() => setLockBalloon(null)}
        />
      )}

      <NotesPanel
        open={notesPanelOpen}
        onClose={() => setNotesPanelOpen(false)}
      />
      <NoteEditorModal />
      <DeckPlanHost />

      <footer className="statusbar">
        <span>
          Cascada 690 V · protecciones:{' '}
          <span className="swatch swatch--cerrada" /> {closedCount} cerradas ·{' '}
          <span className="swatch swatch--abierta" /> {openCount} abiertas ·
          gens: {runningGenerators.size} en marcha · candados:{' '}
          {lockedCircuits.size} · flujo: {energizedCircuitIds.size} circ. · zoom{' '}
          {Math.round(zoom * 100)}% · {statusSource}
        </span>
      </footer>
      {isMobile && chromeCollapsed && (
        <button
          type="button"
          className="chrome-fab"
          onClick={showChromeMenu}
          title="Mostrar menú y herramientas"
          aria-label="Mostrar menú"
        >
          Menú
        </button>
      )}
        </>
      )}
    </div>
  )
}
