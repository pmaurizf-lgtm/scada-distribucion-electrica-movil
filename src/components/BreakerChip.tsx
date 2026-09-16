import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import type { Circuit, ProtectionState } from '../types'
import type { CircuitLockInfo } from '../utils/parseLocksExcel'
import { isMotorizedProtectionModel } from '../abtDownstream/ssbBoard'
import { useCircuitLockInfo } from '../locks/LockInfoContext'
import { yieldEquipBalloonToBreaker } from '../hooks/useEquipInfoBalloon'
import {
  boardBreakerFlags,
  useEnergizationOverlay,
} from '../energizations'
import {
  LockBadge,
  ManualBreakerSymbol,
  MotorizedBreakerSymbol,
} from './BreakerSymbols'

/** Interruptor unifilar (motorizado MSB o manual INS/NG125/iC60). */
export function BreakerChip({
  name,
  state,
  onClick,
  compact,
  circuitId,
  circuit,
  flowing,
  locked,
  lockInfo,
  title,
  orientation = 'vertical',
  motorized,
  onHoverInfo,
  onHoverInfoEnd,
  onLockInfo,
}: {
  name: string
  state?: ProtectionState
  onClick?: (e: ReactMouseEvent) => void
  compact?: boolean
  circuitId?: string
  /** Si se pasa, el globo de info aparece tras ~1,8 s de hover (no al pulsar) */
  circuit?: Circuit
  flowing?: boolean
  locked?: boolean
  /** Meta LOTO (nº candado); si no, se toma del contexto de candados. */
  lockInfo?: CircuitLockInfo | null
  title?: string
  orientation?: 'vertical' | 'horizontal'
  /** Forzar motorizado / manual; por defecto se deduce del modelo Excel. */
  motorized?: boolean
  onHoverInfo?: (circuit: Circuit, rect: DOMRect) => void
  onHoverInfoEnd?: () => void
  /** Clic en el símbolo de candado → globo con nº LOTO. */
  onLockInfo?: (info: CircuitLockInfo, rect: DOMRect) => void
}) {
  const boardOverlay = useEnergizationOverlay()
  const { boardLive, boardDead } = boardBreakerFlags(circuitId, boardOverlay)
  const lockCtx = useCircuitLockInfo()
  const resolvedLockInfo =
    lockInfo ??
    (circuitId ? lockCtx.byCircuitId[circuitId] : undefined) ??
    null
  const resolvedOnLockInfo = onLockInfo ?? lockCtx.onLockInfo

  const open = state !== 'cerrada'
  const hoverTimer = useRef<number | null>(null)
  const nativeHintTimer = useRef<number | null>(null)
  const [nativeHint, setNativeHint] = useState<string | undefined>()
  const isMotor =
    motorized ??
    isMotorizedProtectionModel(circuit?.protectionModel, name)
  /** Solo chips compactos con LOTO: alarga la pata IEC sin tocar QBT u horizontales. */
  const longFoot = Boolean(locked && compact && orientation === 'vertical')

  const clearHoverTimer = () => {
    if (hoverTimer.current != null) {
      window.clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
    if (nativeHintTimer.current != null) {
      window.clearTimeout(nativeHintTimer.current)
      nativeHintTimer.current = null
    }
  }

  useEffect(() => () => clearHoverTimer(), [])

  const kindLabel = isMotor ? 'motorizado' : 'no motorizado'
  const lockHint =
    locked && resolvedLockInfo?.lockNumber
      ? ` · candado nº ${resolvedLockInfo.lockNumber}`
      : locked
        ? ' · bloqueado'
        : ''
  const aria = `Interruptor ${kindLabel} ${name} · ${open ? 'abierto' : 'cerrado'}${lockHint}`
  /** Title nativo breve; se quita antes del globo de info para no taparlo. */
  const nativeTitle = onHoverInfo ? nativeHint : (title ?? aria)

  return (
    <button
      type="button"
      className={`casc-brk${state ? ` casc-brk--${state}` : ''}${compact ? ' casc-brk--compact' : ''}${flowing && !boardLive && !boardDead ? ' casc-brk--flow' : ''}${boardLive ? ' casc-brk--board-live' : ''}${boardDead ? ' casc-brk--board-dead' : ''}${locked ? ' casc-brk--locked' : ''}${orientation === 'horizontal' ? ' casc-brk--horizontal' : ''}${isMotor ? '' : ' casc-brk--manual'}`}
      onClick={onClick}
      title={nativeTitle}
      aria-label={aria}
      data-circuit-id={circuitId}
      onMouseEnter={(e) => {
        if (!circuit || !onHoverInfo) return
        clearHoverTimer()
        const el = e.currentTarget
        const hint = title ?? aria
        el.setAttribute('title', hint)
        setNativeHint(hint)
        nativeHintTimer.current = window.setTimeout(() => {
          el.removeAttribute('title')
          setNativeHint(undefined)
          nativeHintTimer.current = null
        }, 1100)
        hoverTimer.current = window.setTimeout(() => {
          el.removeAttribute('title')
          setNativeHint(undefined)
          yieldEquipBalloonToBreaker()
          onHoverInfo(circuit, el.getBoundingClientRect())
        }, 1800)
      }}
      onMouseLeave={() => {
        clearHoverTimer()
        setNativeHint(undefined)
        /* No cerrar el globo al salir: si aparece encima del chip, el
           mouseleave lo anulaba y peleaba con el globo del cuadro. */
      }}
    >
      <span className="casc-brk__sym">
        {isMotor ? (
          <MotorizedBreakerSymbol
            state={state}
            orientation={orientation}
            longFoot={longFoot}
          />
        ) : (
          <ManualBreakerSymbol
            state={state}
            orientation={orientation}
            longFoot={longFoot}
          />
        )}
      </span>
      {boardLive && (
        <span className="casc-brk__board-bolt" aria-hidden title="Energizado a bordo">
          ⚡
        </span>
      )}
      {locked && (
        <span
          className={`casc-brk__lock-hit${resolvedLockInfo && resolvedOnLockInfo ? ' casc-brk__lock-hit--clickable' : ''}`}
          title={
            resolvedLockInfo?.lockNumber
              ? `Candado nº ${resolvedLockInfo.lockNumber} — pulsa para ver ficha`
              : 'Candado'
          }
          onClick={(e) => {
            if (!resolvedLockInfo || !resolvedOnLockInfo) return
            e.preventDefault()
            e.stopPropagation()
            onHoverInfoEnd?.()
            resolvedOnLockInfo(
              resolvedLockInfo,
              e.currentTarget.getBoundingClientRect(),
            )
          }}
          onMouseDown={(e) => {
            if (resolvedLockInfo && resolvedOnLockInfo) e.stopPropagation()
          }}
        >
          <LockBadge />
        </span>
      )}
      <span className="casc-brk__name">{name}</span>
    </button>
  )
}
