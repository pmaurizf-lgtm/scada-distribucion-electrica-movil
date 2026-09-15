import { system690 } from "../data/system690"
import type { DistributionData } from "../types"

/** En la app móvil la topología es la embebida (sin carga de Excel de circuitos). */
export function getTopology(): DistributionData {
  return system690
}
