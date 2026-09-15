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
import { forceRefreshApp } from '../registerPwa'

type Filter = 'open' | 'resolved' | 'all'

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
  const isMobile = useIsMobileUi()
  const [filter, setFilter] = useState<Filter>('open')
  const [status, setStatus] = useState<string | null>(null)
  const [ioOpen, setIoOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

  const groups = useMemo(() => {
    const filtered = notes.filter((n) => {
      if (filter === 'open') return noteHasOpenLines(n)
      if (filter === 'resolved') return isNoteFullyResolved(n)
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
    return [...map.values()]
      .map((g) => ({
        ...g,
        notes: [...g.notes].sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        ),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'))
  }, [notes, filter, labelFor, kindLabelFor])

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
          <div className="notes-panel__filters" role="group" aria-label="Filtro">
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
              <label
                className="btn notes-panel__file-btn"
                title="Recupera notas desde un Excel exportado con Exportar Excel"
              >
                {isMobile ? 'Restaurar notas…' : 'Restaurar Excel…'}
                <input
                  type="file"
                  accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(e) => void handleRestoreExcel(e)}
                />
              </label>
            </div>
            {isMobile && (
              <button
                type="button"
                className="btn"
                onClick={() => void forceRefreshApp()}
              >
                Actualizar app
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
                <button type="button" className="btn" onClick={handleExportJson}>
                  Exportar JSON
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => importRef.current?.click()}
                >
                  Importar…
                </button>
              </>
            )}
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={handleImport}
            />
          </div>
        </div>

        {status && <p className="notes-panel__status">{status}</p>}

        <div className="notes-panel__body">
          {groups.length === 0 ? (
            <p className="notes-panel__empty">
              No hay notas{' '}
              {filter === 'open'
                ? 'con viñetas abiertas'
                : filter === 'resolved'
                  ? 'totalmente resueltas'
                  : ''}{' '}
              en este buque. Ábrelas desde el globo de un equipo o interruptor.
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
                                    ? 'Marcar viñeta como abierta'
                                    : 'Marcar viñeta como resuelta'
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
