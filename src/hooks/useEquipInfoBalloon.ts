import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'

const DEFAULT_HOVER_MS = 1800
const LONG_PRESS_MS = 1000
const LONG_PRESS_MOVE_PX = 10
const ZOOM_LOCK_MS = 500

export const SCADA_BREAKER_HOVER = 'scada-breaker-hover'
export const SCADA_EQUIP_BALLOON_OPEN = 'scada-equip-balloon-open'

export function yieldEquipBalloonToBreaker() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(SCADA_BREAKER_HOVER))
}

export function yieldCircuitBalloonToEquip() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(SCADA_EQUIP_BALLOON_OPEN))
}

function isCoarsePointer(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(pointer: coarse)').matches
  )
}

function isBreakerTarget(t: EventTarget | null): boolean {
  return t instanceof Element && Boolean(t.closest('.casc-brk'))
}

const EQUIP_HIT =
  '.hbus-drop__eq, .equip-chassis__label, .stree-eq, .hbus-drop__csb-src'

function findEquipUnderPointer(x: number, y: number): HTMLElement | null {
  const stack = document.elementsFromPoint(x, y)
  if (stack.length === 0) return null
  const top = stack[0]
  if (
    top.closest(
      '.casc-brk, .circuit-balloon, .equip-balloon--portal, .notes-modal, .notes-modal-backdrop',
    )
  ) {
    return null
  }
  for (const el of stack) {
    const hit = el.closest(EQUIP_HIT)
    if (hit instanceof HTMLElement) return hit
  }
  return null
}

type EquipHoverWatch = {
  root: () => HTMLElement | null
  isSticky: () => boolean
  arm: () => void
  disarm: () => void
}

const watches = new Set<EquipHoverWatch>()
let docBound = false
let zoomLockUntil = 0
let lastPtr = { x: 0, y: 0 }
let zoomUnlockTimer: number | null = null

function watchOwnsHit(root: HTMLElement, hit: HTMLElement | null) {
  if (!hit) return false
  return root === hit || root.contains(hit) || hit.contains(root)
}

function isOverWatch(
  root: HTMLElement,
  target: EventTarget | null,
  hit: HTMLElement | null,
): boolean {
  if (isBreakerTarget(target)) return false
  if (target instanceof Node && root.contains(target)) return true
  if (watchOwnsHit(root, hit)) return true
  try {
    return root.matches(':hover')
  } catch {
    return false
  }
}

function syncWatchesAtPointer(x: number, y: number, target: EventTarget | null) {
  const hit = isBreakerTarget(target) ? null : findEquipUnderPointer(x, y)
  for (const w of watches) {
    if (w.isSticky()) continue
    const root = w.root()
    if (!root) continue
    if (isOverWatch(root, target, hit)) w.arm()
    else w.disarm()
  }
}

function onDocumentPointerMove(e: PointerEvent) {
  if (e.pointerType === 'touch') return
  lastPtr = { x: e.clientX, y: e.clientY }
  if (performance.now() < zoomLockUntil) return
  syncWatchesAtPointer(e.clientX, e.clientY, e.target)
}

function onDocumentWheel() {
  zoomLockUntil = performance.now() + ZOOM_LOCK_MS
  for (const w of watches) {
    if (!w.isSticky()) w.disarm()
  }
  if (zoomUnlockTimer != null) window.clearTimeout(zoomUnlockTimer)
  zoomUnlockTimer = window.setTimeout(() => {
    zoomUnlockTimer = null
    if (performance.now() < zoomLockUntil) return
    const el = document.elementFromPoint(lastPtr.x, lastPtr.y)
    syncWatchesAtPointer(lastPtr.x, lastPtr.y, el)
  }, ZOOM_LOCK_MS + 20)
}

function bindDocumentHover() {
  if (docBound || typeof window === 'undefined') return
  docBound = true
  window.addEventListener('pointermove', onDocumentPointerMove, {
    passive: true,
  })
  window.addEventListener('wheel', onDocumentWheel, { passive: true, capture: true })
}

/**
 * Globo de equipo:
 * - Ratón/lápiz: 1,8 s con el puntero sobre el recuadro (mismo criterio que el interruptor).
 * - La rueda de zoom no abre ni mantiene el globo.
 * - Táctil: pulsación larga (~1 s).
 */
export function useEquipInfoBalloon(delayMs = DEFAULT_HOVER_MS) {
  const [show, setShow] = useState(false)
  const [sheet, setSheet] = useState(false)
  const timer = useRef<number | null>(null)
  const sticky = useRef(false)
  const rootRef = useRef<HTMLElement | null>(null)
  const longPressTimer = useRef<number | null>(null)
  const pressOrigin = useRef<{ x: number; y: number } | null>(null)
  const longPressFired = useRef(false)

  const clearTimer = useCallback(() => {
    if (timer.current != null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    pressOrigin.current = null
  }, [])

  const close = useCallback(() => {
    clearTimer()
    clearLongPress()
    sticky.current = false
    setShow(false)
    setSheet(false)
  }, [clearTimer, clearLongPress])

  const openSticky = useCallback(
    (asSheet: boolean) => {
      clearTimer()
      clearLongPress()
      sticky.current = true
      setSheet(asSheet)
      setShow(true)
      yieldCircuitBalloonToEquip()
      window.dispatchEvent(new CustomEvent('scada-canvas-interact'))
    },
    [clearTimer, clearLongPress],
  )

  const armHover = useCallback(() => {
    if (sticky.current) return
    if (performance.now() < zoomLockUntil) return
    if (timer.current != null) return
    timer.current = window.setTimeout(() => openSticky(false), delayMs)
  }, [delayMs, openSticky])

  const disarmHover = useCallback(() => {
    if (sticky.current) return
    clearTimer()
  }, [clearTimer])

  useEffect(() => {
    bindDocumentHover()
    const watch: EquipHoverWatch = {
      root: () => rootRef.current,
      isSticky: () => sticky.current,
      arm: armHover,
      disarm: disarmHover,
    }
    watches.add(watch)
    return () => {
      watches.delete(watch)
      clearTimer()
      clearLongPress()
    }
  }, [armHover, disarmHover, clearTimer, clearLongPress])

  useEffect(() => {
    const onBreakerHover = () => {
      clearTimer()
      if (sticky.current) close()
    }
    window.addEventListener(SCADA_BREAKER_HOVER, onBreakerHover)
    return () => window.removeEventListener(SCADA_BREAKER_HOVER, onBreakerHover)
  }, [clearTimer, close])

  useEffect(() => {
    if (!show) return

    const onPointerDown = (e: PointerEvent) => {
      const t = e.target
      if (!(t instanceof Element)) return
      if (t.closest('.equip-balloon--portal')) return
      if (t.closest('.notes-modal-backdrop') || t.closest('.notes-modal')) return
      if (rootRef.current && rootRef.current.contains(t)) return
      close()
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [show, close])

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.pointerType === 'mouse' || e.pointerType === 'pen') return
      if (e.button !== 0) return
      longPressFired.current = false
      pressOrigin.current = { x: e.clientX, y: e.clientY }
      clearLongPress()
      longPressTimer.current = window.setTimeout(() => {
        longPressTimer.current = null
        longPressFired.current = true
        openSticky(true)
        try {
          if (navigator.vibrate) navigator.vibrate(12)
        } catch {
          /* ignore */
        }
      }, LONG_PRESS_MS)
    },
    [clearLongPress, openSticky],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!pressOrigin.current || longPressTimer.current == null) return
      const dx = e.clientX - pressOrigin.current.x
      const dy = e.clientY - pressOrigin.current.y
      if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_PX) {
        clearLongPress()
      }
    },
    [clearLongPress],
  )

  const onPointerUp = useCallback(() => {
    clearLongPress()
  }, [clearLongPress])

  const onPointerCancel = useCallback(() => {
    clearLongPress()
  }, [clearLongPress])

  const onClick = useCallback(
    (e: { stopPropagation?: () => void; preventDefault?: () => void }) => {
      if (!isCoarsePointer()) return
      if (longPressFired.current) {
        e.preventDefault?.()
        e.stopPropagation?.()
        longPressFired.current = false
      }
    },
    [],
  )

  const onContextMenu = useCallback((e: ReactMouseEvent) => {
    if (isCoarsePointer()) e.preventDefault()
  }, [])

  const onMouseEnter = useCallback(() => {
    if (isCoarsePointer()) return
    armHover()
  }, [armHover])

  const onMouseLeave = useCallback(
    (e: ReactMouseEvent) => {
      if (isCoarsePointer()) return
      const related = e.relatedTarget
      if (
        related instanceof Element &&
        related.closest('.equip-balloon--portal')
      ) {
        return
      }
      disarmHover()
    },
    [disarmHover],
  )

  const setAnchorEl = useCallback((el: HTMLElement | null) => {
    rootRef.current = el
  }, [])

  const bind = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClick,
    onContextMenu,
    onMouseEnter,
    onMouseLeave,
  }

  return {
    show,
    sheet,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClick,
    bind,
    setAnchorEl,
    close,
  }
}
