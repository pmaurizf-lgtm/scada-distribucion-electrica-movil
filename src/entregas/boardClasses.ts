import type { EntregaOverlayState } from './types'

export function isEntregaLayerVisible(overlay: EntregaOverlayState): boolean {
  return overlay.enabled && overlay.hasData
}

/**
 * Clases para el marco del equipo (.hbus-drop__eq / .equip-chassis).
 * Rojo = instalación incompleta · naranja = completa · verde = entregado.
 */
export function eqEntregaClass(
  equipmentId: string,
  overlay: EntregaOverlayState,
): string {
  if (!isEntregaLayerVisible(overlay)) return ''
  const flags = overlay.byEquipmentId.get(equipmentId)
  if (!flags) return ''
  const parts: string[] = []
  if (flags.installComplete) {
    parts.push(
      'hbus-drop__eq--entrega-ok',
      'equip-chassis--entrega-ok',
    )
  } else {
    parts.push(
      'hbus-drop__eq--entrega-ko',
      'equip-chassis--entrega-ko',
    )
  }
  if (flags.delivered) {
    parts.push(
      'hbus-drop__eq--entrega-done',
      'equip-chassis--entrega-done',
    )
  }
  return parts.length ? ` ${parts.join(' ')}` : ''
}
