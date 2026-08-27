'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
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
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm">
        {!isEditing && (
          <>
            <span className="opacity-70">Current certificate level:</span>
            <span className="font-medium">{currentLevel ?? 'Not set'}</span>
          </>
        )}
        <button
          aria-label={isEditing ? 'Close certificate level editor' : 'Edit certificate level'}
          className="rounded p-1 opacity-70 hover:opacity-100"
          onClick={toggleEditing}
          type="button"
        >
          <Pencil size={14} />
        </button>
      </div>
      {isEditing && (
        <form className="flex max-w-sm flex-col gap-2" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1 text-sm" htmlFor="certificate-level">
            Current certificate level
            <select
              className="rounded border border-black/20 px-3 py-1.5 text-sm dark:border-white/25"
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
            className="self-start rounded border border-black/20 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/25"
            disabled={isPending || selected === ''}
            type="submit"
          >
            {isPending ? 'Saving…' : 'Save'}
          </button>
          <p aria-live="polite" className="text-sm text-red-600 dark:text-red-400">
            {status.kind === 'error' && status.message}
          </p>
          <p className="text-sm opacity-70">Self-declared, unverified.</p>
        </form>
      )}
    </div>
  )
}
