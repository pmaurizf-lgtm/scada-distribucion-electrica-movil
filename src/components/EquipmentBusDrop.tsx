import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { system690 } from '../data/system690'
import type { Circuit, Equipment, ProtectionState } from '../types'
import {
  aux24FeedsForEquipment,
  foldedLcsQvsLegs,
  incomingFeeds,
  isAux24Feed,
  isParallelLcsTopFeed,
  isPendingFeed,
  isTrfInternalConversionFeed,
  lineBadge,
  pairedRemoteFeeds,
} from '../utils/cascadeModel'
import { isSpareEquipment } from '../utils/spareCircuits'
import { labelSecondaryDenom } from '../utils/equipmentLabels'
import { useEquipInfoBalloon } from '../hooks/useEquipInfoBalloon'
import {
  dataFlowVoltageForBoardFeed,
  dataFlowVoltageForConversionLink,
  dataFlowVoltageFromCircuit,
  dataFlowVoltageProps,
  dataFlowVoltageAlum,
  isLightingBoard,
  isLightingBoardId,
} from '../utils/flowVoltage'
import { Aux24Incoming } from './Aux24Incoming'
import { BreakerChip } from './BreakerChip'
import {
  JbxUnifilarSymbol,
  SktUnifilarSymbol,
} from './BreakerSymbols'
import { EquipmentBalloon } from './EquipmentBalloon'
import { isSsb2Pws2209 } from '../abtDownstream/ssb2pws2209'
import { isOutletSideOriginLive } from '../abtDownstream/ssbBoard'
import {
  eqBoardClass,
  legBoardClass,
  useEnergizationOverlay,
} from '../energizations'

export type EquipFam = 'abt' | 'trf' | 'lcs' | 'sec' | 'eq'

/** Símbolo unifilar del chip; JBX/SKT según plano Navantia (no «M» genérica). */
export function symbolFor(
  kind: Equipment['kind'],
  equipment?: Pick<Equipment, 'id' | 'name'>,
): ReactNode {
  const id = equipment?.id ?? ''
  if (/^JBX-/i.test(id)) return <JbxUnifilarSymbol />
  if (/^SKT-/i.test(id)) {
    const crossed = /IP\s*56/i.test(equipment?.name ?? '')
    return <SktUnifilarSymbol crossed={crossed} />
  }
  switch (kind) {
    case 'generador':
      return 'G'
    case 'conversion':
      return 'T'
    case 'cuadro_principal':
      return '▣'
    case 'cuadro_secundario':
      return '▦'
    default:
      return 'M'
  }
}

export function equipFamOf(equipment: Equipment, isLcs?: boolean): EquipFam {
  if (equipment.id.startsWith('ABT-')) return 'abt'
  if (equipment.id.startsWith('TRF-')) return 'trf'
  if (isLcs || equipment.id.startsWith('LCS-')) return 'lcs'
  if (equipment.id.startsWith('CSB-')) return 'sec'
  if (equipment.kind === 'cuadro_secundario') return 'sec'
  if (equipment.kind === 'conversion') return 'trf'
  return 'eq'
}

/** LCS plegado: CSB + QS* (misma idea que ParallelFeedLeg con LCS abierto). */
function FoldedParallelCsbLeg({
  feed,
  protectionStatus,
  energizedCircuitIds,
  energizedEquipmentIds,
  lockedCircuits,
  onLocalBreaker,
  onHoverInfo,
  onHoverInfoEnd,
}: {
  feed: Circuit
  protectionStatus: Record<string, ProtectionState>
  energizedCircuitIds: Set<string>
  energizedEquipmentIds: Set<string>
  lockedCircuits: Set<string>
  onLocalBreaker: (c: Circuit, e: ReactMouseEvent) => void
  onHoverInfo?: (circuit: Circuit, rect: DOMRect) => void
  onHoverInfoEnd?: () => void
}) {
  const origin = system690.equipment.find((e) => e.id === feed.originId)
  const flowing = energizedCircuitIds.has(feed.id)
  const eqLive = isOutletSideOriginLive(
    feed.originId,
    energizedEquipmentIds,
    system690.equipment,
  )
  const breakerOpen = protectionStatus[feed.id] !== 'cerrada'
  const isAlt = feed.lineType === 'alternativa'
  const eqWrapRef = useRef<HTMLDivElement>(null)
  const [eqHover, setEqHover] = useState(false)
  const [showEqBalloon, setShowEqBalloon] = useState(false)
  const stickyEq = useRef(false)

  useEffect(() => {
    if (stickyEq.current) return
    if (!eqHover) {
      setShowEqBalloon(false)
      return
    }
    const t = window.setTimeout(() => {
      stickyEq.current = true
      setShowEqBalloon(true)
    }, 1800)
    return () => window.clearTimeout(t)
  }, [eqHover])

  useEffect(() => {
    if (!showEqBalloon) return
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target
      if (!(t instanceof Element)) return
      if (t.closest('.equip-balloon--portal')) return
      if (t.closest('.notes-modal-backdrop') || t.closest('.notes-modal')) return
      if (eqWrapRef.current?.contains(t)) return
      stickyEq.current = false
      setShowEqBalloon(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stickyEq.current = false
        setShowEqBalloon(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [showEqBalloon])

  if (!origin) return null

  const fam = equipFamOf(origin)
  const secondary = labelSecondaryDenom(origin)

  return (
    <div
      className={`hbus-drop__leg hbus-drop__leg--parallel-csb${isAlt ? ' hbus-drop__leg--alt' : ' hbus-drop__leg--norm'}${flowing ? ' hbus-drop__leg--flow' : ''}${breakerOpen && !flowing ? ' hbus-drop__leg--open' : ''}${eqLive && !flowing ? ' hbus-drop__leg--from-live' : ''}`}
      {...dataFlowVoltageFromCircuit(feed)}
      data-circuit-id={feed.id}
      data-equip={origin.id}
    >
      <div
        ref={eqWrapRef}
        className={`hbus-drop__csb-src hbus-drop__eq--fam-${fam}${eqLive ? ' hbus-drop__csb-src--live' : ''}${flowing ? ' hbus-drop__csb-src--flow' : ''}`}
        data-equip={origin.id}
        onMouseEnter={() => setEqHover(true)}
        onMouseLeave={() => setEqHover(false)}
      >
        <span className="hbus-drop__sym">{symbolFor(origin.kind, origin)}</span>
        <span className="hbus-drop__id">{origin.id}</span>
        {secondary && (
          <span className="hbus-drop__dcp" title={secondary.title}>
            {secondary.value}
          </span>
        )}
        <span className="hbus-drop__name">{origin.name}</span>
        {showEqBalloon && (
          <EquipmentBalloon
            equipment={origin}
            circuits={[feed]}
            anchorRef={eqWrapRef}
          />
        )}
      </div>
      <span
        className="hbus-drop__wire hbus-drop__wire--csb-drop"
        aria-hidden
      />
      <BreakerChip
        name={feed.protectionName}
        state={protectionStatus[feed.id]}
        compact
        circuitId={feed.id}
        circuit={feed}
        flowing={flowing}
        locked={lockedCircuits.has(feed.id)}
        title={`${feed.protectionName} · entrada ${origin.id} → ${feed.destinationId}`}
        onHoverInfo={onHoverInfo}
        onHoverInfoEnd={onHoverInfoEnd}
        onClick={(e) => {
          e.stopPropagation()
          onLocalBreaker(feed, e)
        }}
      />
      <span
        className={`hbus-drop__wire hbus-drop__wire--to-eq${flowing ? ' hbus-drop__wire--flow' : ''}`}
        aria-hidden
      />
    </div>
  )
}

export interface EquipmentBusDropProps {
  circuit: Circuit
  equipment: Equipment
  protectionStatus: Record<string, ProtectionState>
  energizedCircuitIds: Set<string>
  energizedEquipmentIds: Set<string>
  lockedCircuits: Set<string>
  onLocalBreaker: (c: Circuit, e: ReactMouseEvent) => void
  onJumpToCircuit?: (c: Circuit) => void
  onHoverInfo?: (circuit: Circuit, rect: DOMRect) => void
  onHoverInfoEnd?: () => void
  canExpand?: boolean
  expanded?: boolean
  /** Texto del chevron (p. ej. `1 ▾`, `▾ LCS`). */
  expandLabel?: string
  onToggleExpand?: () => void
  equipFam?: EquipFam
  bankNote?: string
  /** Clases extra en el contenedor `.hbus-drop`. */
  rootClassName?: string
  /** Cartel de conversión de tensión (p. ej. 690→400 Hz en SCV). */
  conversionNote?: string
  /** Flujo en bajantes TRF→LCS dual (230 / 440). */
  trfStubFlow?: { v230?: boolean; v440?: boolean }
  /**
   * Sin interruptor de acometida: solo cable vertical desde el padre
   * (p. ej. ABT → TRF en cadena directa).
   */
  linkOnlyFromParent?: boolean
  /** Equipo localizado por el buscador del unifilar (halo). */
  located?: boolean
  /**
   * Si se indica, sustituye el «from-live» de la pierna local (p. ej. barra
   * VS/VM/NV del LCS viva, no el LCS entero energizado por otro QVS).
   */
  outletFromLive?: boolean
  children?: ReactNode
}

/**
 * Bajante unifilar compartido MSB / LCS:
 * piernas NORM/ALT + BreakerChip + tarjeta (símbolo, PUMA, DCP-10, nombre).
 */
export function EquipmentBusDrop({
  circuit,
  equipment,
  protectionStatus,
  energizedCircuitIds,
  energizedEquipmentIds,
  lockedCircuits,
  onLocalBreaker,
  onJumpToCircuit,
  onHoverInfo,
  onHoverInfoEnd,
  canExpand = false,
  expanded = false,
  expandLabel,
  onToggleExpand,
  equipFam = 'eq',
  bankNote,
  rootClassName,
  conversionNote,
  trfStubFlow,
  linkOnlyFromParent = false,
  located = false,
  outletFromLive,
  children,
}: EquipmentBusDropProps) {
  const spare = isSpareEquipment(equipment) || !!circuit.spare
  const feeds = useMemo(() => {
    const all = spare ? [circuit] : incomingFeeds(system690, equipment.id)
    // AUX 24 V se muestra aparte (LCS/MSB/CCM); no cuenta como pierna NORM/ALT
    if (isAux24Feed(circuit)) return [circuit]
    return all.filter((c) => !isAux24Feed(c))
  }, [spare, circuit, equipment.id])
  const localFeed = feeds.find((c) => c.id === circuit.id) ?? circuit
  const aux24Feeds = useMemo(
    () =>
      isAux24Feed(circuit)
        ? []
        : aux24FeedsForEquipment(system690, equipment.id),
    [circuit, equipment.id],
  )
  /**
   * Multi-acometida: empareja NORM↔ALT de *esta* acometida (no todas las
   * paralelas al mismo destino: p. ej. PWP-GENS con 3×NORM+3×ALT).
   */
  const remoteFeeds = pairedRemoteFeeds(feeds, localFeed)
  /** LCS plegado: QVS-230 + QVS-440 (ambas NORM desde el mismo TRF). */
  const qvsLegs = useMemo(
    () => foldedLcsQvsLegs(feeds, localFeed),
    [feeds, localFeed],
  )
  /** LCS plegado: acometida CSB→QS* (misma barra VS; en abierto va en ParallelFeedLeg). */
  const parallelLegs = useMemo(
    () =>
      qvsLegs != null ? feeds.filter((c) => isParallelLcsTopFeed(c)) : [],
    [feeds, qvsLegs],
  )
  const dual =
    remoteFeeds.length > 0 ||
    (qvsLegs != null && qvsLegs.length > 1) ||
    parallelLegs.length > 0
  const boardOverlay = useEnergizationOverlay()
  const localFlowing = energizedCircuitIds.has(localFeed.id)
  const eqEnergized = energizedEquipmentIds.has(equipment.id)
  const eqBoardLiveClass = eqBoardClass(equipment.id, boardOverlay)
  const isAltLocal = localFeed.lineType === 'alternativa'
  /** SSB abierto bajo otro cuadro: chasis dedicado (no cajita + board suelto). */
  const ssbChassisOpen =
    Boolean(children) &&
    Boolean(rootClassName?.includes('hbus-drop--ssb-open'))
  const is2209 = isSsb2Pws2209(equipment.id)
  const eqBalloon = useEquipInfoBalloon()
  const eqWrapRef = useRef<HTMLDivElement>(null)

  const displayFeeds = useMemo(
    () =>
      qvsLegs != null
        ? [...qvsLegs, ...parallelLegs, ...remoteFeeds]
        : [localFeed, ...remoteFeeds],
    [localFeed, remoteFeeds, qvsLegs, parallelLegs],
  )

  const feedSummaries = useMemo(() => {
    const list = displayFeeds.map((f) => ({
      name: f.protectionName,
      lineType: f.lineType,
      originId: f.originId,
    }))
    for (const aux of aux24Feeds) {
      list.push({
        name: `${aux.protectionName} (AUX 24 V)`,
        lineType: aux.lineType,
        originId: aux.originId,
      })
    }
    return list
  }, [displayFeeds, aux24Feeds])

  const toggleExpand = (e: ReactMouseEvent) => {
    if (!canExpand || !onToggleExpand) return
    e.preventDefault()
    e.stopPropagation()
    onToggleExpand()
  }

  const renderLeg = (feed: Circuit, kind: 'local' | 'remote') => {
    const isAlt = feed.lineType === 'alternativa'
    const flowing = energizedCircuitIds.has(feed.id)
    const boardLeg = legBoardClass(feed.id, boardOverlay)
    const boardActive = boardLeg.includes('board-live') || boardLeg.includes('board-dead')
    const pending = isPendingFeed(feed)
    const breakerOpen = protectionStatus[feed.id] !== 'cerrada'
    const originLive =
      outletFromLive != null && feed.id === localFeed.id
        ? outletFromLive
        : isOutletSideOriginLive(
            feed.originId,
            energizedEquipmentIds,
            system690.equipment,
          )
    return (
      <div
        key={feed.id}
        className={`hbus-drop__leg hbus-drop__leg--${kind}${isAlt ? ' hbus-drop__leg--alt' : ' hbus-drop__leg--norm'}${flowing && !boardActive ? ' hbus-drop__leg--flow' : ''}${boardLeg}${breakerOpen && !flowing && !boardActive ? ' hbus-drop__leg--open' : ''}${originLive && !flowing && !boardActive ? ' hbus-drop__leg--from-live' : ''}`}
        {...dataFlowVoltageFromCircuit(feed)}
        data-circuit-id={kind === 'local' ? feed.id : undefined}
        data-remote-circuit={kind === 'remote' ? feed.id : undefined}
      >
        {kind === 'remote' ? (
          <span className="hbus-drop__free-end" aria-hidden />
        ) : (
          <span
            className="hbus-drop__wire hbus-drop__wire--from-bus"
            aria-hidden
          />
        )}
        <BreakerChip
          name={feed.protectionName}
          state={protectionStatus[feed.id]}
          compact
          circuitId={feed.id}
          circuit={feed}
          flowing={flowing}
          locked={lockedCircuits.has(feed.id) || pending}
          title={
            kind === 'remote'
              ? pending
                ? `Origen pendiente de identificar (${lineBadge(feed.lineType)})`
                : `Ir a ${feed.protectionName} en ${feed.originId}`
              : undefined
          }
          onHoverInfo={onHoverInfo}
          onHoverInfoEnd={onHoverInfoEnd}
          onClick={(e) => {
            e.stopPropagation()
            if (kind === 'remote') {
              if (!pending) onJumpToCircuit?.(feed)
              return
            }
            onLocalBreaker(feed, e)
          }}
        />
        <span className="hbus-drop__wire hbus-drop__wire--mid" aria-hidden />
        {(dual || aux24Feeds.length > 0) && (
          <span
            className={`hbus-drop__tag${isAlt ? ' hbus-drop__tag--alt' : ' hbus-drop__tag--norm'}`}
          >
            {lineBadge(feed.lineType)}
          </span>
        )}
        <span
          className={`hbus-drop__wire hbus-drop__wire--to-eq${flowing ? ' hbus-drop__wire--flow' : ''}`}
          aria-hidden
        />
      </div>
    )
  }

  const hasAuxTops = aux24Feeds.length > 0
  /** Enlace sin chip: pierna «thru» para ver el cable al equipo. */
  const linkThruOnly = linkOnlyFromParent && !hasAuxTops
  const linkAuxBeside =
    linkOnlyFromParent && hasAuxTops && !isAux24Feed(circuit)
  const showTops = !linkOnlyFromParent || hasAuxTops || linkThruOnly
  const secondaryDenom = spare ? null : labelSecondaryDenom(equipment)

  const trfInternalFeeds = useMemo(() => {
    if (equipFam !== 'trf') return []
    return system690.circuits.filter(
      (c) => isTrfInternalConversionFeed(c) && c.originId === equipment.id,
    )
  }, [equipFam, equipment.id])

  const thruVoltageProps = linkOnlyFromParent
    ? isLightingBoard(equipment) && !isLightingBoardId(localFeed.originId)
      ? dataFlowVoltageForBoardFeed(localFeed, equipment)
      : dataFlowVoltageForConversionLink(localFeed)
    : dataFlowVoltageFromCircuit(localFeed)

  /* Origen alumbrado → blanco; acometida a cuadro de alumbrado desde LCS/TRF → 230 */
  const rootVoltageProps = isLightingBoardId(localFeed.originId)
    ? dataFlowVoltageAlum()
    : dataFlowVoltageProps(equipment.id)

  return (
    <div
      className={`hbus-drop hbus-drop--fam-${equipFam}${isAltLocal ? ' hbus-drop--alt' : ''}${localFlowing && !legBoardClass(localFeed.id, boardOverlay) ? ' hbus-drop--flow' : ''}${eqEnergized ? ' hbus-drop--live' : ''}${dual || hasAuxTops ? ' hbus-drop--dual' : ''}${canExpand ? ' hbus-drop--expandable' : ''}${spare ? ' hbus-drop--spare' : ''}${linkOnlyFromParent ? ' hbus-drop--link-only' : ''}${located ? ' hbus-drop--locate' : ''}${is2209 && ssbChassisOpen ? ' hbus-drop--ssb2209' : ''}${rootClassName ? ` ${rootClassName}` : ''}`}
      {...rootVoltageProps}
      data-equip={equipment.id}
      data-locate={located ? '1' : undefined}
      data-circuit-id={localFeed.id}
      aria-label={
        spare
          ? `${localFeed.protectionName} · RESPETO (reserva)`
          : canExpand
            ? `${equipment.id} · doble clic para ${expanded ? 'plegar' : 'desplegar'}`
            : undefined
      }
      onDoubleClick={toggleExpand}
    >
      {showTops ? (
        <div
          className={`hbus-drop__tops${
            linkAuxBeside
              ? ' hbus-drop__tops--link-aux'
              : linkThruOnly
                ? ' hbus-drop__tops--link-thru'
                : ''
          }`}
        >
          {aux24Feeds.map((aux) => (
            <Aux24Incoming
              key={aux.id}
              circuit={aux}
              protectionStatus={protectionStatus}
              energizedCircuitIds={energizedCircuitIds}
              lockedCircuits={lockedCircuits}
              onLocalBreaker={onLocalBreaker}
              onJumpToCircuit={onJumpToCircuit}
              onHoverInfo={onHoverInfo}
              onHoverInfoEnd={onHoverInfoEnd}
            />
          ))}
          {(linkAuxBeside || linkThruOnly) && (
            <div
              className={`hbus-drop__leg hbus-drop__leg--thru${isAltLocal ? ' hbus-drop__leg--alt' : ' hbus-drop__leg--norm'}${localFlowing ? ' hbus-drop__leg--flow' : ''}`}
              {...thruVoltageProps}
              data-circuit-id={localFeed.id}
              aria-hidden
            >
              <span
                className={`hbus-drop__wire hbus-drop__wire--thru${localFlowing ? ' hbus-drop__wire--flow' : ''}`}
              />
            </div>
          )}
          {!linkOnlyFromParent && (
            <>
              {remoteFeeds.map((remote) => renderLeg(remote, 'remote'))}
              {qvsLegs != null
                ? qvsLegs.map((qvs) => renderLeg(qvs, 'local'))
                : renderLeg(localFeed, 'local')}
              {parallelLegs.map((pf) => (
                <FoldedParallelCsbLeg
                  key={pf.id}
                  feed={pf}
                  protectionStatus={protectionStatus}
                  energizedCircuitIds={energizedCircuitIds}
                  energizedEquipmentIds={energizedEquipmentIds}
                  lockedCircuits={lockedCircuits}
                  onLocalBreaker={onLocalBreaker}
                  onHoverInfo={onHoverInfo}
                  onHoverInfoEnd={onHoverInfoEnd}
                />
              ))}
            </>
          )}
        </div>
      ) : null}

      {ssbChassisOpen ? (
        <div className="hbus-drop__eq-row">
          <div
            className={`equip-chassis equip-chassis--ssb${eqEnergized ? ' equip-chassis--live' : ''}${eqBoardLiveClass}${localFlowing ? ' equip-chassis--feed-flow' : ''}${isAltLocal ? ' equip-chassis--feed-alt' : ''}${located ? ' equip-chassis--locate' : ''}`}
            {...dataFlowVoltageProps(equipment.id)}
            onDoubleClick={toggleExpand}
            aria-label={`${equipment.id} · doble clic para plegar`}
          >
            {is2209 && (
              <span className="ssb2209-chassis-alt-riser" aria-hidden />
            )}
            <div
              ref={(el) => {
                eqWrapRef.current = el
                eqBalloon.setAnchorEl(el)
              }}
              className="equip-chassis__label"
              {...eqBalloon.bind}
            >
              <span className="equip-chassis__id">{equipment.id}</span>
              <span className="equip-chassis__name">{equipment.name}</span>
              <span className="equip-chassis__hint">doble clic · plegar</span>
              <button
                type="button"
                className="equip-chassis__fold-btn"
                onClick={toggleExpand}
              >
                Plegar
              </button>
              {eqBalloon.show && (
                <EquipmentBalloon
                  equipment={equipment}
                  feeds={feedSummaries}
                  circuits={displayFeeds}
                  anchorRef={eqWrapRef}
                  sheet={eqBalloon.sheet}
                />
              )}
            </div>
            <div className="equip-chassis__body">{children}</div>
          </div>
        </div>
      ) : (
        <>
          <div className="hbus-drop__eq-row">
            <div
              ref={(el) => {
                eqWrapRef.current = el
                eqBalloon.setAnchorEl(el)
              }}
              className="hbus-drop__eq-wrap"
            >
              <button
                type="button"
                className={`hbus-drop__eq hbus-drop__eq--fam-${equipFam}${expanded ? ' hbus-drop__eq--open' : ''}${eqEnergized ? ' hbus-drop__eq--live' : ''}${eqBoardLiveClass}${spare ? ' hbus-drop__eq--spare' : ''}`}
                data-equip={equipment.id}
                aria-disabled={!canExpand}
                aria-label={
                  spare
                    ? `${localFeed.protectionName} · interruptor de reserva (RESPETO)`
                    : canExpand
                      ? `Doble clic para ${expanded ? 'plegar' : 'desplegar'} salidas`
                      : `${equipment.id} · ${equipment.name}`
                }
                {...eqBalloon.bind}
                onClick={(e) => {
                  e.stopPropagation()
                  eqBalloon.onClick(e)
                }}
                onDoubleClick={toggleExpand}
              >
                <span className="hbus-drop__sym">
                  {spare ? 'R' : symbolFor(equipment.kind, equipment)}
                </span>
                <span className="hbus-drop__id">
                  {spare ? localFeed.protectionName : equipment.id}
                </span>
                {secondaryDenom && (
                  <span className="hbus-drop__dcp" title={secondaryDenom.title}>
                    {secondaryDenom.value}
                  </span>
                )}
                <span className="hbus-drop__name">
                  {spare ? 'RESPETO' : equipment.name}
                </span>
                {bankNote && (
                  <span className="hbus-drop__bank" title={bankNote}>
                    690/440-230
                  </span>
                )}
                {conversionNote && (
                  <span
                    className="hbus-drop__bank hbus-drop__bank--convert"
                    title={conversionNote}
                  >
                    {conversionNote}
                  </span>
                )}
                {equipFam === 'trf' && (
                  <>
                    <span
                      className={`hbus-drop__trf-stub hbus-drop__trf-stub--230${trfStubFlow?.v230 ? ' hbus-drop__wire--flow' : ''}`}
                      aria-hidden
                    />
                    <span
                      className={`hbus-drop__trf-stub hbus-drop__trf-stub--440${trfStubFlow?.v440 ? ' hbus-drop__wire--flow' : ''}`}
                      aria-hidden
                    />
                  </>
                )}
                {trfInternalFeeds.map((tf) => {
                  const tfFlow = energizedCircuitIds.has(tf.id)
                  return (
                    <span
                      key={tf.id}
                      className="hbus-drop__trf-inbrk"
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                    >
                      <BreakerChip
                        name={tf.protectionName}
                        state={protectionStatus[tf.id]}
                        compact
                        circuitId={tf.id}
                        circuit={tf}
                        flowing={tfFlow}
                        locked={lockedCircuits.has(tf.id)}
                        title={`${tf.protectionName} · ${tf.voltage} V → ${tf.destinationId}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          onLocalBreaker(tf, e)
                        }}
                        onHoverInfo={onHoverInfo}
                        onHoverInfoEnd={onHoverInfoEnd}
                      />
                    </span>
                  )
                })}
                {canExpand && (
                  <span className="hbus-drop__more">
                    {expandLabel ?? `${expanded ? '▴' : '▾'}`}
                  </span>
                )}
              </button>
              {eqBalloon.show && (
                <EquipmentBalloon
                  equipment={equipment}
                  feeds={feedSummaries}
                  circuits={displayFeeds}
                  anchorRef={eqWrapRef}
                  sheet={eqBalloon.sheet}
                />
              )}
            </div>
          </div>

          {children}
        </>
      )}
    </div>
  )
}
