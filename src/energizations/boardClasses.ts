import type { EnergizationOverlayState } from './types'

export function legBoardClass(
  circuitId: string | undefined,
  overlay: EnergizationOverlayState,
): string {
  if (!overlay.active || !circuitId) return ''
  if (overlay.energizedCircuitIds.has(circuitId)) {
    return ' hbus-drop__leg--board-live'
  }
  if (overlay.deadCircuitIds.has(circuitId)) {
    return ' hbus-drop__leg--board-dead'
  }
  return ''
}

export function eqBoardClass(
  equipmentId: string,
  overlay: EnergizationOverlayState,
): string {
  if (!overlay.active) return ''
  return overlay.energizedEquipmentIds.has(equipmentId)
    ? ' hbus-drop__eq--board-live equip-chassis--board-live'
    : ''
}

export function boardBreakerFlags(
  circuitId: string | undefined,
  overlay: EnergizationOverlayState,
): { boardLive: boolean; boardDead: boolean } {
  if (!overlay.active || !circuitId) {
    return { boardLive: false, boardDead: false }
  }
  return {
    boardLive: overlay.energizedCircuitIds.has(circuitId),
    boardDead: overlay.deadCircuitIds.has(circuitId),
  }
}
