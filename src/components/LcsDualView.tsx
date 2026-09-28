import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react'
import { system690 } from '../data/system690'
import type { Circuit, Equipment, ProtectionState, ServiceClass } from '../types'
import {
  buildLcsBoardModel,
  LCS_STYLE_PROFILE,
  LCS_VOLTAGE_LAYOUT,
  type LcsOutlet,
  type LcsParallelIncoming,
  type LcsSection,
  type LcsVoltageBus,
} from '../abtDownstream'
import {
  hasSsbBoardLayout,
  isDownstreamPanelBoard,
  isOutletSideOriginLive,
  isSsbIncomingCircuit,
} from '../abtDownstream/ssbBoard'
import {
  aux24FeedsForEquipment,
  feedScopedChildFeeders,
  incomingFeeds,
  isAux24Feed,
  isPendingFeed,
  isUnifilarLinkOnlyFeed,
  lineBadge,
  nestableChildFeeders,
  pairedRemoteFeeds,
} from '../utils/cascadeModel'
import { isSsb2Pws2209, hasSsb2209StructuredLayout } from '../abtDownstream/ssb2pws2209'
import { Aux24Incoming } from './Aux24Incoming'
import { BreakerChip } from './BreakerChip'
import { EquipmentBalloon } from './EquipmentBalloon'
import { useEquipInfoBalloon } from '../hooks/useEquipInfoBalloon'
import { EquipmentBusDrop, equipFamOf, symbolFor } from './EquipmentBusDrop'
import { SsbBoardView } from './SsbBoardView'
import { labelSecondaryDenom } from '../utils/equipmentLabels'
import {
  dataFlowVoltageFromCircuit,
  dataFlowVoltageFromLcsBus,
  dataFlowVoltageForBoardFeed,
  dataFlowVoltageProps,
} from '../utils/flowVoltage'
import { EntregaSemaforo } from './EntregaSemaforo'

type FeedSyncVars = {
  feedCol: number
  feedOffset: number
  /** Dos salidas TRF→QVS (px de layout, sin zoom). */
  dual?: { out230: number; out440: number; stubH: number }
}

/** Factor de `transform: scale(zoom)` del unifilar (rect CSSOM / layout). */
function layoutZoom(el: HTMLElement): number {
  const w = el.offsetWidth
  if (w < 1) return 1
  const rw = el.getBoundingClientRect().width
  return rw > 0 ? rw / w : 1
}

function findTrfDrop(from: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = from
  while (el) {
    if (el.classList.contains('hbus-drop--feeds-lcs-open')) return el
    el = el.parentElement
  }
  return null
}

function applyFeedVars(fromEl: HTMLElement, vars: FeedSyncVars) {
  let el: HTMLElement | null = fromEl
  while (el) {
    if (
      el.classList.contains('hbus-drop--feeds-lcs-open') ||
      el.classList.contains('hbus-drop--chain-open') ||
      el.classList.contains('hbus-drop--lcs-open')
    ) {
      el.style.setProperty('--feed-col', `${vars.feedCol}px`)
      el.style.setProperty('--feed-offset', `${vars.feedOffset}px`)
      // Solo tocar dual en el TRF que alimenta el LCS; no borrar patas en
      // pasadas intermedias (solo feedCol) — si no, desaparecen hasta el scroll.
      if (el.classList.contains('hbus-drop--feeds-lcs-open') && vars.dual) {
        el.classList.add('hbus-drop--dual-feed')
        el.style.setProperty('--trf-out-230', `${vars.dual.out230}px`)
        el.style.setProperty('--trf-out-440', `${vars.dual.out440}px`)
        el.style.setProperty('--trf-stub-h', `${vars.dual.stubH}px`)
      }
    }
    el = el.parentElement
  }
}

/**
 * Ensancha ABT/TRF al vano VS 230+440 y coloca dos bajantes
 * alineadas con QVS (coordenadas de layout, corregidas por zoom).
 * Si hay CSB/QS* paralelo, alinea el recuadro CSB con el TRF (top + altura).
 */
function syncFeedCol(
  railsEl: HTMLElement,
  vs440: HTMLElement,
  vs230: HTMLElement | null,
  qvs440: HTMLElement | null,
  qvs230: HTMLElement | null,
) {
  const z = layoutZoom(railsEl)
  const railsLeft = railsEl.getBoundingClientRect().left
  const r440 = vs440.getBoundingClientRect()

  let feedCol: number
  let feedOffset: number

  if (vs230) {
    const r230 = vs230.getBoundingClientRect()
    feedCol = Math.ceil((r440.right - r230.left) / z)
    feedOffset = Math.max(0, Math.round((r230.left - railsLeft) / z))
  } else {
    feedCol = Math.ceil(r440.width / z)
    feedOffset = Math.max(0, Math.round((r440.left - railsLeft) / z))
  }
  if (feedCol < 1) return

  applyFeedVars(vs440, { feedCol, feedOffset })

  const trfDrop = findTrfDrop(vs440)
  const trfEq = trfDrop?.querySelector(
    ':scope > .hbus-drop__eq-row > .hbus-drop__eq-wrap > .hbus-drop__eq, :scope > .hbus-drop__eq-wrap > .hbus-drop__eq',
  ) as HTMLElement | null

  if (!trfEq || !vs230 || !qvs230 || !qvs440) {
    applyFeedVars(vs440, { feedCol, feedOffset })
    syncParallelCsb(trfEq)
    return
  }

  void trfEq.offsetWidth
  const zTrf = layoutZoom(trfEq)
  if (!(zTrf > 0) || trfEq.offsetWidth < 1) {
    applyFeedVars(vs440, { feedCol, feedOffset })
    syncParallelCsb(trfEq)
    return
  }

  const trfRect = trfEq.getBoundingClientRect()
  const chip230 =
    (qvs230.querySelector('.casc-brk') as HTMLElement | null)?.getBoundingClientRect() ??
    qvs230.getBoundingClientRect()
  const chip440 =
    (qvs440.querySelector('.casc-brk') as HTMLElement | null)?.getBoundingClientRect() ??
    qvs440.getBoundingClientRect()

  // Medidas aún no estables (zoom / layout a medias): mantener dual previo.
  if (chip230.width < 2 || chip440.width < 2 || trfRect.width < 2) {
    applyFeedVars(vs440, { feedCol, feedOffset })
    syncParallelCsb(trfEq)
    return
  }

  const out230 = Math.round(
    (chip230.left + chip230.width / 2 - trfRect.left) / zTrf,
  )
  const out440 = Math.round(
    (chip440.left + chip440.width / 2 - trfRect.left) / zTrf,
  )
  // Stub hasta el chip (el TRF pinta por encima del chasis vía z-index).
  // Suelo ~ hueco JBX/cadena para que no queden patas de 12px “invisibles”.
  const gapPx = (Math.min(chip230.top, chip440.top) - trfRect.bottom) / zTrf
  const stubH = Math.max(22, Math.round(gapPx) + 2)

  applyFeedVars(vs440, {
    feedCol,
    feedOffset,
    dual: { out230, out440, stubH },
  })
  syncParallelCsb(trfEq)
}

/** Alinea CSB con el recuadro TRF (misma cota superior y misma altura). */
function syncParallelCsb(trfEq: HTMLElement | null) {
  const csb = document.querySelector(
    '.lcs440-board--parallel-feed .lcs440-rail__parallel-src',
  ) as HTMLElement | null
  if (!csb) return
  if (!trfEq) {
    csb.style.removeProperty('top')
    csb.style.removeProperty('height')
    csb.style.removeProperty('min-height')
    csb.classList.remove('lcs440-rail__parallel-src--synced')
    return
  }
  const qsLeg = csb.parentElement
  if (!qsLeg) return

  const apply = () => {
    const z = layoutZoom(qsLeg)
    const trfRect = trfEq.getBoundingClientRect()
    const legRect = qsLeg.getBoundingClientRect()
    const top = Math.round((trfRect.top - legRect.top) / z)
    const height = Math.max(48, Math.round(trfRect.height / z))
    csb.style.top = `${top}px`
    csb.style.bottom = 'auto'
    csb.style.height = `${height}px`
    csb.style.minHeight = `${height}px`
    csb.classList.add('lcs440-rail__parallel-src--synced')

    const chip =
      (qsLeg.querySelector('.casc-brk') as HTMLElement | null)?.getBoundingClientRect() ??
      null
    if (chip) {
      const csbRect = csb.getBoundingClientRect()
      const gap = Math.max(6, Math.round((chip.top - csbRect.bottom) / z))
      csb.style.setProperty('--qs-drop-h', `${gap}px`)
    }
  }

  apply()
  // Segunda pasada tras ensanchar el TRF (--feed-col / dual stubs)
  requestAnimationFrame(apply)
}

function clearFeedSync(fromEl: HTMLElement) {
  let el: HTMLElement | null = fromEl
  while (el) {
    if (
      el.classList.contains('hbus-drop--feeds-lcs-open') ||
      el.classList.contains('hbus-drop--chain-open') ||
      el.classList.contains('hbus-drop--lcs-open')
    ) {
      el.style.removeProperty('--feed-col')
      el.style.removeProperty('--feed-offset')
      el.style.removeProperty('--trf-out-230')
      el.style.removeProperty('--trf-out-440')
      el.style.removeProperty('--trf-stub-h')
      el.classList.remove('hbus-drop--dual-feed')
    }
    el = el.parentElement
  }
  const csb = document.querySelector(
    '.lcs440-rail__parallel-src',
  ) as HTMLElement | null
  if (csb) {
    csb.style.removeProperty('top')
    csb.style.removeProperty('height')
    csb.style.removeProperty('min-height')
    csb.style.removeProperty('--qs-drop-h')
    csb.classList.remove('lcs440-rail__parallel-src--synced')
    csb.parentElement?.style.removeProperty('--qs-stub-h')
  }
}

/**
 * LCS 440/230 V: mismo criterio visual que el cuadro principal (MSB).
 * 230 a la izquierda (espejo NV→VS); 440 a la derecha (VS→NV).
 * TRF crece al vano de ambas VS con dos bajantes a QVS-230 / QVS-440.
 */

type SharedProps = {
  protectionStatus: Record<string, ProtectionState>
  energizedCircuitIds: Set<string>
  energizedEquipmentIds: Set<string>
  lockedCircuits: Set<string>
  onLocalBreaker: (c: Circuit, e: ReactMouseEvent) => void
  onJumpToCircuit?: (c: Circuit) => void
  onHoverInfo?: (circuit: Circuit, rect: DOMRect) => void
  onHoverInfoEnd?: () => void
  /** Equipo resaltado por el localizador del unifilar. */
  locateEquipmentId?: string | null
  expandedEquip?: Set<string>
  onToggleEquip?: (id: string, circuitId?: string) => void
}

function sectionOf(bus: LcsVoltageBus, service: ServiceClass): LcsSection | undefined {
  return bus.sections.find((s) => s.service === service)
}

function BusDrops({
  outlets,
  busVoltage,
  sectionLive,
  locateEquipmentId,
  expandedEquip,
  onToggleEquip,
  ...shared
}: {
  outlets: LcsOutlet[]
  busVoltage: number | string
  /** Barra de sección viva (tras QVS / QVM / QNV según corresponda). */
  sectionLive: boolean
} & SharedProps) {
  return (
    <div
      className="hbus hbus--nested hbus--lcs-section"
      {...dataFlowVoltageFromLcsBus(busVoltage)}
    >
      <div className="hbus__drops">
        {outlets.map(({ circuit, equipment }) => (
          <div key={circuit.id} className="hbus__slot">
            <LcsOutletDrop
              circuit={circuit}
              equipment={equipment}
              sectionLive={sectionLive}
              locateEquipmentId={locateEquipmentId}
              expandedEquip={expandedEquip ?? new Set()}
              onToggleEquip={onToggleEquip ?? (() => {})}
              {...shared}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Salida LCS expandible (SSB con INS+barra u otros cuadros con hijos). */
function LcsOutletDrop({
  circuit,
  equipment,
  sectionLive,
  protectionStatus,
  energizedCircuitIds,
  energizedEquipmentIds,
  lockedCircuits,
  onLocalBreaker,
  onJumpToCircuit,
  onHoverInfo,
  onHoverInfoEnd,
  locateEquipmentId,
  expandedEquip,
  onToggleEquip,
  ancestorIds,
}: {
  circuit: Circuit
  equipment: Equipment
  /** Vivo en la barra de sección LCS de la que cuelga esta salida. */
  sectionLive?: boolean
  ancestorIds?: ReadonlySet<string>
} & SharedProps & {
  expandedEquip: Set<string>
  onToggleEquip: (id: string, circuitId?: string) => void
}) {
  const kids = useMemo(() => {
    if (isAux24Feed(circuit)) return []
    const all = nestableChildFeeders(system690, equipment.id, {
      feedParentId: circuit.originId,
      ancestorIds,
    })
    const filtered = hasSsbBoardLayout(equipment)
      ? all.filter(
          (x) =>
            !isSsbIncomingCircuit(x.circuit) &&
            !x.equipment.virtual &&
            !x.circuit.destinationId.startsWith('BUS-'),
        )
      : // Permitir barra 115 V virtual tras TRF interno de SSB especiales
        all.filter(
          (x) =>
            !x.equipment.virtual ||
            /^BUS-SSB-.+-115$/i.test(x.equipment.id),
        )
    return feedScopedChildFeeders(filtered, circuit)
  }, [equipment, circuit, ancestorIds])

  const canExpand =
    !isAux24Feed(circuit) &&
    (kids.length > 0 || hasSsbBoardLayout(equipment))
  const expanded = expandedEquip.has(equipment.id)
  /** SSB / 400 Hz: chasis barra→salidas (también bus-only sin INS, p. ej. Rev.C). CCM usa EquipmentBusDrop. */
  const ssbOpen =
    !isDownstreamPanelBoard(equipment) &&
    hasSsbBoardLayout(equipment) &&
    expanded
  const aux24Feeds = useMemo(
    () =>
      isAux24Feed(circuit)
        ? []
        : aux24FeedsForEquipment(system690, equipment.id),
    [circuit, equipment.id],
  )
  const powerFeeds = useMemo(() => {
    if (isAux24Feed(circuit)) return [circuit]
    return incomingFeeds(system690, equipment.id).filter((c) => !isAux24Feed(c))
  }, [circuit, equipment.id])
  const localFeed = powerFeeds.find((c) => c.id === circuit.id) ?? circuit
  const remoteFeeds = pairedRemoteFeeds(powerFeeds, localFeed)
  const dualIncoming = remoteFeeds.length > 0
  const is2209 =
    isSsb2Pws2209(equipment.id) && hasSsb2209StructuredLayout(system690)
  const localFlowing = energizedCircuitIds.has(circuit.id)
  const eqEnergized = energizedEquipmentIds.has(equipment.id)
  const isAltLocal = circuit.lineType === 'alternativa'
  const equipFam = equipFamOf(equipment)
  const located = locateEquipmentId === equipment.id
  const eqBalloon = useEquipInfoBalloon()
  const eqWrapRef = useRef<HTMLDivElement>(null)
  const feedSummaries = useMemo(() => {
    const list = powerFeeds.map((f) => ({
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
  }, [powerFeeds, aux24Feeds])
  const nextAncestors = useMemo(() => {
    const s = new Set(ancestorIds ?? [])
    s.add(equipment.id)
    return s
  }, [ancestorIds, equipment.id])

  if (ssbOpen) {
    const linkOnly = isUnifilarLinkOnlyFeed(circuit)
    const foldSsb = (e: ReactMouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onToggleEquip(equipment.id, circuit.id)
    }

    const renderIncomingLeg = (feed: Circuit, kind: 'local' | 'remote') => {
      const isAlt = feed.lineType === 'alternativa'
      const flowing = energizedCircuitIds.has(feed.id)
      const pending = isPendingFeed(feed)
      const breakerOpen = protectionStatus[feed.id] !== 'cerrada'
      const originLive =
        kind === 'local' && sectionLive != null
          ? sectionLive
          : isOutletSideOriginLive(
              feed.originId,
              energizedEquipmentIds,
              system690.equipment,
            )
      return (
        <div
          key={feed.id}
          className={`hbus-drop__leg hbus-drop__leg--${kind}${isAlt ? ' hbus-drop__leg--alt' : ' hbus-drop__leg--norm'}${flowing ? ' hbus-drop__leg--flow' : ''}${breakerOpen && !flowing ? ' hbus-drop__leg--open' : ''}${originLive && !flowing ? ' hbus-drop__leg--from-live' : ''}`}
          {...dataFlowVoltageForBoardFeed(feed, equipment)}
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
                  ? `Origen pendiente (${lineBadge(feed.lineType)})`
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
          {(dualIncoming || aux24Feeds.length > 0) && (
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

    return (
      <div
        className={`hbus-drop hbus-drop--fam-${equipFam}${isAltLocal ? ' hbus-drop--alt' : ''}${localFlowing ? ' hbus-drop--flow' : ''}${eqEnergized ? ' hbus-drop--live' : ''} hbus-drop--expandable hbus-drop--ssb-open${dualIncoming ? ' hbus-drop--dual' : ''}${is2209 ? ' hbus-drop--ssb2209' : ''}${linkOnly ? ' hbus-drop--link-only' : ''}${located ? ' hbus-drop--locate' : ''}`}
        {...dataFlowVoltageProps(equipment.id)}
        data-equip={equipment.id}
        data-locate={located ? '1' : undefined}
        data-circuit-id={circuit.id}
        aria-label={`${equipment.id} · doble clic para plegar`}
        onDoubleClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onToggleEquip(equipment.id, circuit.id)
        }}
      >
        {!linkOnly && (
          <div className="hbus-drop__tops">
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
            {/* ALT/remotas primero (como plegado): en 2209 van sobre QA */}
            {remoteFeeds.map((remote) => renderIncomingLeg(remote, 'remote'))}
            {renderIncomingLeg(localFeed, 'local')}
          </div>
        )}
        {linkOnly && (
          <div
            className={`hbus-drop__tops${
              aux24Feeds.length > 0
                ? ' hbus-drop__tops--link-aux'
                : ' hbus-drop__tops--link-thru'
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
            <div
              className={`hbus-drop__leg hbus-drop__leg--thru${isAltLocal ? ' hbus-drop__leg--alt' : ' hbus-drop__leg--norm'}${localFlowing ? ' hbus-drop__leg--flow' : ''}`}
              {...dataFlowVoltageForBoardFeed(circuit, equipment)}
              data-circuit-id={circuit.id}
              aria-hidden
            >
              <span
                className={`hbus-drop__wire hbus-drop__wire--thru${localFlowing ? ' hbus-drop__wire--flow' : ''}`}
              />
            </div>
          </div>
        )}
        <div className="hbus-drop__eq-row">
          <div
            className={`equip-chassis equip-chassis--ssb${eqEnergized ? ' equip-chassis--live' : ''}${localFlowing ? ' equip-chassis--feed-flow' : ''}${isAltLocal ? ' equip-chassis--feed-alt' : ''}${located ? ' equip-chassis--locate' : ''}`}
            {...dataFlowVoltageProps(equipment.id)}
            onDoubleClick={foldSsb}
            aria-label={`${equipment.id} · doble clic para plegar`}
          >
            <EntregaSemaforo equipmentId={equipment.id} />
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
                onClick={foldSsb}
              >
                Plegar
              </button>
              {eqBalloon.show && (
                <EquipmentBalloon
                  equipment={equipment}
                  feeds={feedSummaries}
                  circuits={powerFeeds}
                  anchorRef={eqWrapRef}
                  sheet={eqBalloon.sheet}
                />
              )}
            </div>
            <div className="equip-chassis__body">
              <SsbBoardView
                ssb={equipment}
                feed={circuit}
                protectionStatus={protectionStatus}
                energizedCircuitIds={energizedCircuitIds}
                energizedEquipmentIds={energizedEquipmentIds}
                lockedCircuits={lockedCircuits}
                onLocalBreaker={onLocalBreaker}
                onJumpToCircuit={onJumpToCircuit}
                onHoverInfo={onHoverInfo}
                onHoverInfoEnd={onHoverInfoEnd}
                expandedEquip={expandedEquip}
                onToggleEquip={onToggleEquip}
                locateEquipmentId={locateEquipmentId}
                ancestorIds={nextAncestors}
              />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <EquipmentBusDrop
      circuit={circuit}
      equipment={equipment}
      protectionStatus={protectionStatus}
      energizedCircuitIds={energizedCircuitIds}
      energizedEquipmentIds={energizedEquipmentIds}
      lockedCircuits={lockedCircuits}
      onLocalBreaker={onLocalBreaker}
      onJumpToCircuit={onJumpToCircuit}
      onHoverInfo={onHoverInfo}
      onHoverInfoEnd={onHoverInfoEnd}
      canExpand={canExpand}
      expanded={expanded}
      expandLabel={
        canExpand
          ? `${kids.length} ${expanded ? '▴' : '▾'}`
          : undefined
      }
      onToggleExpand={
        canExpand ? () => onToggleEquip(equipment.id, circuit.id) : undefined
      }
      equipFam={equipFam}
      located={located}
      linkOnlyFromParent={isUnifilarLinkOnlyFeed(circuit)}
      outletFromLive={sectionLive}
      rootClassName={
        expanded && (kids.length > 0 || hasSsbBoardLayout(equipment))
          ? hasSsbBoardLayout(equipment)
            ? 'hbus-drop--ssb-open'
            : 'hbus-drop--chain-open'
          : undefined
      }
    >
      {expanded && hasSsbBoardLayout(equipment) && (
        <SsbBoardView
          ssb={equipment}
          feed={circuit}
          protectionStatus={protectionStatus}
          energizedCircuitIds={energizedCircuitIds}
          energizedEquipmentIds={energizedEquipmentIds}
          lockedCircuits={lockedCircuits}
          onLocalBreaker={onLocalBreaker}
          onJumpToCircuit={onJumpToCircuit}
          onHoverInfo={onHoverInfo}
          onHoverInfoEnd={onHoverInfoEnd}
          locateEquipmentId={locateEquipmentId}
          expandedEquip={expandedEquip}
          onToggleEquip={onToggleEquip}
          ancestorIds={nextAncestors}
        />
      )}
      {expanded && !hasSsbBoardLayout(equipment) && kids.length > 0 && (
        <div
          className={`hbus hbus--nested hbus--direct${
            kids.some((k) => isUnifilarLinkOnlyFeed(k.circuit))
              ? ' hbus--chain-link'
              : ''
          }${
            kids.some(
              (k) =>
                isUnifilarLinkOnlyFeed(k.circuit) &&
                energizedCircuitIds.has(k.circuit.id),
            )
              ? ' hbus--live'
              : ''
          }`}
          {...(kids.find((k) => isUnifilarLinkOnlyFeed(k.circuit))
            ? dataFlowVoltageFromCircuit(
                kids.find((k) => isUnifilarLinkOnlyFeed(k.circuit))!.circuit,
              )
            : {})}
        >
          <div className="hbus__drops">
            {kids.map(({ circuit: c, equipment: eq }) => (
              <div key={c.id} className="hbus__slot">
                <LcsOutletDrop
                  circuit={c}
                  equipment={eq}
                  protectionStatus={protectionStatus}
                  energizedCircuitIds={energizedCircuitIds}
                  energizedEquipmentIds={energizedEquipmentIds}
                  lockedCircuits={lockedCircuits}
                  onLocalBreaker={onLocalBreaker}
                  onJumpToCircuit={onJumpToCircuit}
                  onHoverInfo={onHoverInfo}
                  onHoverInfoEnd={onHoverInfoEnd}
                  locateEquipmentId={locateEquipmentId}
                  expandedEquip={expandedEquip}
                  onToggleEquip={onToggleEquip}
                  ancestorIds={nextAncestors}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </EquipmentBusDrop>
  )
}

/** Barra LCS: QVS → VS — QVM — VM — QNV — NV (o espejo si mirror). */
export function LcsVoltageBoard({
  bus,
  incoming,
  mirror = false,
  vsBusRef,
  qvsLegRef,
  protectionStatus,
  energizedCircuitIds,
  energizedEquipmentIds,
  lockedCircuits,
  onLocalBreaker,
  onJumpToCircuit,
  onHoverInfo,
  onHoverInfoEnd,
  locateEquipmentId,
  expandedEquip,
  onToggleEquip,
}: {
  bus: LcsVoltageBus
  /** Circuito QVS (energía); el chip está en la pierna TRF→LCS. */
  incoming?: Circuit
  /** Espejo horizontal (230 V a la izquierda). */
  mirror?: boolean
  vsBusRef?: RefObject<HTMLDivElement | null>
  qvsLegRef?: RefObject<HTMLDivElement | null>
} & SharedProps) {
  const vs = sectionOf(bus, 'VS')
  const vm = sectionOf(bus, 'VM')
  const nv = sectionOf(bus, 'NV')
  const feed = incoming ?? bus.incoming
  const parallel = bus.parallelIncoming
  const inFlow = !!(feed && energizedCircuitIds.has(feed.id))
  const parallelFlow = !!(
    parallel && energizedCircuitIds.has(parallel.circuit.id)
  )
  const qvm = vm?.sectionBreaker
  const qnv = nv?.sectionBreaker
  const qvmFlow = !!(qvm && energizedCircuitIds.has(qvm.id))
  const qnvFlow = !!(qnv && energizedCircuitIds.has(qnv.id))
  const vsLive = inFlow || parallelFlow
  const vmLive = vsLive && qvmFlow
  const nvLive = vsLive && qnvFlow
  const vLabel = `${bus.voltage} V`
  const shared = {
    protectionStatus,
    energizedCircuitIds,
    energizedEquipmentIds,
    lockedCircuits,
    onLocalBreaker,
    onJumpToCircuit,
    onHoverInfo,
    onHoverInfoEnd,
    locateEquipmentId,
    expandedEquip,
    onToggleEquip,
  }

  const qvsOpen = !!(feed && protectionStatus[feed.id] !== 'cerrada')
  const qvsFromLive = !!(
    feed && energizedEquipmentIds.has(feed.originId) && !inFlow
  )
  const qvsLeg = feed ? (
    <div
      ref={qvsLegRef}
      className={`lcs440-rail__qvs-leg${inFlow ? ' lcs440-rail__qvs-leg--flow' : ''}${qvsOpen && !inFlow ? ' lcs440-rail__qvs-leg--open' : ''}${qvsFromLive ? ' lcs440-rail__qvs-leg--from-live' : ''}`}
      {...dataFlowVoltageFromLcsBus(bus.voltage)}
      data-qvs={bus.voltage}
    >
      <span className="lcs440-rail__qvs-leg__wire lcs440-rail__qvs-leg__wire--from" aria-hidden />
      <BreakerChip
        name={feed.protectionName}
        state={protectionStatus[feed.id]}
        compact
        circuitId={feed.id}
        circuit={feed}
        flowing={inFlow}
        locked={lockedCircuits.has(feed.id)}
        title={`${feed.protectionName} · entrada TRF → VS ${vLabel}`}
        onClick={(e) => onLocalBreaker(feed, e)}
        onHoverInfo={onHoverInfo}
        onHoverInfoEnd={onHoverInfoEnd}
      />
      <span className="lcs440-rail__qvs-leg__wire lcs440-rail__qvs-leg__wire--to-bus" aria-hidden />
    </div>
  ) : null

  const parallelLeg = parallel ? (
    <ParallelFeedLeg
      parallel={parallel}
      voltageLabel={vLabel}
      busVoltage={bus.voltage}
      flowing={parallelFlow}
      eqLive={energizedEquipmentIds.has(parallel.equipment.id)}
      {...shared}
    />
  ) : null

  const vsBlock = (
    <>
      <span className="lcs440-cell__tag lcs440-cell__tag--VS lcs440-rail__vs-tag">
        VS {vLabel}
      </span>
      <div className="lcs440-rail__vs-bus-track">
        <div
          ref={vsBusRef}
          className={`lcs440-cell__bus lcs440-rail__vs-bus${vsLive ? ' lcs440-cell__bus--live' : ''}`}
        />
        {parallel && (
          <div
            className={`lcs440-cell__bus lcs440-rail__vs-bus lcs440-rail__vs-bus--parallel-ext${vsLive ? ' lcs440-cell__bus--live' : ''}`}
            aria-hidden
          />
        )}
      </div>
      <div className="lcs440-rail__vs-drops">
        <BusDrops
          outlets={vs?.outlets ?? []}
          busVoltage={bus.voltage}
          sectionLive={vsLive}
          {...shared}
        />
        {parallel && (
          <div className="lcs440-rail__vs-parallel-spacer" aria-hidden />
        )}
      </div>
    </>
  )

  const qvmBlock = qvm ? (
    <div
      className={`lcs440-tie lcs440-rail__qvm${qvmFlow ? ' lcs440-tie--flow' : ''}`}
      {...dataFlowVoltageFromLcsBus(bus.voltage)}
    >
      <span className="lcs440-tie__bridge lcs440-tie__bridge--left" aria-hidden />
      <BreakerChip
        name={qvm.protectionName}
        state={protectionStatus[qvm.id]}
        compact
        circuitId={qvm.id}
        circuit={qvm}
        flowing={qvmFlow}
        locked={lockedCircuits.has(qvm.id)}
        orientation="horizontal"
        onClick={(e) => onLocalBreaker(qvm, e)}
        onHoverInfo={onHoverInfo}
        onHoverInfoEnd={onHoverInfoEnd}
      />
      <span className="lcs440-tie__bridge lcs440-tie__bridge--right" aria-hidden />
    </div>
  ) : (
    <div className="lcs440-tie lcs440-rail__qvm" aria-hidden />
  )

  const vmBlock = (
    <>
      <span className="lcs440-cell__tag lcs440-cell__tag--VM lcs440-rail__vm-tag">
        VM {vLabel}
      </span>
      <div
        className={`lcs440-cell__bus lcs440-rail__vm-bus${vmLive ? ' lcs440-cell__bus--live' : ''}`}
      />
      <div className="lcs440-rail__vm-drops">
        <BusDrops
          outlets={vm?.outlets ?? []}
          busVoltage={bus.voltage}
          sectionLive={vmLive}
          {...shared}
        />
      </div>
    </>
  )

  const qnvBlock = qnv ? (
    <div
      className={`lcs440-tie lcs440-rail__qnv${qnvFlow ? ' lcs440-tie--flow' : ''}`}
      {...dataFlowVoltageFromLcsBus(bus.voltage)}
    >
      <span className="lcs440-tie__bridge lcs440-tie__bridge--left" aria-hidden />
      <BreakerChip
        name={qnv.protectionName}
        state={protectionStatus[qnv.id]}
        compact
        circuitId={qnv.id}
        circuit={qnv}
        flowing={qnvFlow}
        locked={lockedCircuits.has(qnv.id)}
        orientation="horizontal"
        onClick={(e) => onLocalBreaker(qnv, e)}
        onHoverInfo={onHoverInfo}
        onHoverInfoEnd={onHoverInfoEnd}
      />
      <span className="lcs440-tie__bridge lcs440-tie__bridge--right" aria-hidden />
    </div>
  ) : (
    <div className="lcs440-tie lcs440-rail__qnv" aria-hidden />
  )

  const nvBlock = (
    <>
      <span className="lcs440-cell__tag lcs440-cell__tag--NV lcs440-rail__nv-tag">
        NV {vLabel}
      </span>
      <div
        className={`lcs440-cell__bus lcs440-rail__nv-bus${nvLive ? ' lcs440-cell__bus--live' : ''}`}
      />
      <div className="lcs440-rail__nv-drops">
        <BusDrops
          outlets={nv?.outlets ?? []}
          busVoltage={bus.voltage}
          sectionLive={nvLive}
          {...shared}
        />
      </div>
    </>
  )

  const feedBay =
    parallel && qvsLeg ? (
      <div className="lcs440-rail__feed-bay">
        {qvsLeg}
        {parallelLeg}
      </div>
    ) : (
      qvsLeg
    )

  return (
    <div
      className={`lcs440-board${mirror ? ' lcs440-board--mirror' : ''}${vsLive ? ' lcs440-board--live' : ''}${feed ? ' lcs440-board--fed' : ''}${parallel ? ' lcs440-board--parallel-feed' : ''}`}
      data-voltage={bus.voltage}
      {...dataFlowVoltageFromLcsBus(bus.voltage)}
    >
      <div className={`lcs440-rail${mirror ? ' lcs440-rail--mirror' : ''}`}>
        {feedBay}
        {vsBlock}
        {qvmBlock}
        {vmBlock}
        {qnvBlock}
        {nvBlock}
      </div>
    </div>
  )
}

/** CSB (u origen) + QS* encima de la extensión de barra VS, a la derecha del TRF. */
function ParallelFeedLeg({
  parallel,
  voltageLabel,
  busVoltage,
  flowing,
  eqLive,
  protectionStatus,
  lockedCircuits,
  onLocalBreaker,
  onHoverInfo,
  onHoverInfoEnd,
}: {
  parallel: LcsParallelIncoming
  voltageLabel: string
  busVoltage: number | string
  flowing: boolean
  eqLive: boolean
} & SharedProps) {
  const { circuit, equipment } = parallel
  const eqWrapRef = useRef<HTMLDivElement>(null)
  const [eqHover, setEqHover] = useState(false)
  const [showEqBalloon, setShowEqBalloon] = useState(false)
  const stickyEq = useRef(false)
  const secondary = labelSecondaryDenom(equipment)

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

  return (
    <div
      className={`lcs440-rail__qs-leg${flowing ? ' lcs440-rail__qs-leg--flow' : ''}${protectionStatus[circuit.id] !== 'cerrada' && !flowing ? ' lcs440-rail__qs-leg--open' : ''}${eqLive && !flowing ? ' lcs440-rail__qs-leg--from-live' : ''}`}
      {...dataFlowVoltageFromLcsBus(busVoltage)}
      data-qs={circuit.protectionName}
    >
      <div
        ref={eqWrapRef}
        className={`lcs440-rail__parallel-src hbus-drop__eq--fam-${equipFamOf(equipment)}${eqLive ? ' lcs440-rail__parallel-src--live' : ''}${flowing ? ' lcs440-rail__parallel-src--flow' : ''}`}
        data-equip={equipment.id}
        onMouseEnter={() => setEqHover(true)}
        onMouseLeave={() => setEqHover(false)}
      >
        <span className="hbus-drop__sym">{symbolFor(equipment.kind, equipment)}</span>
        <span className="hbus-drop__id">{equipment.id}</span>
        {secondary && (
          <span className="hbus-drop__dcp" title={secondary.title}>
            {secondary.value}
          </span>
        )}
        <span className="hbus-drop__name">{equipment.name}</span>
        {showEqBalloon && (
          <EquipmentBalloon
            equipment={equipment}
            circuits={[circuit]}
            anchorRef={eqWrapRef}
          />
        )}
      </div>
      <span
        className="lcs440-rail__qvs-leg__wire lcs440-rail__qvs-leg__wire--from lcs440-rail__qs-leg__wire--from"
        aria-hidden
      />
      <BreakerChip
        name={circuit.protectionName}
        state={protectionStatus[circuit.id]}
        compact
        circuitId={circuit.id}
        circuit={circuit}
        flowing={flowing}
        locked={lockedCircuits.has(circuit.id)}
        title={`${circuit.protectionName} · entrada ${equipment.id} → VS ${voltageLabel}`}
        onClick={(e) => onLocalBreaker(circuit, e)}
        onHoverInfo={onHoverInfo}
        onHoverInfoEnd={onHoverInfoEnd}
      />
      <span
        className="lcs440-rail__qvs-leg__wire lcs440-rail__qvs-leg__wire--to-bus"
        aria-hidden
      />
    </div>
  )
}

/** @deprecated Usar LcsVoltageBoard; se mantiene el nombre exportado. */
export const Lcs440Board = LcsVoltageBoard

/** Expandir LCS: barras 230 V (izq., espejo) + 440 V (der.). */
export function LcsDualView({
  lcsId,
  inline = false,
  incoming,
  expandedEquip,
  ...props
}: SharedProps & {
  lcsId: string
  inline?: boolean
  incoming?: Circuit
}) {
  const railsRef = useRef<HTMLDivElement>(null)
  const vs440Ref = useRef<HTMLDivElement>(null)
  const vs230Ref = useRef<HTMLDivElement>(null)
  const qvs440Ref = useRef<HTMLDivElement>(null)
  const qvs230Ref = useRef<HTMLDivElement>(null)

  const board = useMemo(() => buildLcsBoardModel(system690, lcsId), [lcsId])

  const busPrimary = board?.buses.find(
    (b) => b.voltage === LCS_VOLTAGE_LAYOUT.right,
  )
  const busSecondary = board?.buses.find(
    (b) => b.voltage === LCS_VOLTAGE_LAYOUT.left,
  )
  const bus440 = busPrimary
  const bus230 = busSecondary

  useLayoutEffect(() => {
    const vs440 = vs440Ref.current
    const railsEl = railsRef.current
    if (!vs440 || !railsEl) return
    const apply = () =>
      syncFeedCol(
        railsEl,
        vs440,
        bus230 ? vs230Ref.current : null,
        qvs440Ref.current,
        bus230 ? qvs230Ref.current : null,
      )
    apply()
    // Tras --feed-col el TRF se ensancha: segunda/tercera pasada cuando el layout asienta
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      apply()
      raf2 = requestAnimationFrame(apply)
    })
    const ro = new ResizeObserver(() => {
      apply()
      requestAnimationFrame(apply)
    })
    ro.observe(vs440)
    ro.observe(railsEl)
    const vs230 = vs230Ref.current
    if (vs230) ro.observe(vs230)
    const qvs440 = qvs440Ref.current
    if (qvs440) ro.observe(qvs440)
    const qvs230 = qvs230Ref.current
    if (qvs230) ro.observe(qvs230)
    // Salidas abiertas (SSB…) ensanchan el rail; re-sincronizar stubs TRF→QVS
    const dualRoot = railsEl.closest('.lcs-dual')
    if (dualRoot) ro.observe(dualRoot)
    const trfDrop = findTrfDrop(vs440)
    if (trfDrop) ro.observe(trfDrop)
    const trfEq = trfDrop?.querySelector(
      ':scope > .hbus-drop__eq-row > .hbus-drop__eq-wrap > .hbus-drop__eq, :scope > .hbus-drop__eq-wrap > .hbus-drop__eq',
    ) as HTMLElement | null
    if (trfEq) ro.observe(trfEq)
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      ro.disconnect()
      clearFeedSync(vs440)
    }
  }, [board, bus230, bus440, incoming, expandedEquip])

  if (!board || (!bus440 && !bus230)) {
    return (
      <div className="lcs-dual lcs-dual--empty">
        Sin datos 440/230 V para {lcsId}
      </div>
    )
  }

  return (
    <div
      className={`lcs-dual${inline ? ' lcs-dual--inline' : ''}${bus230 && bus440 ? ' lcs-dual--both' : ''}`}
      data-lcs-style={LCS_STYLE_PROFILE.referenceId}
      aria-label={`${board.lcs.id} · ${board.lcs.name}`}
    >
      {!inline && (
        <header className="lcs-dual__head">
          <strong>{board.lcs.id}</strong>
          <span>{board.lcs.name}</span>
          <span className="lcs-dual__meta">
            {bus230 && bus440
              ? '230 V (espejo) · 440 V · VS—QVM—VM—QNV—NV'
              : bus440
                ? '440 V · VS—QVM—VM—QNV—NV'
                : '230 V · VS—QVM—VM—QNV—NV'}
          </span>
        </header>
      )}
      <div className="lcs-dual__rails" ref={railsRef}>
        {bus230 && (
          <LcsVoltageBoard
            bus={bus230}
            incoming={bus230.incoming}
            mirror
            vsBusRef={vs230Ref}
            qvsLegRef={qvs230Ref}
            expandedEquip={expandedEquip}
            {...props}
          />
        )}
        {bus440 && (
          <LcsVoltageBoard
            bus={bus440}
            incoming={inline ? incoming ?? bus440.incoming : bus440.incoming}
            vsBusRef={vs440Ref}
            qvsLegRef={qvs440Ref}
            expandedEquip={expandedEquip}
            {...props}
          />
        )}
      </div>
    </div>
  )
}
