import { useLayoutEffect, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Circuit, Equipment } from '../types'
import { originLabel } from '../utils/cascadeModel'
import { labelSecondaryDenom } from '../utils/equipmentLabels'
import { useNotesOptional } from '../notes'
import { requestOpenNotes } from '../notes/openNotesEvent'

const KIND_LABEL: Record<Equipment['kind'], string> = {
  generador: 'Generador',
  conversion: 'Conversión',
  cuadro_principal: 'Cuadro principal',
  cuadro_secundario: 'Cuadro secundario',
  consumidor: 'Consumidor',
}

function fmt(n: number | null | undefined, unit: string, digits = 2) {
  if (n == null || Number.isNaN(n)) return null
  return `${n.toFixed(digits)} ${unit}`
}

interface EquipmentBalloonProps {
  equipment: Equipment
  feeds?: { name: string; lineType: string; originId: string }[]
  /** Circuito(s) de alimentación: P/Q/S/In/servicio como en el MSB */
  circuits?: Circuit[]
  /** Ancla del hover (botón/caja del equipo) */
  anchorRef: RefObject<HTMLElement | null>
  /** Hoja inferior solo en pulsación larga táctil; el hover de escritorio ancla al recuadro. */
  sheet?: boolean
}

export function EquipmentBalloon({
  equipment,
  feeds,
  circuits,
  anchorRef,
  sheet = false,
}: EquipmentBalloonProps) {
  const notesApi = useNotesOptional()
  const asSheet = sheet
  const noteTarget = { kind: 'equipment' as const, equipmentId: equipment.id }
  const openNotesCount = notesApi?.openCountFor(noteTarget) ?? 0
  const [pos, setPos] = useState<{
    left: number
    top: number
    place: 'above' | 'below' | 'sheet'
  } | null>(null)
  const primary = circuits?.[0]

  useLayoutEffect(() => {
    const update = () => {
      if (asSheet) {
        setPos({ left: 0, top: 0, place: 'sheet' })
        return
      }
      const el = anchorRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      if (r.width < 1 && r.height < 1) return
      const margin = 12
      const halfW = 140
      const preferAboveH = 200
      let place: 'above' | 'below' = 'above'
      let top = r.top - 10
      if (r.top < preferAboveH + margin) {
        place = 'below'
        top = r.bottom + 10
      }
      const left = Math.min(
        Math.max(r.left + r.width / 2, margin + halfW),
        window.innerWidth - margin - halfW,
      )
      setPos({ left, top, place })
    }

    update()
    const raf1 = window.requestAnimationFrame(() => {
      update()
      window.requestAnimationFrame(update)
    })
    const stage = anchorRef.current?.closest('.casc__stage--pan')
    stage?.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    window.addEventListener('wheel', update, { passive: true, capture: true })
    return () => {
      window.cancelAnimationFrame(raf1)
      stage?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('wheel', update, true)
    }
  }, [anchorRef, equipment.id, asSheet])

  if (!pos || typeof document === 'undefined') return null

  const p = fmt(primary?.pKWe, 'kWe')
  const q = fmt(primary?.qKVAr, 'kVAr')
  const s = fmt(primary?.sKVA, 'kVA')
  const ib = fmt(primary?.ibA, 'A')
  const pn = fmt(primary?.pnKW, 'kW')
  const inA =
    primary?.protectionCurrentA != null
      ? `${primary.protectionCurrentA} A`
      : null
  const secondary = labelSecondaryDenom(equipment)

  const openNotes = (e: { stopPropagation: () => void; preventDefault?: () => void }) => {
    e.stopPropagation()
    e.preventDefault?.()
    if (notesApi) {
      notesApi.openEditor({ target: noteTarget })
    } else {
      requestOpenNotes(noteTarget)
    }
  }

  return createPortal(
    <div
      className={`equip-balloon equip-balloon--portal equip-balloon--${pos.place}${
        asSheet ? ' equip-balloon--mobile' : ''
      }`}
      style={
        pos.place === 'sheet'
          ? undefined
          : { left: pos.left, top: pos.top }
      }
      role="dialog"
      aria-label={`Equipo ${equipment.id}`}
    >
      <header className="equip-balloon__header">
        <div className="equip-balloon__header-main">
          <span className="equip-balloon__kicker">Equipo</span>
          <strong className="equip-balloon__title">{equipment.id}</strong>
          {secondary && (
            <span className="equip-balloon__dcp">{secondary.value}</span>
          )}
        </div>
        <button
          type="button"
          className="btn equip-balloon__notes-btn equip-balloon__notes-btn--header"
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={openNotes}
        >
          Notas
          {openNotesCount > 0 ? (
            <span
              className="notes-badge"
              aria-label={`${openNotesCount} abiertas`}
            >
              {openNotesCount}
            </span>
          ) : null}
        </button>
      </header>
      <div className="equip-balloon__body">
      <dl className="equip-balloon__kv">
        <dt>PUMA</dt>
        <dd>{equipment.id}</dd>
        {secondary && (
          <>
            <dt>{secondary.kind === 'nme674' ? 'NME-674' : 'DCP-10'}</dt>
            <dd className="equip-balloon__dcp-dd">{secondary.value}</dd>
          </>
        )}
        <dt>Nombre</dt>
        <dd>{equipment.name}</dd>
        <dt>Tipo</dt>
        <dd>{KIND_LABEL[equipment.kind] ?? equipment.kind}</dd>
        <dt>Local</dt>
        <dd>
          {equipment.local?.trim() ? (
            <>
              {equipment.local}
              {equipment.localName?.trim() ? (
                <span className="equip-balloon__local-name">
                  {' '}
                  · {equipment.localName}
                </span>
              ) : null}
            </>
          ) : (
            '—'
          )}
        </dd>
        {equipment.voltage && (
          <>
            <dt>Tensión</dt>
            <dd>{equipment.voltage}</dd>
          </>
        )}
        {primary?.protectionName && (
          <>
            <dt>Protección</dt>
            <dd>{primary.protectionName}</dd>
          </>
        )}
        {primary?.protectionModel && (
          <>
            <dt>Modelo</dt>
            <dd>{primary.protectionModel}</dd>
          </>
        )}
        {inA && (
          <>
            <dt>In</dt>
            <dd>{inA}</dd>
          </>
        )}
        {ib && (
          <>
            <dt>Ib</dt>
            <dd>{ib}</dd>
          </>
        )}
        {p && (
          <>
            <dt>P</dt>
            <dd>{p}</dd>
          </>
        )}
        {q && (
          <>
            <dt>Q</dt>
            <dd>{q}</dd>
          </>
        )}
        {s && (
          <>
            <dt>S</dt>
            <dd>{s}</dd>
          </>
        )}
        {pn && (
          <>
            <dt>Pn</dt>
            <dd>{pn}</dd>
          </>
        )}
        {primary?.service && (
          <>
            <dt>Servicio</dt>
            <dd>
              <span className={`badge badge--svc-${primary.service}`}>
                {primary.service}
              </span>
            </dd>
          </>
        )}
        {primary?.circuitRef && (
          <>
            <dt>Ref. circuito</dt>
            <dd>{primary.circuitRef}</dd>
          </>
        )}
        {(primary?.parallelCables != null ||
          primary?.cableSection ||
          primary?.cableType ||
          primary?.cableLengthM != null) && (
          <>
            <dt>Cable</dt>
            <dd>
              {primary.parallelCables != null
                ? `${primary.parallelCables}×`
                : ''}
              {primary.cableSection ??
                (primary.parallelCables != null ? '' : '—')}
              {primary.cableSection &&
              !String(primary.cableSection).includes('mm')
                ? ' mm²'
                : ''}
            </dd>
          </>
        )}
        {primary?.cableType && (
          <>
            <dt>Tipo cable</dt>
            <dd>{primary.cableType}</dd>
          </>
        )}
        {primary?.cableLengthM != null && (
          <>
            <dt>Longitud</dt>
            <dd>{fmt(primary.cableLengthM, 'm', 1)}</dd>
          </>
        )}
        {primary?.cableWeightKg != null && (
          <>
            <dt>Peso cable</dt>
            <dd>{fmt(primary.cableWeightKg, 'kg', 1)}</dd>
          </>
        )}
        {equipment.description && (
          <>
            <dt>Descripción</dt>
            <dd>{equipment.description}</dd>
          </>
        )}
        {equipment.virtual && (
          <>
            <dt>Nota</dt>
            <dd>Nodo de barra (sintético)</dd>
          </>
        )}
        {equipment.spare && (
          <>
            <dt>Nota</dt>
            <dd>Interruptor de reserva (RESPETO · Excel col. L)</dd>
          </>
        )}
        {feeds && feeds.length > 0 && (
          <>
            <dt>Alimentaciones</dt>
            <dd>
              <ul className="equip-balloon__feeds">
                {feeds.map((f) => (
                  <li key={`${f.originId}-${f.name}`}>
                    <span
                      className={`badge badge--${f.lineType === 'alternativa' ? 'alternativa' : 'normal'}`}
                    >
                      {f.lineType === 'alternativa' ? 'ALT' : 'NORM'}
                    </span>{' '}
                    {f.name}
                    <span className="equip-balloon__from">
                      {' '}
                      ← {originLabel(f.originId)}
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
      </dl>
      </div>
      <footer className="equip-balloon__notes-foot">
        <button
          type="button"
          className="btn equip-balloon__notes-btn"
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={openNotes}
        >
          Notas de revisión
          {openNotesCount > 0 ? (
            <span
              className="notes-badge"
              aria-label={`${openNotesCount} abiertas`}
            >
              {openNotesCount}
            </span>
          ) : null}
        </button>
      </footer>
    </div>,
    document.body,
  )
}
