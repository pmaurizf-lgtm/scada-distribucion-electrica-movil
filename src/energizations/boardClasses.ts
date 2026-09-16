import type { EnergizationOverlayState } from './types'

export function isBoardLayerVisible(
  overlay: EnergizationOverlayState,
): boolean {
  return overlay.enabled && overlay.hasData
}

export function legBoardClass(
  circuitId: string | undefined,
  overlay: EnergizationOverlayState,
): string {
  if (!isBoardLayerVisible(overlay) || !circuitId) return ''
  if (overlay.energizedCircuitIds.has(circuitId)) {
    return ' hbus-drop__leg--board-live'
  }
  return ' hbus-drop__leg--board-dead'
}

export function eqBoardClass(
  equipmentId: string,
  overlay: EnergizationOverlayState,
): string {
  if (!isBoardLayerVisible(overlay)) return ''
  return overlay.energizedEquipmentIds.has(equipmentId)
    ? ' hbus-drop__eq--board-live equip-chassis--board-live'
    : ''
}

export function boardBreakerFlags(
  circuitId: string | undefined,
  overlay: EnergizationOverlayState,
): { boardLive: boolean; boardDead: boolean } {
  if (!isBoardLayerVisible(overlay) || !circuitId) {
    return { boardLive: false, boardDead: false }
  }
  const boardLive = overlay.energizedCircuitIds.has(circuitId)
  return {
    boardLive,
    boardDead: !boardLive,
  }
}
