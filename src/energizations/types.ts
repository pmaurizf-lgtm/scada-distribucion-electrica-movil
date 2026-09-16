export type EnergizationEntry = {
  cableCode: string
  originId: string
  destinationId: string
  energized: boolean
}

export type EnergizationImportStats = {
  rowsRead: number
  matched: number
  energized: number
  dead: number
  skippedUnknown: number
}

export type EnergizationOverlayState = {
  active: boolean
  fileName: string | null
  notice: string | null
  stats: EnergizationImportStats | null
  revision: number
  energizedCircuitIds: Set<string>
  deadCircuitIds: Set<string>
  energizedEquipmentIds: Set<string>
}

export const EMPTY_ENERGIZATION_OVERLAY: EnergizationOverlayState = {
  active: false,
  fileName: null,
  notice: null,
  stats: null,
  revision: 0,
  energizedCircuitIds: new Set(),
  deadCircuitIds: new Set(),
  energizedEquipmentIds: new Set(),
}
