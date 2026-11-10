'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { Pencil } from 'lucide-react'

type EditableValueRowProps = {
  label: string
  value: ReactNode
  editLabel: string
  // Toggle mode only: the pencil's aria-label while the editor is open.
  closeLabel?: string
  isEditing: boolean
  // Default mode: true replaces the row with `children`. Ignored in toggle mode.
  showForm?: boolean
  onEdit: () => void
  // Toggle mode keeps the row (and its pencil) visible while editing and renders `children` below it.
  toggle?: boolean
  // Rendered directly under the row/form block, above `feedback`.
  note?: ReactNode
  feedback?: ReactNode
  // The form. Must contain the field as a descendant `input` or `select` to receive focus on open.
  children: ReactNode
}

const FIRST_FIELD = 'form input:not(:disabled), form select:not(:disabled)'

export function EditableValueRow({
  label,
  value,
  editLabel,
  closeLabel,
  isEditing,
  showForm = false,
  onEdit,
  toggle = false,
  note,
  feedback,
  children,
}: EditableValueRowProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const pencilRef = useRef<HTMLButtonElement>(null)
  const isFormVisible = toggle ? isEditing : showForm
  const isRowVisible = toggle || !showForm
  // Start equal to the initial values so a form shown on first mount does not steal focus.
  const wasEditing = useRef(isEditing)
  const wasRowVisible = useRef(isRowVisible)

  useEffect(() => {
    const opened = isEditing && !wasEditing.current
    const closed = !isEditing && wasEditing.current
    // A form open on first mount closes by the row reappearing (isEditing never changed).
    const rowReappeared = isRowVisible && !wasRowVisible.current
    wasEditing.current = isEditing
    wasRowVisible.current = isRowVisible
    if (opened) wrapperRef.current?.querySelector<HTMLElement>(FIRST_FIELD)?.focus()
    else if (closed || rowReappeared) pencilRef.current?.focus()
  }, [isEditing, isRowVisible])

  return (
    <div ref={wrapperRef} className="flex max-w-sm flex-col gap-2">
      {isRowVisible && (
        <div className="flex items-center gap-2 text-sm">
          {!(toggle && isEditing) && (
            <>
              <span className="opacity-70">{label}</span>
              <span className="font-medium">{value}</span>
            </>
          )}
          <button
            aria-label={toggle && isEditing ? closeLabel : editLabel}
            className="rounded p-1 opacity-70 hover:opacity-100"
            onClick={onEdit}
            ref={pencilRef}
            type="button"
          >
            <Pencil size={14} />
          </button>
        </div>
      )}
      {isFormVisible && children}
      {note}
      {feedback}
    </div>
  )
}
