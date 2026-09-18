import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import { displaySourceFileName, system690 } from '../data/system690'
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
  resolveLockCircuitIds,
  resolveLockEntries,
  type CircuitLockInfo,
} from '../utils/parseLocksExcel'
import {
  defaultLocksForVessel,
  loadVesselLocks,
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
import { NotesPanel } from './NotesPanel'
import { useNotes } from '../notes/NotesContext'
import { useUserProfile } from '../notes/UserProfileContext'
import { useAuth } from '../auth'
import {
  clearTopologyNotice,
  loadTopologyFromExcel,
  resetTopologyToEmbedded,
  useTopologyState,
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

const ZOOM_MIN = 0.25
const ZOOM_MAX = 2.5
const ZOOM_STEP = 0.15
const MAX_LOCK_EXCEL_BYTES = 8 * 1024 * 1024
const MAX_CIRCUIT_LIST_BYTES = 32 * 1024 * 1024
const MAX_ENERGIZATION_BYTES = 16 * 1024 * 1024
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
  const candadosDetailsRef = useRef<HTMLDetailsElement>(null)
  const cascadeRef = useRef<CascadeViewHandle>(null)
  const isMobile = useIsMobileUi()
  const { notes } = useNotes()
  const { displayName, openProfilePrompt } = useUserProfile()
  const { signOutUser, isAdmin } = useAuth()
  const topo = useTopologyState()
  const energ = useEnergizationOverlay()

  useEffect(() => {
    setEnergizationsVessel(vesselId, system690)
  }, [vesselId])

  const [notesPanelOpen, setNotesPanelOpen] = useState(false)
  const [chromeCollapsed, setChromeCollapsed] = useState(false)
  const [topologyBusy, setTopologyBusy] = useState(false)
  const [protectionStatus, setProtectionStatus] = useState<ProtectionStatusMap>(
    () => {
      const locks = loadVesselLocks(vesselId)
      return withLocksOpen(
        toProtectionStatusMap(buildOpenProtectionStatus(system690)),
        locks.lockedCircuits,
      )
    },
  )
  const [lockedCircuits, setLockedCircuits] = useState<Set<string>>(() => {
    const locks = loadVesselLocks(vesselId)
    return new Set(locks.lockedCircuits)
  })
  const [lockInfoByCircuit, setLockInfoByCircuit] = useState<
    Record<string, CircuitLockInfo>
  >(() => ({ ...loadVesselLocks(vesselId).lockInfoByCircuit }))
  const [locksFileName, setLocksFileName] = useState<string | null>(
    () => loadVesselLocks(vesselId).fileName,
  )
  const [locksUpdatedAt, setLocksUpdatedAt] = useState(
    () => loadVesselLocks(vesselId).updatedAt,
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
      applyingLocksRemoteRef.current = true
      locksUpdatedAtRef.current = remote.updatedAt
      setLocksUpdatedAt(remote.updatedAt)
      setLockedCircuits(new Set(remote.lockedCircuits))
      setLockInfoByCircuit({ ...remote.lockInfoByCircuit })
      setLocksFileName(remote.fileName ?? null)
      setProtectionStatus((prev) =>
        applyLocksToProtectionStatus(prev, remote.lockedCircuits),
      )
      saveVesselLocks(vesselId, {
        lockedCircuits: remote.lockedCircuits,
        lockInfoByCircuit: remote.lockInfoByCircuit,
        updatedAt: remote.updatedAt,
        fileName: remote.fileName ?? null,
      })
      setStatusSource(
        locksStatusLine(vesselId, remote.lockedCircuits.length) +
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

  const bumpPublishLocks = useCallback((fileName?: string | null) => {
    if (fileName !== undefined) {
      setLocksFileName(fileName)
      locksFileNameRef.current = fileName
    }
    locksUpdatedAtRef.current = new Date().toISOString()
    setLocksUpdatedAt(locksUpdatedAtRef.current)
    window.setTimeout(() => {
      saveVesselLocks(vesselId, {
        lockedCircuits: lockedCircuitsRef.current,
        lockInfoByCircuit: lockInfoRef.current,
        updatedAt: locksUpdatedAtRef.current,
        fileName: locksFileNameRef.current,
      })
      publishLocks({
        updatedAt: locksUpdatedAtRef.current,
        lockedCircuits: [...lockedCircuitsRef.current],
        lockInfoByCircuit: lockInfoRef.current,
        fileName: locksFileNameRef.current,
        source: fileName ? 'excel' : 'local',
      })
    }, 0)
  }, [publishLocks, vesselId])

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
    const n = loadVesselLocks(vesselId).lockedCircuits.length
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
    if (!energ.hasData) return
    refreshEnergizationsForTopology(system690)
  }, [topo.revision, energ.hasData])

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
      const loaded = loadVesselLocks(next)
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
    const defaults = defaultLocksForVessel(vesselId)
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
    setLockedCircuits((prev) => new Set(prev).add(circuitId))
    setProtectionStatus((prev) => ({ ...prev, [circuitId]: 'abierta' }))
    setStatusSource('candado aplicado · interruptor abierto y bloqueado')
    bumpPublishLocks()
  }, [simulationActive, bumpPublishLocks])

  const handleUnlockCircuit = useCallback((circuitId: string) => {
    if (!simulationActive) {
      setSearchHint(
        'Pulsa «Simular estado» para operar interruptores (candados incluidos).',
      )
      return
    }
    setLockedCircuits((prev) => {
      const next = new Set(prev)
      next.delete(circuitId)
      return next
    })
    setLockInfoByCircuit((prev) => {
      if (!(circuitId in prev)) return prev
      const next = { ...prev }
      delete next[circuitId]
      return next
    })
    setLockBalloon(null)
    setStatusSource('candado retirado · interruptor manipulable')
    bumpPublishLocks()
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
          bumpPublishLocks(file.name)
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
        setLockInfoByCircuit((prev) => {
          const next = { ...prev }
          for (const id of circuitIds) {
            if (!next[id]) {
              next[id] = {
                lockNumber: '—',
                interruptor: id,
              }
            }
          }
          return next
        })
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
        bumpPublishLocks(file.name)
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
  }, [])

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

  const shellClass = [
    'app-shell',
    'app-shell--cascade',
    isMobile ? 'app-shell--mobile' : '',
    isMobile && chromeCollapsed ? 'app-shell--chrome-collapsed' : '',
    boardLayerOn ? 'scada--board-energizations' : '',
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
            <NavantiaLogo />
            <div className="topbar__brand-meta">
              <p className="topbar__brand-title">
                {vesselById(vesselId).label}
              </p>
              <p>
                {system690.sourceFile
                  ? displaySourceFileName(system690.sourceFile)
                  : system690.vessel}
                {topo.sessionOverride ? ' · sesión (no guardada)' : ''}
                {energ.hasData
                  ? energ.enabled
                    ? ` · energizaciones activas (${vesselId})`
                    : ` · energizaciones memorizadas (${vesselId}, capa off)`
                  : ''}
              </p>
              <label className="topbar__vessel">
                <span className="topbar__vessel-label">Buque</span>
                <select
                  className="topbar__vessel-select"
                  value={vesselId}
                  aria-label="Cambiar buque"
                  onChange={(e) =>
                    switchVessel(e.target.value as VesselId)
                  }
                >
                  {VESSELS.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
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
              <div
                className="topbar__console"
                role="group"
                aria-label="Herramientas"
              >
                <div
                  className="topbar__actions topbar__actions--view"
                  role="group"
                  aria-label="Vista"
                >
                  <button
                    type="button"
                    className="btn"
                    onClick={collapseAll}
                    title="Plegar todos los cuadros y equipos del unifilar"
                  >
                    Plegar todo
                  </button>
                  <button
                    type="button"
                    className={`btn${startupMode ? ' btn--active' : ''}`}
                    onClick={() => {
                      setStartupMode(true)
                      if (isMobile) setChromeCollapsed(true)
                    }}
                    title="Informe de alimentaciones para puesta en marcha de sistemas"
                  >
                    Puesta en marcha
                  </button>
                  <button
                    type="button"
                    className={`btn${notesPanelOpen ? ' btn--active' : ''}`}
                    onClick={() => {
                      setNotesPanelOpen(true)
                      if (isMobile) setChromeCollapsed(true)
                    }}
                    title="Notas de revisión del buque (se sincronizan con red)"
                  >
                    Notas
                    {notes.reduce(
                      (sum, n) => sum + n.lines.filter((l) => !l.resolved).length,
                      0,
                    ) > 0 ? (
                      <span className="notes-badge notes-badge--topbar">
                        {notes.reduce(
                          (sum, n) =>
                            sum + n.lines.filter((l) => !l.resolved).length,
                          0,
                        )}
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      openProfilePrompt(
                        'Edita el nombre que firmará las notas de revisión.',
                      )
                    }
                    title={
                      displayName
                        ? `Usuario: ${displayName}`
                        : 'Configurar nombre de usuario'
                    }
                  >
                    Usuario
                    {isAdmin ? ' · Admin' : ''}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void signOutUser()}
                    title="Cerrar sesión"
                  >
                    Salir
                  </button>
                </div>
                <div
                  className="topbar__actions topbar__actions--sim"
                  role="group"
                  aria-label="Simulación"
                >
                    <button
                      type="button"
                      className={`btn${simulationActive ? ' btn--active' : ''}`}
                      onClick={handleSimulateToggle}
                      title={
                        simulationActive
                          ? 'Desactivar simulación (interruptores no operables)'
                          : 'Activar simulación para operar interruptores y generadores'
                      }
                    >
                      {simulationActive ? 'Dejar de simular' : 'Simular estado'}
                    </button>
                    {isAdmin && (
                    <>
                    <details
                      ref={candadosDetailsRef}
                      className={`candados-menu${lockTool !== 'none' ? ' candados-menu--active' : ''}`}
                    >
                      <summary
                        className={`btn btn--lock${lockTool !== 'none' ? ' btn--active' : ''}`}
                        title="Poner / quitar candado o cargar lista desde Excel (solo admin)"
                      >
                        Candados
                      </summary>
                      <div className="candados-menu__panel" role="menu">
                        <p className="candados-menu__meta" title={locksFileName ?? undefined}>
                          {locksFileName
                            ? `Archivo: ${locksFileName}`
                            : 'Archivo: (ningún Excel cargado)'}
                          {locksUpdatedAt > '1970-01-01T00:00:00.000Z' && (
                            <>
                              <br />
                              <span className="candados-menu__meta-time">
                                Actualizado:{' '}
                                {new Date(locksUpdatedAt).toLocaleString(
                                  'es-ES',
                                  {
                                    dateStyle: 'short',
                                    timeStyle: 'short',
                                  },
                                )}
                              </span>
                            </>
                          )}
                          <br />
                          <span className="candados-menu__meta-count">
                            {lockedCircuits.size} interruptores con candado
                          </span>
                        </p>
                        <button
                          type="button"
                          role="menuitem"
                          className={`candados-menu__item${lockTool === 'lock' ? ' candados-menu__item--on' : ''}`}
                          disabled={!simulationActive}
                          title={
                            simulationActive
                              ? 'Modo: pulsa un interruptor para abrirlo y bloquearlo'
                              : 'Activa «Simular estado» primero'
                          }
                          onClick={() => {
                            setLockTool((t) => (t === 'lock' ? 'none' : 'lock'))
                            closeCandadosMenu()
                          }}
                        >
                          Poner candado
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className={`candados-menu__item${lockTool === 'unlock' ? ' candados-menu__item--on' : ''}`}
                          disabled={!simulationActive}
                          title={
                            simulationActive
                              ? 'Modo: pulsa un interruptor bloqueado para liberarlo'
                              : 'Activa «Simular estado» primero'
                          }
                          onClick={() => {
                            setLockTool((t) =>
                              t === 'unlock' ? 'none' : 'unlock',
                            )
                            closeCandadosMenu()
                          }}
                        >
                          Quitar candado
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="candados-menu__item"
                          title="Excel LOTO: col. D interruptor, L nº candado; CCM cruza D con N (p. ej. 41Q1)"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          Cargar Excel…
                        </button>
                      </div>
                    </details>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                      hidden
                      onChange={handleLockExcelChange}
                    />
                    </>
                    )}
                    {isAdmin && (
                    <>
                    <details className="candados-menu">
                      <summary
                        className={`btn${topo.sessionOverride ? ' btn--active' : ''}`}
                        title="Cargar una nueva lista de circuitos en el unifilar (solo esta sesión; no se guarda) — solo admin"
                      >
                        {topologyBusy ? 'Cargando…' : 'Lista circuitos'}
                      </summary>
                      <div className="candados-menu__panel" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          className="candados-menu__item"
                          disabled={topologyBusy}
                          title="Excel lista de circuitos (mismas columnas que el unifilar). Solo memoria de sesión."
                          onClick={() => circuitListInputRef.current?.click()}
                        >
                          Cargar Excel…
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="candados-menu__item"
                          disabled={!topo.sessionOverride || topologyBusy}
                          title="Volver a la topología embebida en la app"
                          onClick={handleRestoreEmbeddedTopology}
                        >
                          Restaurar embebida
                        </button>
                      </div>
                    </details>
                    <input
                      ref={circuitListInputRef}
                      type="file"
                      accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                      hidden
                      onChange={(e) => void handleCircuitListExcelChange(e)}
                    />
                    </>
                    )}
                    {isAdmin && (
                    <>
                    <details className="candados-menu">
                      <summary
                        className={`btn${boardLayerOn ? ' btn--active' : ''}`}
                        title={`Capa de energizaciones de ${vesselId} (Excel col. A código, E SI/NO) — solo admin`}
                      >
                        Energizaciones
                      </summary>
                      <div className="candados-menu__panel" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          className={`candados-menu__item${boardLayerOn ? ' candados-menu__item--on' : ''}`}
                          disabled={!energ.hasData}
                          title={
                            energ.hasData
                              ? boardLayerOn
                                ? 'Ocultar capa (datos memorizados)'
                                : 'Mostrar capa sobre el unifilar'
                              : 'Carga un Excel primero'
                          }
                          onClick={() =>
                            setBoardEnergizationsEnabled(!energ.enabled)
                          }
                        >
                          {boardLayerOn ? 'Desactivar capa' : 'Activar capa'}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="candados-menu__item"
                          title="ControlSeguimientoEnergizaciones: A código cable, B origen, C destino, E SI/NO"
                          onClick={() => energizationInputRef.current?.click()}
                        >
                          Cargar Excel…
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="candados-menu__item"
                          disabled={!energ.hasData}
                          title="Borrar Excel memorizado y quitar la capa"
                          onClick={() => {
                            clearEnergizations()
                            setSearchHint('Energizaciones borradas.')
                          }}
                        >
                          Borrar datos
                        </button>
                      </div>
                    </details>
                    <input
                      ref={energizationInputRef}
                      type="file"
                      accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                      hidden
                      onChange={(e) => void handleEnergizationExcelChange(e)}
                    />
                    </>
                    )}
                </div>
              </div>
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
