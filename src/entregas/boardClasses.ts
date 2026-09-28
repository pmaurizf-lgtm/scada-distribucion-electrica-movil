import type { EntregaOverlayState } from './types'

export function isEntregaLayerVisible(overlay: EntregaOverlayState): boolean {
  return overlay.enabled && overlay.hasData
}

/**
 * Clases para el marco del equipo (.hbus-drop__eq / .equip-chassis).
 * Semáforo: rojo = incompleta · ámbar = completa · verde = entregado
 * (una sola luz encendida; entregado tiene prioridad).
 */
export function eqEntregaClass(
  equipmentId: string,
  overlay: EntregaOverlayState,
): string {
  if (!isEntregaLayerVisible(overlay)) return ''
  const flags = overlay.byEquipmentId.get(equipmentId)
  if (!flags) return ''
  if (flags.delivered) {
    return ' hbus-drop__eq--entrega-done equip-chassis--entrega-done'
  }
  if (flags.installComplete) {
    return ' hbus-drop__eq--entrega-ok equip-chassis--entrega-ok'
  }
  return ' hbus-drop__eq--entrega-ko equip-chassis--entrega-ko'
}
