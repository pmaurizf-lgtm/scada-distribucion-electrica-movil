import type { Circuit, DistributionData, Equipment } from '../types'
import {
  incomingFeeds,
  isAux24Feed,
  isPendingFeed,
} from '../utils/cascadeModel'
import { filterUpstreamIncoming } from '../utils/upstream'

/** Un escalón de la cadena fuente → … → destino. */
export interface FeedChainHop {
  step: number
  equipmentId: string
  equipmentName: string
  local?: string
  /** Protección que alimenta este equipo desde el escalón anterior (`—` en la fuente). */
  protectionName: string
  circuitId?: string
  lineType?: 'normal' | 'alternativa' | 'aux'
}

export type FeedLineKind = 'normal' | 'alternativa' | 'aux'

function eqMap(data: DistributionData): Map<string, Equipment> {
  return new Map(data.equipment.map((e) => [e.id, e]))
}

function hopLineType(feed: Circuit): FeedChainHop['lineType'] {
  if (isAux24Feed(feed)) return 'aux'
  if (feed.lineType === 'alternativa' || isPendingFeed(feed)) return 'alternativa'
  return 'normal'
}

function pickFeed(
  feeds: Circuit[],
  prefer: FeedLineKind,
): Circuit | undefined {
  const real = feeds.filter((c) => !c.virtual)
  if (!real.length) return undefined

  if (prefer === 'aux') {
    return real.find((c) => isAux24Feed(c))
  }

  // Potencia: no mezclar AUX 24 V con Normal / Alternativa.
  const power = real.filter((c) => !isAux24Feed(c))
  if (!power.length) return undefined

  if (prefer === 'alternativa') {
    return (
      power.find((c) => c.lineType === 'alternativa') ??
      power.find((c) => isPendingFeed(c))
    )
  }

  const norms = power.filter(
    (c) => c.lineType === 'normal' && !isPendingFeed(c),
  )
  if (norms.length) return norms[0]
  return power.find((c) => !isPendingFeed(c)) ?? power[0]
}

/**
 * Cadena ordenada fuente → destino siguiendo preferencia NORM, ALT o AUX
 * en el primer salto; el resto aguas arriba prioriza alimentación normal.
 * Si se pide ALT/AUX y el destino no tiene esa acometida, devuelve [].
 */
export function buildOrderedFeedChain(
  destinationId: string,
  data: DistributionData,
  linePreference: FeedLineKind,
): FeedChainHop[] {
  const equipment = eqMap(data)

  type Node = { id: string; fedBy?: Circuit }
  const chainUp: Node[] = [{ id: destinationId }]

  let viaVoltage: string | null = null
  let atTarget = true
  let prefer = linePreference
  const seen = new Set<string>([destinationId])

  while (true) {
    const current = chainUp[chainUp.length - 1]!.id
    let incoming = incomingFeeds(data, current)
    if (!atTarget) {
      incoming = incoming.filter((c) => !isAux24Feed(c))
    }
    incoming = filterUpstreamIncoming(current, incoming, viaVoltage)

    const feed = pickFeed(incoming, prefer)
    if (!feed) {
      if (
        atTarget &&
        (linePreference === 'alternativa' || linePreference === 'aux')
      ) {
        return []
      }
      break
    }
    if (atTarget && linePreference === 'alternativa') {
      const isAlt =
        feed.lineType === 'alternativa' || isPendingFeed(feed)
      if (!isAlt) return []
    }
    if (atTarget && linePreference === 'aux' && !isAux24Feed(feed)) {
      return []
    }

    chainUp[chainUp.length - 1]!.fedBy = feed

    // Seguir el origen real (p. ej. SSB-24PWxxxx), no saltar al MSB-24:
    // el informe debe mostrar la acometida AUX completa.
    const nextId = feed.originId
    if (seen.has(nextId)) break
    seen.add(nextId)

    chainUp.push({ id: nextId })
    viaVoltage = feed.voltage ?? viaVoltage
    atTarget = false
    prefer = 'normal'
  }

  const ordered = [...chainUp].reverse()
  return ordered.map((node, i) => {
    const eq = equipment.get(node.id)
    const fedBy = node.fedBy
    return {
      step: i + 1,
      equipmentId: node.id,
      equipmentName: eq?.name ?? node.id,
      local: eq?.local,
      protectionName: fedBy?.protectionName?.trim() || '—',
      circuitId: fedBy?.id,
      lineType: fedBy == null ? undefined : hopLineType(fedBy),
    }
  })
}

export function formatChainArrow(hops: FeedChainHop[]): string {
  if (!hops.length) return '—'
  return hops
    .map((h, i) => {
      const loc = h.local?.trim() ? ` [${h.local.trim()}]` : ''
      if (i === 0) return `${h.equipmentId}${loc}`
      const prot =
        h.protectionName && h.protectionName !== '—'
          ? ` —${h.protectionName}→ `
          : ' → '
      return `${prot}${h.equipmentId}${loc}`
    })
    .join('')
}

export function feedLineLabel(kind: FeedLineKind): string {
  if (kind === 'alternativa') return 'Alternativa'
  if (kind === 'aux') return 'AUX 24 V'
  return 'Normal'
}
