import manifestJson from '../data/deckPlans/manifest.json'
import hitsJson from '../data/deckPlans/hits.json'
import overridesJson from '../data/deckPlans/overrides.json'
import { localLookupKeys, localStorageKey } from './normalize'
import type {
  DeckPlanHit,
  DeckPlanHitsFile,
  DeckPlanManifest,
  DeckPlanMeta,
} from './types'
import {
  isDeckPlanCloudConfigured,
  pushDeckPlanOverrides,
  type DeckPlanOverridesCloud,
} from './cloudSync'
import { migrateHitPlanIds, migratePlanId } from './planIds'

export type { DeckPlanHit, DeckPlanMeta, DeckPlanManifest, DeckPlanHitsFile }
export { normalizeLocalCode, localLookupKeys, localStorageKey } from './normalize'
export { migratePlanId, LEGACY_PLAN_IDS } from './planIds'
export {
  requestOpenDeckPlan,
  SCADA_OPEN_DECK_PLAN_EVENT,
  type OpenDeckPlanDetail,
} from './openDeckPlanEvent'

export const SCADA_DECK_PLAN_OVERRIDES_CHANGED = 'scada-deck-plan-overrides-changed'
export const SCADA_DECK_PLAN_OVERRIDE_SAVED = 'scada-deck-plan-override-saved'

const STORAGE_KEY = 'scada-deck-plan-overrides-v1'

const manifest = manifestJson as DeckPlanManifest
const hitsFile = hitsJson as DeckPlanHitsFile
const committedOverrides = overridesJson as DeckPlanHitsFile

export function listDeckPlans(): DeckPlanMeta[] {
  return manifest.plans ?? []
}

export function getDeckPlan(planId: string): DeckPlanMeta | undefined {
  return listDeckPlans().find((p) => p.id === planId)
}

/** URL relativa al base de Vite (public/). */
export function deckPlanImageUrl(plan: DeckPlanMeta): string {
  return `./deck-plans/${plan.file}`
}

function notifyOverridesChanged(): void {
  window.dispatchEvent(new CustomEvent(SCADA_DECK_PLAN_OVERRIDES_CHANGED))
}

export function readLocalOverrides(): Record<string, DeckPlanHit[]> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as DeckPlanHitsFile
    const locals: Record<string, DeckPlanHit[]> = {}
    for (const [k, list] of Object.entries(parsed.locals ?? {})) {
      locals[k] = (list ?? []).map(migrateHitPlanIds)
    }
    return locals
  } catch {
    return {}
  }
}

function writeLocalOverrides(locals: Record<string, DeckPlanHit[]>): void {
  if (typeof localStorage === 'undefined') return
  const payload: DeckPlanHitsFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    locals,
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  notifyOverridesChanged()
}

function hitStamp(h: DeckPlanHit): string {
  return h.updatedAt ?? ''
}

/** Fusiona dos mapas de hits; por planId gana el updatedAt más reciente (o el entrante si empate). */
export function mergeLocalsMaps(
  base: Record<string, DeckPlanHit[]>,
  incoming: Record<string, DeckPlanHit[]>,
): Record<string, DeckPlanHit[]> {
  const out: Record<string, DeckPlanHit[]> = {}
  const keys = new Set([...Object.keys(base), ...Object.keys(incoming)])
  for (const key of keys) {
    const byPlan = new Map<string, DeckPlanHit>()
    for (const h of base[key] ?? []) byPlan.set(h.planId, { ...h })
    for (const h of incoming[key] ?? []) {
      const prev = byPlan.get(h.planId)
      if (!prev || hitStamp(h) >= hitStamp(prev)) {
        byPlan.set(h.planId, { ...h })
      }
    }
    out[key] = [...byPlan.values()].sort((a, b) =>
      a.planId.localeCompare(b.planId),
    )
  }
  return out
}

/** Merge: OCR < overrides.json < localStorage (LWW por updatedAt cuando exista). */
export function hitsForLocal(rawLocal: string | null | undefined): DeckPlanHit[] {
  const keys = localLookupKeys(rawLocal)
  if (keys.length === 0) return []

  const byPlan = new Map<string, DeckPlanHit>()

  const absorb = (locals: Record<string, DeckPlanHit[]> | undefined) => {
    if (!locals) return
    for (const key of keys) {
      const list = locals[key]
      if (!list) continue
      for (const raw of list) {
        const h = migrateHitPlanIds(raw)
        const prev = byPlan.get(h.planId)
        if (!prev || hitStamp(h) >= hitStamp(prev)) {
          byPlan.set(h.planId, { ...h })
        } else if (!hitStamp(h) && !hitStamp(prev)) {
          byPlan.set(h.planId, { ...h })
        }
      }
    }
  }

  absorb(hitsFile.locals)
  absorb(committedOverrides.locals)
  absorb(readLocalOverrides())

  return [...byPlan.values()].sort((a, b) => a.planId.localeCompare(b.planId))
}

export function hasDeckPlanHits(rawLocal: string | null | undefined): boolean {
  return hitsForLocal(rawLocal).length > 0
}

export function getLocalOverridesSnapshot(): DeckPlanOverridesCloud {
  return {
    updatedAt: new Date().toISOString(),
    locals: readLocalOverrides(),
  }
}

/**
 * Adopta marcas remotas (Firestore) fusionándolas en localStorage.
 */
export function adoptRemoteOverrides(
  remoteLocals: Record<string, DeckPlanHit[]>,
  _remoteUpdatedAt?: string,
): void {
  const migrated: Record<string, DeckPlanHit[]> = {}
  for (const [k, list] of Object.entries(remoteLocals)) {
    migrated[k] = (list ?? []).map(migrateHitPlanIds)
  }
  const merged = mergeLocalsMaps(readLocalOverrides(), migrated)
  writeLocalOverrides(merged)
}

export async function publishLocalOverridesToCloud(
  snap?: DeckPlanOverridesCloud,
): Promise<void> {
  if (!isDeckPlanCloudConfigured() || !navigator.onLine) return
  const localSnap = snap ?? getLocalOverridesSnapshot()
  let remoteLocals: Record<string, DeckPlanHit[]> = {}
  try {
    const { pullDeckPlanOverrides } = await import('./cloudSync')
    const remote = await pullDeckPlanOverrides()
    remoteLocals = remote?.locals ?? {}
  } catch {
    remoteLocals = {}
  }
  const mergedLocals = mergeLocalsMaps(remoteLocals, localSnap.locals)
  const payload: DeckPlanOverridesCloud = {
    updatedAt: new Date().toISOString(),
    locals: mergedLocals,
  }
  writeLocalOverrides(mergedLocals)
  await pushDeckPlanOverrides(payload)
}

/**
 * Guarda la marca del local (localStorage) y dispara sync a la nube.
 * @returns false si el código de local no es usable.
 */
export function saveLocalOverrideHit(
  rawLocal: string,
  hit: DeckPlanHit,
): boolean {
  const norm = localStorageKey(rawLocal)
  if (!norm) return false
  const stamped: DeckPlanHit = {
    ...hit,
    planId: migratePlanId(hit.planId),
    updatedAt: hit.updatedAt ?? new Date().toISOString(),
    conf: hit.conf ?? 100,
  }
  const locals = { ...readLocalOverrides() }
  const list = [...(locals[norm] ?? [])]
  const i = list.findIndex((h) => h.planId === stamped.planId)
  if (i >= 0) list[i] = stamped
  else list.push(stamped)
  list.sort((a, b) => a.planId.localeCompare(b.planId))
  locals[norm] = list
  writeLocalOverrides(locals)
  window.dispatchEvent(
    new CustomEvent(SCADA_DECK_PLAN_OVERRIDE_SAVED, { detail: { local: norm } }),
  )
  return true
}

/** JSON listo para pegar en overrides.json (backup opcional). */
export function exportOverridesJson(): string {
  const local = readLocalOverrides()
  const merged = mergeLocalsMaps(committedOverrides.locals ?? {}, local)
  return JSON.stringify({ version: 1, locals: merged }, null, 2) + '\n'
}

export { STORAGE_KEY }
