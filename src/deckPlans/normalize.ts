/** Normalización y variantes de códigos de local (p. ej. 1-143-6-Q, 02-169-0-C). */

/** Cubierta (1–2 dígitos o I/L) · tramo · nivel (1–2 dígitos) · letra. */
const CODE_EXTRACT_RE =
  /([0-9IL]{1,2})-(\d{1,3})-(\d{1,2})-([A-Z0-9])/i

function stripLeadingZeros(n: string): string {
  const cleaned = n.replace(/O/gi, '0')
  const parsed = Number.parseInt(cleaned, 10)
  if (!Number.isFinite(parsed)) return cleaned
  return String(parsed)
}

/**
 * Forma canónica: sin ceros a la izquierda en cubierta/tramo/nivel
 * (`02-169-0-C` → `2-169-0-C`, `3-208-01-A` → `3-208-1-A`).
 */
export function normalizeLocalCode(
  raw: string | null | undefined,
): string | null {
  if (!raw?.trim()) return null
  const s = raw
    .trim()
    .toUpperCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, '')

  const m = CODE_EXTRACT_RE.exec(s)
  if (!m) return null

  let a = m[1]!.toUpperCase()
  if (a === 'I' || a === 'L') a = '1'
  a = stripLeadingZeros(a)
  if (!a || a === '0') return null

  const b = stripLeadingZeros(m[2]!)
  const c = stripLeadingZeros(m[3]!)
  const d = m[4]!.toUpperCase()
  if (!b || c === '' || !d) return null
  return `${a}-${b}-${c}-${d}`
}

/** Clave de almacenamiento / búsqueda (canónica o, si no parsea, texto limpio). */
export function localStorageKey(raw: string | null | undefined): string | null {
  const norm = normalizeLocalCode(raw)
  if (norm) return norm
  const fallback = raw
    ?.trim()
    .toUpperCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, '')
  return fallback || null
}

/** Variantes a probar en el índice OCR / Excel (ceros, I↔1, etc.). */
export function localLookupKeys(raw: string | null | undefined): string[] {
  const keys = new Set<string>()
  const norm = normalizeLocalCode(raw)
  if (norm) {
    keys.add(norm)
    const [a, b, c, d] = norm.split('-')
    if (a && b && c && d) {
      keys.add(`${a.padStart(2, '0')}-${b}-${c}-${d}`)
      keys.add(`${a}-${b}-${c.padStart(2, '0')}-${d}`)
      keys.add(`${a.padStart(2, '0')}-${b}-${c.padStart(2, '0')}-${d}`)
      if (a === '1') {
        keys.add(`I-${b}-${c}-${d}`)
        keys.add(`L-${b}-${c}-${d}`)
      }
    }
  }

  const rawKey = raw
    ?.trim()
    .toUpperCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, '')
  if (rawKey) {
    const head = CODE_EXTRACT_RE.exec(rawKey)
    if (head) {
      keys.add(
        `${head[1]!.toUpperCase()}-${head[2]}-${head[3]}-${head[4]!.toUpperCase()}`,
      )
    } else if (rawKey.length >= 3) {
      keys.add(rawKey.split(/[^0-9A-Z-]/i)[0] || rawKey)
    }
  }

  return [...keys].filter(Boolean)
}
