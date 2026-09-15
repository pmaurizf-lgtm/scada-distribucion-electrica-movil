import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { useNotes } from '../notes/NotesContext'
import {
  createLineId,
  isNoteFullyResolved,
  noteHasOpenLines,
  openLineCount,
  type InspectionNote,
  type NoteLine,
} from '../notes'
import { useUserProfile } from '../notes/UserProfileContext'
import { useIsMobileUi } from '../hooks/useIsMobileUi'

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

function emptyLine(): NoteLine {
  return { id: createLineId(), text: '', resolved: false }
}

export function NoteEditorModal() {
  const {
    editor,
    closeEditor,
    notesFor,
    createNote,
    updateNote,
    setLineResolved,
    deleteNote,
    canDeleteNote,
    canEditNote,
    labelFor,
    kindLabelFor,
    openEditor,
  } = useNotes()
  const { ensureProfile, displayName } = useUserProfile()
  const isMobile = useIsMobileUi()
  const [listOpen, setListOpen] = useState(false)

  const targetNotes = useMemo(
    () => (editor ? notesFor(editor.target) : []),
    [editor, notesFor],
  )

  const activeNote: InspectionNote | null = useMemo(() => {
    if (!editor) return null
    if (editor.createNew) return null
    if (editor.noteId) {
      return targetNotes.find((n) => n.id === editor.noteId) ?? null
    }
    return targetNotes[0] ?? null
  }, [editor, targetNotes])

  const [draftLines, setDraftLines] = useState<NoteLine[]>([emptyLine()])
  const [draftMode, setDraftMode] = useState(false)

  useEffect(() => {
    if (isMobile) setListOpen(false)
  }, [editor?.target, editor?.noteId, editor?.createNew, isMobile])

  useEffect(() => {
    if (!editor) return
    if (!displayName && !ensureProfile()) return
    if (editor.createNew || !activeNote) {
      setDraftMode(true)
      setDraftLines([emptyLine()])
      return
    }
    setDraftMode(false)
    setDraftLines(
      activeNote.lines.length > 0
        ? activeNote.lines.map((l) => ({ ...l }))
        : [emptyLine()],
    )
    // Solo al cambiar de nota / sesión; no al marcar una viñeta (evita pisar texto).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [
    editor?.createNew,
    editor?.noteId,
    editor?.target,
    activeNote?.id,
    displayName,
    ensureProfile,
  ])

  if (!editor || typeof document === 'undefined') return null

  const title = labelFor(editor.target)
  const kind = kindLabelFor(editor.target)
  const ownsActive = activeNote ? canEditNote(activeNote) : true
  const canRemoveActive = activeNote ? canDeleteNote(activeNote) : false

  const setLineText = (lineId: string, text: string) => {
    setDraftLines((prev) =>
      prev.map((l) => (l.id === lineId ? { ...l, text } : l)),
    )
  }

  const toggleLine = (lineId: string, resolved: boolean) => {
    setDraftLines((prev) =>
      prev.map((l) =>
        l.id === lineId
          ? {
              ...l,
              resolved,
              resolvedAt: resolved ? new Date().toISOString() : undefined,
            }
          : l,
      ),
    )
    if (!draftMode && activeNote) {
      setLineResolved(activeNote.id, lineId, resolved)
    }
  }

  const addLine = () => {
    setDraftLines((prev) => [...prev, emptyLine()])
  }

  const removeLine = (lineId: string) => {
    setDraftLines((prev) => {
      const next = prev.filter((l) => l.id !== lineId)
      return next.length > 0 ? next : [emptyLine()]
    })
  }

  const save = () => {
    if (!ensureProfile()) return
    if (activeNote && !draftMode && !ownsActive) return
    const cleaned = draftLines
      .map((l) => ({
        ...l,
        text: l.text.replace(/^\s*[•\-\*]\s*/, '').trim(),
      }))
      .filter((l) => l.text.length > 0)

    if (draftMode || !activeNote) {
      const created = createNote(editor.target, cleaned)
      if (created) {
        openEditor({ target: editor.target, noteId: created.id })
      }
      return
    }
    updateNote(activeNote.id, { lines: cleaned })
  }

  const startNew = () => {
    if (!ensureProfile()) return
    openEditor({ target: editor.target, createNew: true })
  }

  const onLineKeyDown = (
    e: KeyboardEvent<HTMLInputElement>,
    lineId: string,
    index: number,
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const fresh = emptyLine()
      setDraftLines((prev) => {
        const next = [...prev]
        next.splice(index + 1, 0, fresh)
        return next
      })
      requestAnimationFrame(() => {
        document
          .getElementById(`note-line-${fresh.id}`)
          ?.querySelector<HTMLInputElement>('input[type="text"]')
          ?.focus()
      })
      return
    }
    if (e.key === 'Backspace') {
      const line = draftLines.find((l) => l.id === lineId)
      if (line && line.text === '' && draftLines.length > 1) {
        e.preventDefault()
        removeLine(lineId)
      }
    }
  }

  return createPortal(
    <div
      className={`notes-modal-backdrop${isMobile ? ' notes-modal-backdrop--mobile' : ''}`}
      role="presentation"
      onClick={closeEditor}
    >
      <div
        className={`notes-modal notes-modal--editor${isMobile ? ' notes-modal--mobile' : ''}`}
        role="dialog"
        aria-labelledby="note-editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="notes-modal__header">
          <div>
            <p className="notes-modal__kicker">
              Nota de revisión · {kind}
            </p>
            <h2 id="note-editor-title" className="notes-modal__title">
              {title}
            </h2>
          </div>
          <button
            type="button"
            className="notes-modal__close"
            aria-label="Cerrar"
            onClick={closeEditor}
          >
            ×
          </button>
        </header>

        <div className="notes-modal__scroll">
          {targetNotes.length > 0 && (
            <div className="note-editor__list-wrap">
              {isMobile && (
                <button
                  type="button"
                  className="btn note-editor__list-toggle"
                  aria-expanded={listOpen}
                  onClick={() => setListOpen((v) => !v)}
                >
                  {listOpen ? 'Ocultar notas' : `Otras notas (${targetNotes.length})`}
                </button>
              )}
              {(!isMobile || listOpen) && (
                <div className="note-editor__list" role="list">
                  {targetNotes.map((n) => {
                    const open = openLineCount(n)
                    return (
                      <button
                        key={n.id}
                        type="button"
                        role="listitem"
                        className={`note-editor__list-item${
                          !draftMode && activeNote?.id === n.id
                            ? ' note-editor__list-item--on'
                            : ''
                        }${isNoteFullyResolved(n) ? ' note-editor__list-item--resolved' : ''}`}
                        onClick={() => {
                          openEditor({ target: editor.target, noteId: n.id })
                          if (isMobile) setListOpen(false)
                        }}
                      >
                        <span>
                          {formatDate(n.createdAt)} · {n.author}
                        </span>
                        <span className="note-editor__list-meta">
                          {open === 0 && n.lines.length > 0
                            ? 'Todas resueltas'
                            : `${open} abierta${open === 1 ? '' : 's'}`}
                          {' · '}
                          {n.lines.length} viñeta
                          {n.lines.length === 1 ? '' : 's'}
                        </span>
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    className="btn note-editor__new"
                    onClick={startNew}
                  >
                    + Nueva nota
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="note-editor__meta">
            {draftMode || !activeNote ? (
              <p>
                <strong>Nueva nota</strong> · la fecha y el autor se fijan al
                guardar
              </p>
            ) : (
              <p>
                Creada: <strong>{formatDate(activeNote.createdAt)}</strong>
                {' · '}
                Autor: <strong>{activeNote.author}</strong>
                {noteHasOpenLines(activeNote)
                  ? ` · ${openLineCount(activeNote)} abierta(s)`
                  : ' · todas resueltas'}
                {!ownsActive
                  ? ' · Solo el autor puede editar o borrar; tú puedes marcar viñetas.'
                  : ''}
              </p>
            )}
          </div>

          <p className="notes-modal__label">
            Viñetas (marca cada una al resolverla)
          </p>
          <ul className="note-editor__lines">
            {draftLines.map((line, index) => (
              <li
                key={line.id}
                id={`note-line-${line.id}`}
                className={`note-editor__line${
                  line.resolved ? ' note-editor__line--resolved' : ''
                }`}
              >
                <label className="note-editor__line-check">
                  <input
                    type="checkbox"
                    checked={line.resolved}
                    onChange={(e) => toggleLine(line.id, e.target.checked)}
                    aria-label="Marcar viñeta como resuelta"
                  />
                </label>
                <span className="note-editor__bullet" aria-hidden>
                  •
                </span>
                <input
                  type="text"
                  className="note-editor__line-input"
                  value={line.text}
                  placeholder="Texto de la viñeta…"
                  enterKeyHint="next"
                  autoComplete="off"
                  autoCorrect="on"
                  readOnly={Boolean(activeNote && !draftMode && !ownsActive)}
                  onChange={(e) => setLineText(line.id, e.target.value)}
                  onKeyDown={(e) => onLineKeyDown(e, line.id, index)}
                />
                {(!activeNote || draftMode || ownsActive) && (
                <button
                  type="button"
                  className="note-editor__line-remove"
                  title="Quitar viñeta"
                  aria-label="Quitar viñeta"
                  onClick={() => removeLine(line.id)}
                >
                  ×
                </button>
                )}
              </li>
            ))}
          </ul>
          <div className="note-editor__add-row">
            {(!activeNote || draftMode || ownsActive) && (
              <button type="button" className="btn" onClick={addLine}>
                + Viñeta
              </button>
            )}
            {isMobile && targetNotes.length === 0 && (
              <button type="button" className="btn" onClick={startNew}>
                + Nueva nota
              </button>
            )}
          </div>
        </div>

        <div className="notes-modal__actions notes-modal__actions--sticky">
          {activeNote && !draftMode && canRemoveActive && (
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                if (
                  window.confirm(
                    '¿Eliminar esta nota de revisión? Desaparecerá en todos los móviles al sincronizar.',
                  )
                ) {
                  if (!deleteNote(activeNote.id)) {
                    window.alert(
                      'No se pudo eliminar: solo el autor de la nota puede borrarla (mismo perfil).',
                    )
                    return
                  }
                  if (targetNotes.length <= 1) closeEditor()
                  else openEditor({ target: editor.target, createNew: true })
                }
              }}
            >
              Eliminar
            </button>
          )}
          <div className="notes-modal__actions-right">
            <button type="button" className="btn" onClick={closeEditor}>
              Cerrar
            </button>
            {(draftMode || !activeNote || ownsActive) && (
              <button type="button" className="btn btn--active" onClick={save}>
                Guardar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
