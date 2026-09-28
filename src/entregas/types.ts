export type EntregaEntry = {
  /** Texto original de la columna A (PUMA / DCP-10 / nombre). */
  equipmentRef: string
  /** Instalación completa (col. H · SI/NO). */
  installComplete: boolean
  /** Equipo entregado (col. Entregado si existe · SI/NO). */
  delivered: boolean
}

export type EntregaImportStats = {
  rowsRead: number
  matched: number
  incomplete: number
  complete: number
  delivered: number
  skippedUnknown: number
  /** Equipos nuevos o actualizados en este Excel. */
  upserted: number
  /** Total memorizado tras el merge. */
  totalStored: number
}

export type EntregaOverlayState = {
  enabled: boolean
  hasData: boolean
  fileName: string | null
  notice: string | null
  stats: EntregaImportStats | null
  revision: number
  /** equipment.id (PUMA) → flags */
  byEquipmentId: Map<
    string,
    { installComplete: boolean; delivered: boolean }
  >
}

export const EMPTY_ENTREGA_OVERLAY: EntregaOverlayState = {
  enabled: false,
  hasData: false,
  fileName: null,
  notice: null,
  stats: null,
  revision: 0,
  byEquipmentId: new Map(),
}
