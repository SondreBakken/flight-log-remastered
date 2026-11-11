'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { EditableValueRow } from '@/components/editable-value-row'
import { saveCertificateLevelAction } from './actions'
import { CERTIFICATE_LEVELS, type CertificateLevel } from '@/lib/certificates/types'

type CertificateLevelFormProps = {
  currentLevel: CertificateLevel | null
}

// Collapsed by default (plain text + an edit icon that toggles the form open), rather than
// always showing the select — this is the pilot page's own certificate card, not an account
// settings form, so it should read as a value with an edit affordance, not a form the owner
// has to dismiss mentally every time they view their own page.
export function CertificateLevelForm({ currentLevel }: CertificateLevelFormProps) {
  const router = useRouter()
  const [isEditing, setIsEditing] = useState(false)
  const [selected, setSelected] = useState(currentLevel ?? '')
  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState<{ kind: 'idle' } | { kind: 'success' } | { kind: 'error'; message: string }>({ kind: 'idle' })

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (selected === '') return
    const level = selected as CertificateLevel
    startTransition(async () => {
      const result = await saveCertificateLevelAction(level)
      if (result.status === 'success') {
        setStatus({ kind: 'success' })
        setIsEditing(false)
        // The declared level drives server-computed content (the checklist in index.tsx) this
        // client component has no other way to refresh — router.refresh() re-runs the server
        // components on the next paint so the checklist below reflects the new level.
        router.refresh()
      } else {
        setStatus({ kind: 'error', message: result.message })
      }
    })
  }

  function toggleEditing() {
    setSelected(currentLevel ?? '')
    setStatus({ kind: 'idle' })
    setIsEditing((editing) => !editing)
  }

  return (
    <EditableValueRow
      closeLabel="Close certificate level editor"
      editLabel="Edit certificate level"
      isEditing={isEditing}
      label="Current certificate level:"
      note={isEditing && <p className="text-sm opacity-70">Self-declared, unverified.</p>}
      onEdit={toggleEditing}
      toggle
      value={currentLevel ?? 'Not set'}
    >
      <form className="flex max-w-sm flex-col gap-2" onSubmit={handleSubmit}>
        <label className="flex flex-col gap-1 text-sm" htmlFor="certificate-level">
          Current certificate level
          <select
            className="rounded border border-frame px-3 py-1.5 text-sm"
            id="certificate-level"
            onChange={(event) => setSelected(event.target.value)}
            value={selected}
          >
            <option value="">Not set</option>
            {CERTIFICATE_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        <button
          className="self-start rounded border border-frame px-3 py-1.5 text-sm disabled:opacity-50"
          disabled={isPending || selected === ''}
          type="submit"
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
        <p aria-live="polite" className="text-sm text-red-600 dark:text-red-400">
          {status.kind === 'error' && status.message}
        </p>
      </form>
    </EditableValueRow>
  )
}
