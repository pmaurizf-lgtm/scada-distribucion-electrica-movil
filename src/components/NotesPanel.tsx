import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNotes } from '../notes/NotesContext'
import { exportNotesExcel } from '../notes/exportExcel'
import {
  isNoteFullyResolved,
  noteHasOpenLines,
  noteTargetKey,
  openLineCount,
  type InspectionNote,
  type NoteTarget,
} from '../notes'
import { vesselById } from '../vessels/vesselCatalog'
import { useUserProfile } from '../notes/UserProfileContext'
import { useIsMobileUi } from '../hooks/useIsMobileUi'
import { useAuth } from '../auth'

type Filter = 'open' | 'resolved' | 'all'
type DateSort = 'date-desc' | 'date-asc'

type NotesPanelProps = {
  open: boolean
  onClose: () => void
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-ES', {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

/** Día local YYYY-MM-DD a partir de createdAt ISO. */
function noteCreatedDay(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  } catch {
    return iso.slice(0, 10)
  }
}

function noteAuthorKey(n: InspectionNote): string {
  return (n.authorId || n.author || '').trim()
}

function syncHint(sync: {
  enabled: boolean
  state: string
  lastError: string | null
}): string {
  if (!sync.enabled) {
    return 'Este equipo guarda las notas en local. Configura Firebase para compartirlas.'
  }
  if (sync.state === 'offline') {
    return 'Sin red: las notas se enviarán al reconectar.'
  }
  if (sync.state === 'syncing') return 'Sincronizando notas…'
  if (sync.state === 'error') {
    return sync.lastError
      ? `No se pudo sincronizar: ${sync.lastError}`
      : 'No se pudo sincronizar.'
  }
  return 'Sincronizado. Las notas de este buque se ven en todos los equipos.'
}

type Group = {
  key: string
  target: NoteTarget
  label: string
  kind: string
  notes: InspectionNote[]
}

export function NotesPanel({ open, onClose }: NotesPanelProps) {
  const {
    vesselId,
    notes,
    openEditor,
    setLineResolved,
    exportNotesJson,
    importNotesJson,
    importNotesExcel,
    labelFor,
    kindLabelFor,
    sync,
  } = useNotes()
  const { ensureProfile, openProfilePrompt, displayName } = useUserProfile()
  const { isAdmin } = useAuth()
  const isMobile = useIsMobileUi()
  const [filter, setFilter] = useState<Filter>('open')
  const [dateSort, setDateSort] = useState<DateSort>('date-desc')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [authorFilter, setAuthorFilter] = useState('')
  const [equipQuery, setEquipQuery] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [ioOpen, setIoOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

  const authorOptions = useMemo(() => {
    const byKey = new Map<string, string>()
    for (const n of notes) {
      const key = noteAuthorKey(n)
      if (!key) continue
      if (!byKey.has(key)) byKey.set(key, n.author.trim() || key)
    }
    return [...byKey.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'))
  }, [notes])

  const hasExtraFilters = Boolean(
    dateFrom || dateTo || authorFilter || equipQuery.trim(),
  )

  const clearExtraFilters = () => {
    setDateFrom('')
    setDateTo('')
    setAuthorFilter('')
    setEquipQuery('')
  }

  const groups = useMemo(() => {
    const equipQ = equipQuery.trim().toLowerCase()
    const filtered = notes.filter((n) => {
      if (filter === 'open' && !noteHasOpenLines(n)) return false
      if (filter === 'resolved' && !isNoteFullyResolved(n)) return false
      if (authorFilter && noteAuthorKey(n) !== authorFilter) return false
      if (dateFrom || dateTo) {
        const day = noteCreatedDay(n.createdAt)
        if (dateFrom && day < dateFrom) return false
        if (dateTo && day > dateTo) return false
      }
      if (equipQ) {
        const label = labelFor(n.target).toLowerCase()
        const kind = kindLabelFor(n.target).toLowerCase()
        const id =
          n.target.kind === 'equipment'
            ? n.target.equipmentId.toLowerCase()
            : n.target.circuitId.toLowerCase()
        if (
          !label.includes(equipQ) &&
          !kind.includes(equipQ) &&
          !id.includes(equipQ)
        ) {
          return false
        }
      }
      return true
    })
    const map = new Map<string, Group>()
    for (const n of filtered) {
      const key = noteTargetKey(n.target)
      let g = map.get(key)
      if (!g) {
        g = {
          key,
          target: n.target,
          label: labelFor(n.target),
          kind: kindLabelFor(n.target),
          notes: [],
        }
        map.set(key, g)
      }
      g.notes.push(n)
    }
    const byDate = (a: InspectionNote, b: InspectionNote) =>
      dateSort === 'date-asc'
        ? a.createdAt.localeCompare(b.createdAt)
        : b.createdAt.localeCompare(a.createdAt)

    return [...map.values()]
      .map((g) => ({
        ...g,
        notes: [...g.notes].sort(byDate),
      }))
      .sort((a, b) => {
        const aDate = a.notes[0]?.createdAt ?? ''
        const bDate = b.notes[0]?.createdAt ?? ''
        if (aDate && bDate && aDate !== bDate) {
          return dateSort === 'date-asc'
            ? aDate.localeCompare(bDate)
            : bDate.localeCompare(aDate)
        }
        return a.label.localeCompare(b.label, 'es')
      })
  }, [
    notes,
    filter,
    dateSort,
    dateFrom,
    dateTo,
    authorFilter,
    equipQuery,
    labelFor,
    kindLabelFor,
  ])

  if (!open || typeof document === 'undefined') return null

  const vesselLabel = vesselById(vesselId).label
  const openBullets = notes.reduce((sum, n) => sum + openLineCount(n), 0)

  const handleExportExcel = async () => {
    if (exporting) return
    setExporting(true)
    setStatus('Generando Excel…')
    try {
      await exportNotesExcel(vesselId, notes)
      setStatus(
        `Excel listo: ${notes.length} nota${notes.length === 1 ? '' : 's'} de ${vesselLabel}.`,
      )
    } catch (err) {
      setStatus(
        err instanceof Error ? err.message : 'No se pudo generar el Excel.',
      )
    } finally {
      setExporting(false)
    }
  }

  const handleExportJson = () => {
    const json = exportNotesJson()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `notas-${vesselId}-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setStatus(`JSON exportado: ${notes.length} notas de ${vesselLabel}.`)
  }

  const handleRestoreExcel = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setStatus('Restaurando desde Excel y subiendo a la nube…')
    try {
      const data = await file.arrayBuffer()
      const result = await importNotesExcel(data)
      setStatus(
        `Restaurado y sincronizado: +${result.added} nuevas, ${result.updated} recuperadas/actualizadas, ${result.skipped} omitidas.`,
      )
    } catch (err) {
      setStatus(
        err instanceof Error ? err.message : 'No se pudo leer el Excel de notas.',
      )
    }
  }

  const handleImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const result = importNotesJson(text)
      setStatus(
        `Importación: +${result.added} nuevas, ${result.updated} actualizadas, ${result.skipped} omitidas.`,
      )
    } catch (err) {
      setStatus(
        err instanceof Error ? err.message : 'No se pudo importar el archivo.',
      )
    }
  }

  return createPortal(
    <div
      className={`notes-modal-backdrop${isMobile ? ' notes-modal-backdrop--mobile' : ''}`}
      role="presentation"
      onClick={onClose}
    >
      <div
        className={`notes-modal notes-modal--panel${isMobile ? ' notes-modal--mobile' : ''}`}
        role="dialog"
        aria-labelledby="notes-panel-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <header className="notes-modal__header">
          <div>
            <p className="notes-modal__kicker">{vesselLabel}</p>
            <h2 id="notes-panel-title" className="notes-modal__title">
              Notas de revisión
            </h2>
            <p className="notes-modal__hint">
              {openBullets} abierta{openBullets === 1 ? '' : 's'}
              {displayName ? ` · ${displayName}` : ''}
            </p>
            {!isMobile && (
              <p className="notes-modal__hint notes-panel__sync-hint">
                {syncHint(sync)}
                {sync.enabled ? (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="notes-panel__sync-now"
                      onClick={() => sync.syncNow()}
                    >
                      Actualizar
                    </button>
                  </>
                ) : null}
              </p>
            )}
          </div>
          <button
            type="button"
            className="notes-modal__close"
            aria-label="Cerrar"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="notes-panel__toolbar">
          <div className="notes-panel__filters-row">
            <div
              className="notes-panel__filters"
              role="group"
              aria-label="Estado"
            >
              {(
                [
                  ['open', 'Abiertas'],
                  ['resolved', 'Resueltas'],
                  ['all', 'Todas'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`btn${filter === id ? ' btn--active' : ''}`}
                  onClick={() => setFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div
              className="notes-panel__sort"
              role="group"
              aria-label="Ordenar por fecha"
            >
              <span className="notes-panel__sort-label">Por fecha</span>
              {(
                [
                  ['date-desc', 'Más recientes'],
                  ['date-asc', 'Más antiguas'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`btn${dateSort === id ? ' btn--active' : ''}`}
                  onClick={() => setDateSort(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div
            className="notes-panel__filters-extra"
            role="group"
            aria-label="Filtros de notas"
          >
            <label className="notes-panel__filter-field">
              <span>Desde</span>
              <input
                type="date"
                className="notes-panel__filter-input"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </label>
            <label className="notes-panel__filter-field">
              <span>Hasta</span>
              <input
                type="date"
                className="notes-panel__filter-input"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </label>
            <label className="notes-panel__filter-field">
              <span>Usuario</span>
              <select
                className="notes-panel__filter-input"
                value={authorFilter}
                onChange={(e) => setAuthorFilter(e.target.value)}
              >
                <option value="">Todos</option>
                {authorOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="notes-panel__filter-field notes-panel__filter-field--grow">
              <span>Equipo</span>
              <input
                type="search"
                className="notes-panel__filter-input"
                placeholder="Equipo o interruptor…"
                value={equipQuery}
                onChange={(e) => setEquipQuery(e.target.value)}
                autoComplete="off"
              />
            </label>
            {hasExtraFilters && (
              <button
                type="button"
                className="btn notes-panel__filter-clear"
                onClick={clearExtraFilters}
              >
                Limpiar
              </button>
            )}
          </div>
          <div className="notes-panel__io">
            <div className="notes-panel__io-excel">
              <button
                type="button"
                className="btn btn--active"
                disabled={exporting}
                onClick={() => void handleExportExcel()}
              >
                {exporting ? 'Generando…' : 'Exportar Excel'}
              </button>
              {isAdmin && (
                <label
                  className="btn notes-panel__file-btn"
                  title="Recupera notas desde un Excel exportado con Exportar Excel (solo admin)"
                >
                  Restaurar Excel…
                  <input
                    type="file"
                    accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={(e) => void handleRestoreExcel(e)}
                  />
                </label>
              )}
            </div>
            {isMobile && sync.enabled && (
              <button
                type="button"
                className="btn"
                onClick={() => sync.syncNow()}
              >
                Actualizar
              </button>
            )}
            {isMobile && (
              <button
                type="button"
                className="btn"
                aria-expanded={ioOpen}
                onClick={() => setIoOpen((v) => !v)}
              >
                {ioOpen ? 'Ocultar opciones' : 'Más…'}
              </button>
            )}
            {(!isMobile || ioOpen) && (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    openProfilePrompt(
                      'Edita el nombre que firmará las notas.',
                    )
                  }
                >
                  Usuario
                </button>
                {isAdmin && (
                  <button type="button" className="btn" onClick={handleExportJson}>
                    Exportar JSON
                  </button>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => importRef.current?.click()}
                  >
                    Importar…
                  </button>
                )}
              </>
            )}
            {isAdmin && (
              <input
                ref={importRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={handleImport}
              />
            )}
          </div>
        </div>

        {status && <p className="notes-panel__status">{status}</p>}

        <div className="notes-panel__body">
          {groups.length === 0 ? (
            <p className="notes-panel__empty">
              {hasExtraFilters
                ? 'Ninguna nota coincide con los filtros. Prueba a ampliar fechas, usuario o equipo.'
                : `No hay notas ${
                    filter === 'open'
                      ? 'con líneas abiertas'
                      : filter === 'resolved'
                        ? 'totalmente resueltas'
                        : ''
                  } en este buque. Ábrelas desde el globo de un equipo o interruptor.`}
            </p>
          ) : (
            groups.map((g) => (
              <section key={g.key} className="notes-panel__group">
                <header className="notes-panel__group-head">
                  <span className="notes-panel__group-kind">{g.kind}</span>
                  <h3 className="notes-panel__group-title">{g.label}</h3>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      if (!ensureProfile()) return
                      openEditor({ target: g.target, createNew: true })
                    }}
                  >
                    + Nota
                  </button>
                </header>
                <ul className="notes-panel__items">
                  {g.notes.map((n) => (
                    <li
                      key={n.id}
                      className={`notes-panel__note-block${
                        isNoteFullyResolved(n)
                          ? ' notes-panel__note-block--resolved'
                          : ''
                      }`}
                    >
                      <div className="notes-panel__note-meta">
                        <span>
                          {n.author} · {formatDate(n.createdAt)}
                        </span>
                        <button
                          type="button"
                          className="notes-panel__edit"
                          onClick={() => {
                            if (!ensureProfile()) return
                            openEditor({ target: n.target, noteId: n.id })
                            onClose()
                          }}
                        >
                          Editar
                        </button>
                      </div>
                      <ul className="notes-panel__bullets">
                        {n.lines.map((line) => (
                          <li
                            key={line.id}
                            className={`notes-panel__bullet${
                              line.resolved
                                ? ' notes-panel__bullet--resolved'
                                : ''
                            }`}
                          >
                            <label className="notes-panel__bullet-check">
                              <input
                                type="checkbox"
                                checked={line.resolved}
                                onChange={(e) => {
                                  e.stopPropagation()
                                  setLineResolved(
                                    n.id,
                                    line.id,
                                    e.target.checked,
                                  )
                                }}
                                aria-label={
                                  line.resolved
                                    ? 'Marcar línea como abierta'
                                    : 'Marcar línea como resuelta'
                                }
                              />
                              <span>
                                {line.text}
                                {line.resolved && line.resolvedBy
                                  ? ` · ${line.resolvedBy}`
                                  : ''}
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
