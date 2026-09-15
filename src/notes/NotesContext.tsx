import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { VesselId } from '../vessels/vesselCatalog'
import { kindLabelForNoteTarget, labelForNoteTarget } from './labels'
import { SCADA_OPEN_NOTES_EVENT } from './openNotesEvent'
import {
  buildNotesExport,
  countOpenNotesForTarget,
  createNoteId,
  currentAuthor,
  isNoteAuthor,
  loadVesselNotes,
  mergeImportedNotes,
  notesForTarget,
  saveVesselNotes,
  visibleNotes,
} from './persistence'
import {
  coerceNoteLines,
  createLineId,
  normalizeNoteLinesFromText,
  type InspectionNote,
  type NoteLine,
  type NoteTarget,
} from './types'
import {
  useNotesCloudSync,
  type NotesSyncInfo,
} from './useNotesCloudSync'
import { mergeExcelNotes, parseNotesExcel } from './importExcel'

export type NotesEditorSession = {
  target: NoteTarget
  noteId?: string | null
  createNew?: boolean
}

type NotesContextValue = {
  vesselId: VesselId
  notes: InspectionNote[]
  editor: NotesEditorSession | null
  openEditor: (session: NotesEditorSession) => void
  closeEditor: () => void
  openCountFor: (target: NoteTarget) => number
  notesFor: (target: NoteTarget) => InspectionNote[]
  createNote: (
    target: NoteTarget,
    lines: string | NoteLine[],
  ) => InspectionNote | null
  updateNote: (
    id: string,
    patch: { lines: NoteLine[] },
  ) => void
  setLineResolved: (
    noteId: string,
    lineId: string,
    resolved: boolean,
  ) => void
  deleteNote: (id: string) => boolean
  canDeleteNote: (note: InspectionNote) => boolean
  canEditNote: (note: InspectionNote) => boolean
  exportNotesJson: () => string
  importNotesJson: (raw: string) => {
    added: number
    updated: number
    skipped: number
  }
  importNotesExcel: (data: ArrayBuffer) => Promise<{
    added: number
    updated: number
    skipped: number
    remoteVisible: number
  }>
  labelFor: (target: NoteTarget) => string
  kindLabelFor: (target: NoteTarget) => string
  sync: Omit<NotesSyncInfo, 'enqueuePush' | 'adoptAndPushAll'>
}

const NotesContext = createContext<NotesContextValue | null>(null)

export function NotesProvider({
  vesselId,
  children,
}: {
  vesselId: VesselId
  children: ReactNode
}) {
  const [allNotes, setAllNotes] = useState<InspectionNote[]>(() =>
    loadVesselNotes(vesselId),
  )
  const [editor, setEditor] = useState<NotesEditorSession | null>(null)
  const notes = useMemo(() => visibleNotes(allNotes), [allNotes])
  const {
    enqueuePush,
    adoptAndPushAll,
    enabled: syncEnabled,
    state: syncState,
    lastError: syncLastError,
    lastOkAt: syncLastOkAt,
    cloudVisible: syncCloudVisible,
    syncNow,
  } = useNotesCloudSync(vesselId, allNotes, setAllNotes)

  useEffect(() => {
    setAllNotes(loadVesselNotes(vesselId))
    setEditor(null)
  }, [vesselId])

  useEffect(() => {
    saveVesselNotes(vesselId, allNotes)
  }, [vesselId, allNotes])

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<NoteTarget>).detail
      if (!detail || typeof detail !== 'object') return
      if (detail.kind === 'circuit' && typeof detail.circuitId === 'string') {
        setEditor({ target: detail })
        return
      }
      if (
        detail.kind === 'equipment' &&
        typeof detail.equipmentId === 'string'
      ) {
        setEditor({ target: detail })
      }
    }
    window.addEventListener(SCADA_OPEN_NOTES_EVENT, onOpen)
    return () => window.removeEventListener(SCADA_OPEN_NOTES_EVENT, onOpen)
  }, [])

  const openEditor = useCallback((session: NotesEditorSession) => {
    setEditor(session)
  }, [])

  const closeEditor = useCallback(() => setEditor(null), [])

  const openCountFor = useCallback(
    (target: NoteTarget) => countOpenNotesForTarget(allNotes, target),
    [allNotes],
  )

  const notesFor = useCallback(
    (target: NoteTarget) => notesForTarget(allNotes, target),
    [allNotes],
  )

  const canEditNote = useCallback((note: InspectionNote) => {
    const who = currentAuthor()
    if (!who) return false
    return isNoteAuthor(note, who.authorId, who.author)
  }, [])

  const canDeleteNote = canEditNote

  const createNote = useCallback(
    (target: NoteTarget, lines: string | NoteLine[]): InspectionNote | null => {
      const who = currentAuthor()
      if (!who) return null
      const now = new Date().toISOString()
      const parsed =
        typeof lines === 'string'
          ? normalizeNoteLinesFromText(lines)
          : coerceNoteLines(lines)
      const note: InspectionNote = {
        id: createNoteId(),
        vesselId,
        target,
        author: who.author,
        authorId: who.authorId,
        createdAt: now,
        updatedAt: now,
        lines:
          parsed.length > 0
            ? parsed
            : [{ id: createLineId(), text: '', resolved: false }],
      }
      note.lines = note.lines
        .filter((l) => l.text.trim().length > 0)
        .map((l) => ({ ...l, textUpdatedAt: now }))
      if (note.lines.length === 0) {
        note.lines = [
          {
            id: createLineId(),
            text: '(sin texto)',
            resolved: false,
            textUpdatedAt: now,
          },
        ]
      }
      setAllNotes((prev) => [note, ...prev])
      enqueuePush(note.id, note)
      return note
    },
    [enqueuePush, vesselId],
  )

  const updateNote = useCallback(
    (id: string, patch: { lines: NoteLine[] }) => {
      const who = currentAuthor()
      const now = new Date().toISOString()
      let snapshot: InspectionNote | undefined
      setAllNotes((prev) =>
        prev.map((n) => {
          if (n.id !== id) return n
          if (who && !isNoteAuthor(n, who.authorId, who.author)) return n
          const prevById = new Map(n.lines.map((l) => [l.id, l]))
          const lines = coerceNoteLines(patch.lines)
            .filter((l) => l.text.trim().length > 0)
            .map((l) => {
              const old = prevById.get(l.id)
              const textChanged = !old || old.text !== l.text
              return {
                ...l,
                textUpdatedAt: textChanged ? now : old?.textUpdatedAt,
              }
            })
          snapshot = { ...n, updatedAt: now, lines }
          return snapshot
        }),
      )
      if (snapshot) enqueuePush(id, snapshot)
    },
    [enqueuePush],
  )

  const setLineResolved = useCallback(
    (noteId: string, lineId: string, resolved: boolean) => {
      const who = currentAuthor()
      const now = new Date().toISOString()
      let snapshot: InspectionNote | undefined
      setAllNotes((prev) =>
        prev.map((n) => {
          if (n.id !== noteId) return n
          snapshot = {
            ...n,
            updatedAt: now,
            lines: n.lines.map((l) =>
              l.id === lineId
                ? {
                    ...l,
                    resolved,
                    resolvedAt: resolved ? now : undefined,
                    resolvedBy: who?.author,
                    resolvedById: who?.authorId,
                    resolvedUpdatedAt: now,
                  }
                : l,
            ),
          }
          return snapshot
        }),
      )
      if (snapshot) enqueuePush(noteId, snapshot)
    },
    [enqueuePush],
  )

  const deleteNote = useCallback(
    (id: string) => {
      const who = currentAuthor()
      if (!who) return false
      const now = new Date().toISOString()
      const target = allNotes.find((n) => n.id === id)
      if (!target || !isNoteAuthor(target, who.authorId, who.author)) {
        return false
      }
      const deleted: InspectionNote = {
        ...target,
        deletedAt: now,
        updatedAt: now,
      }
      setAllNotes((prev) => prev.map((n) => (n.id === id ? deleted : n)))
      enqueuePush(id, deleted)
      return true
    },
    [allNotes, enqueuePush],
  )

  const exportNotesJson = useCallback(() => {
    return JSON.stringify(buildNotesExport(vesselId, notes), null, 2)
  }, [vesselId, notes])

  const importNotesJson = useCallback(
    (raw: string) => {
      const parsed: unknown = JSON.parse(raw)
      const result = mergeImportedNotes(vesselId, allNotes, parsed)
      setAllNotes(result.notes)
      void adoptAndPushAll(result.notes)
      return {
        added: result.added,
        updated: result.updated,
        skipped: result.skipped,
      }
    },
    [adoptAndPushAll, allNotes, vesselId],
  )

  const importNotesExcel = useCallback(
    async (data: ArrayBuffer) => {
      const parsed = await parseNotesExcel(data, vesselId)
      const result = mergeExcelNotes(vesselId, allNotes, parsed.notes)
      setAllNotes(result.notes)
      await adoptAndPushAll(result.notes)
      let remoteVisible = 0
      try {
        const { pullVesselNotes } = await import('./firebaseSync')
        const remote = await pullVesselNotes(vesselId)
        remoteVisible = remote.filter((n) => !n.deletedAt).length
      } catch {
        remoteVisible = -1
      }
      return {
        added: result.added,
        updated: result.updated,
        skipped: result.skipped,
        remoteVisible,
      }
    },
    [adoptAndPushAll, allNotes, vesselId],
  )

  const sync = useMemo(
    () => ({
      enabled: syncEnabled,
      state: syncState,
      lastError: syncLastError,
      lastOkAt: syncLastOkAt,
      cloudVisible: syncCloudVisible,
      syncNow,
    }),
    [
      syncEnabled,
      syncState,
      syncLastError,
      syncLastOkAt,
      syncCloudVisible,
      syncNow,
    ],
  )

  const value = useMemo<NotesContextValue>(
    () => ({
      vesselId,
      notes,
      editor,
      openEditor,
      closeEditor,
      openCountFor,
      notesFor,
      createNote,
      updateNote,
      setLineResolved,
      deleteNote,
      canDeleteNote,
      canEditNote,
      exportNotesJson,
      importNotesJson,
      importNotesExcel,
      labelFor: labelForNoteTarget,
      kindLabelFor: kindLabelForNoteTarget,
      sync,
    }),
    [
      vesselId,
      notes,
      editor,
      openEditor,
      closeEditor,
      openCountFor,
      notesFor,
      createNote,
      updateNote,
      setLineResolved,
      deleteNote,
      canDeleteNote,
      canEditNote,
      exportNotesJson,
      importNotesJson,
      importNotesExcel,
      sync,
    ],
  )

  return (
    <NotesContext.Provider value={value}>{children}</NotesContext.Provider>
  )
}

export function useNotes(): NotesContextValue {
  const ctx = useContext(NotesContext)
  if (!ctx) {
    throw new Error('useNotes debe usarse dentro de NotesProvider')
  }
  return ctx
}

export function useNotesOptional(): NotesContextValue | null {
  return useContext(NotesContext)
}
