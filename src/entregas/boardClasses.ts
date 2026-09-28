import type { EntregaOverlayState } from './types'

export type EntregaState = 'ko' | 'ok' | 'done'

export function isEntregaLayerVisible(overlay: EntregaOverlayState): boolean {
  return overlay.enabled && overlay.hasData
}

/**
 * Estado visual del semáforo:
 * entregado → verde · instalación completa → ámbar · incompleta → rojo
 */
export function eqEntregaState(
  equipmentId: string,
  overlay: EntregaOverlayState,
): EntregaState | null {
  if (!isEntregaLayerVisible(overlay)) return null
  const flags = overlay.byEquipmentId.get(equipmentId)
  if (!flags) return null
  if (flags.delivered) return 'done'
  if (flags.installComplete) return 'ok'
  return 'ko'
}

/** @deprecated Preferir `<EntregaSemaforo />`; se mantiene por compat. */
export function eqEntregaClass(
  equipmentId: string,
  overlay: EntregaOverlayState,
): string {
  const state = eqEntregaState(equipmentId, overlay)
  if (!state) return ''
  if (state === 'done') {
    return ' hbus-drop__eq--entrega-done equip-chassis--entrega-done'
  }
  if (state === 'ok') {
    return ' hbus-drop__eq--entrega-ok equip-chassis--entrega-ok'
  }
  return ' hbus-drop__eq--entrega-ko equip-chassis--entrega-ko'
}
