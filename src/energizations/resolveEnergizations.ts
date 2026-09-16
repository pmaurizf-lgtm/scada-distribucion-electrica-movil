import type { DistributionData } from '../types'
import { isAux24Feed } from '../utils/cascadeModel'
import type { EnergizationEntry, EnergizationImportStats } from './types'

function normCode(raw: string): string {
  return raw.trim().toUpperCase()
}

export function resolveEnergizations(
  data: DistributionData,
  entries: EnergizationEntry[],
): {
  energizedCircuitIds: Set<string>
  deadCircuitIds: Set<string>
  energizedEquipmentIds: Set<string>
  stats: EnergizationImportStats
} {
  const byRef = new Map<string, string>()
  for (const c of data.circuits) {
    if (!c.circuitRef) continue
    byRef.set(normCode(c.circuitRef), c.id)
  }

  const energizedCircuitIds = new Set<string>()
  const deadCircuitIds = new Set<string>()
  const energizedEquipmentIds = new Set<string>()
  let matched = 0
  let energized = 0
  let dead = 0

  for (const entry of entries) {
    const circuitId = byRef.get(normCode(entry.cableCode))
    if (!circuitId) continue
    matched++
    if (entry.energized) {
      energizedCircuitIds.add(circuitId)
      deadCircuitIds.delete(circuitId)
      energized++
      const circuit = data.circuits.find((c) => c.id === circuitId)
      // AUX 24 V: el cable puede estar SI, pero no marca el equipo como energizado
      // (solo NORM / ALT de potencia resaltan el chasis).
      if (circuit && isAux24Feed(circuit)) continue
      if (entry.destinationId) {
        energizedEquipmentIds.add(entry.destinationId.trim())
      }
      if (circuit?.destinationId) {
        energizedEquipmentIds.add(circuit.destinationId)
      }
    } else {
      if (!energizedCircuitIds.has(circuitId)) {
        deadCircuitIds.add(circuitId)
      }
      dead++
    }
  }

  return {
    energizedCircuitIds,
    deadCircuitIds,
    energizedEquipmentIds,
    stats: {
      rowsRead: entries.length,
      matched,
      energized,
      dead,
      skippedUnknown: entries.length - matched,
    },
  }
}
