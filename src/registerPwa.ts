import { registerSW } from 'virtual:pwa-register'

/** Intervalo de sondeo de una nueva versión (ms). */
const UPDATE_CHECK_MS = 60 * 1000

/** Flag de sesión: tras reload por SW, mostrar aviso breve. */
export const PWA_UPDATED_FLAG = 'scada-f110-pwa-just-updated'

const PWA_RELOADING = 'scada-f110-pwa-reloading'

/**
 * GitHub Pages cachea sw.js (max-age=600). fetch + cache: 'no-store'
 * antes de registration.update() evita que el HTTP cache sirva el SW viejo.
 */
async function pingSwScript(swUrl: string): Promise<boolean> {
  if (!navigator.onLine) return false
  const resp = await fetch(swUrl, {
    cache: 'no-store',
    headers: {
      cache: 'no-store',
      'cache-control': 'no-cache',
    },
  })
  return resp.ok
}

function markUpdatedAndReload() {
  try {
    sessionStorage.setItem(PWA_UPDATED_FLAG, '1')
    sessionStorage.setItem(PWA_RELOADING, '1')
  } catch {
    /* ignore */
  }
  window.location.reload()
}

/**
 * Borra SW + caches + IndexedDB (Firestore) + localStorage de notas y recarga.
 * Para móvil atrapado en build o caché de notas incompleta.
 */
export async function forceRefreshApp(): Promise<void> {
  try {
    sessionStorage.setItem(PWA_UPDATED_FLAG, '1')
  } catch {
    /* ignore */
  }
  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch {
    /* ignore */
  }
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
  } catch {
    /* ignore */
  }
  try {
    const idb = indexedDB as IDBFactory & {
      databases?: () => Promise<{ name?: string }[]>
    }
    if (typeof idb.databases === 'function') {
      const dbs = await idb.databases()
      await Promise.all(
        dbs
          .map((d) => d.name)
          .filter((n): n is string => Boolean(n))
          .map(
            (name) =>
              new Promise<void>((resolve) => {
                const req = indexedDB.deleteDatabase(name)
                req.onsuccess = () => resolve()
                req.onerror = () => resolve()
                req.onblocked = () => resolve()
              }),
          ),
      )
    }
  } catch {
    /* ignore */
  }
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)
      if (k && (k.startsWith('scada-vessel-') || k.includes('firebase'))) {
        keys.push(k)
      }
    }
    for (const k of keys) localStorage.removeItem(k)
  } catch {
    /* ignore */
  }
  const url = new URL(window.location.href)
  url.searchParams.set('_scada_refresh', String(Date.now()))
  window.location.replace(url.toString())
}

/** Etiqueta corta del build publicado (GitHub SHA o fecha local). */
export function appBuildLabel(): string {
  const v = import.meta.env.VITE_APP_BUILD
  if (typeof v === 'string' && v.trim()) {
    return v.trim().slice(0, 7)
  }
  return 'dev'
}

/**
 * PWA: al publicar un build nuevo, el service worker (skipWaiting + clientsClaim)
 * toma el control y la página se recarga sola — al abrir la app, al volver a
 * primer plano o al recuperar red.
 */
export function registerPwa(): void {
  if (!('serviceWorker' in navigator)) return

  let reloading = false
  let justReloaded = false
  try {
    justReloaded = sessionStorage.getItem(PWA_RELOADING) === '1'
    if (justReloaded) {
      window.setTimeout(() => {
        try {
          sessionStorage.removeItem(PWA_RELOADING)
        } catch {
          /* ignore */
        }
      }, 2500)
    }
    const url = new URL(window.location.href)
    if (url.searchParams.has('_scada_refresh')) {
      url.searchParams.delete('_scada_refresh')
      window.history.replaceState({}, '', url.pathname + url.search + url.hash)
    }
  } catch {
    /* ignore */
  }

  const updateSW = registerSW({
    immediate: true,
    onNeedReload() {
      if (reloading || justReloaded) return
      reloading = true
      markUpdatedAndReload()
    },
    onRegisteredSW(swUrl, registration) {
      if (!registration) return

      const checkForUpdate = () => {
        void (async () => {
          try {
            if (registration.waiting) {
              registration.waiting.postMessage({ type: 'SKIP_WAITING' })
              updateSW(true)
              return
            }
            const fresh = await pingSwScript(swUrl)
            if (fresh) await registration.update()
          } catch {
            /* ignore */
          }
        })()
      }

      checkForUpdate()
      window.setInterval(checkForUpdate, UPDATE_CHECK_MS)

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate()
      })
      window.addEventListener('pageshow', checkForUpdate)
      window.addEventListener('online', checkForUpdate)
    },
  })

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || justReloaded) return
    reloading = true
    markUpdatedAndReload()
  })
}

export function consumePwaUpdatedFlag(): boolean {
  try {
    if (sessionStorage.getItem(PWA_UPDATED_FLAG) !== '1') return false
    sessionStorage.removeItem(PWA_UPDATED_FLAG)
    return true
  } catch {
    return false
  }
}
