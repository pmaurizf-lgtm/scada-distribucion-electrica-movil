/** IDs de plano antiguos (hoja NNN) → ids con nombre legible. */
export const LEGACY_PLAN_IDS: Record<string, string> = {
  '000': 'cubierta-principal',
  '001': 'cubierta-2',
  '003': 'cubierta-3',
  '004': 'cubierta-4',
  '005': 'tanques',
  '006': 'cubierta-01',
  '007': 'cubierta-02',
  '008': 'cubiertas-03-07',
  '009': 'cubierta-08',
}

/**
 * Prefijo del local (antes del primer guion) → id de plano.
 * Conserva ceros a la izquierda: `1` ≠ `01`, `2` ≠ `02`.
 */
export const LOCAL_DECK_TO_PLAN_ID: Record<string, string> = {
  '1': 'cubierta-principal',
  I: 'cubierta-principal',
  L: 'cubierta-principal',
  '2': 'cubierta-2',
  '3': 'cubierta-3',
  '4': 'cubierta-4',
  '5': 'tanques',
  '01': 'cubierta-01',
  '02': 'cubierta-02',
  '03': 'cubiertas-03-07',
  '04': 'cubiertas-03-07',
  '05': 'cubiertas-03-07',
  '06': 'cubiertas-03-07',
  '07': 'cubiertas-03-07',
  '08': 'cubierta-08',
}

/** Extrae el segmento de cubierta del código de local (`01-131-1-Q` → `01`). */
export function localDeckPrefix(
  rawLocal: string | null | undefined,
): string | null {
  if (!rawLocal?.trim()) return null
  const s = rawLocal
    .trim()
    .toUpperCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, '')
  const m = /^([0-9IL]{1,2})(?=-|$)/i.exec(s)
  if (!m) return null
  let deck = m[1]!.toUpperCase()
  if (deck === 'I' || deck === 'L') deck = '1'
  return deck || null
}

/**
 * Plano de cubierta esperado según la cifra del local (antes del guion).
 * No elimina ceros: `1-…` → principal, `01-…` → cubierta 01.
 */
export function planIdFromLocalDeck(
  rawLocal: string | null | undefined,
): string | null {
  const deck = localDeckPrefix(rawLocal)
  if (!deck) return null
  return LOCAL_DECK_TO_PLAN_ID[deck] ?? null
}

export function migratePlanId(planId: string): string {
  return LEGACY_PLAN_IDS[planId] ?? planId
}

export function migrateHitPlanIds<T extends { planId: string }>(hit: T): T {
  return { ...hit, planId: migratePlanId(hit.planId) }
}
