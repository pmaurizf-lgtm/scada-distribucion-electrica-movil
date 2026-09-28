import { eqEntregaState, type EntregaState, useEntregaOverlay } from '../entregas'

const TITLE: Record<EntregaState, string> = {
  ko: 'Instalación incompleta',
  ok: 'Instalación completa',
  done: 'Equipo entregado',
}

type Props = {
  equipmentId: string
}

/** Semáforo compacto de estado entregas (esquina del recuadro). */
export function EntregaSemaforo({ equipmentId }: Props) {
  const overlay = useEntregaOverlay()
  const state = eqEntregaState(equipmentId, overlay)
  if (!state) return null
  return (
    <span
      className={`entrega-semaforo entrega-semaforo--${state}`}
      title={TITLE[state]}
      aria-label={TITLE[state]}
      role="img"
    >
      <span className="entrega-semaforo__lamp entrega-semaforo__lamp--r" />
      <span className="entrega-semaforo__lamp entrega-semaforo__lamp--y" />
      <span className="entrega-semaforo__lamp entrega-semaforo__lamp--g" />
    </span>
  )
}
