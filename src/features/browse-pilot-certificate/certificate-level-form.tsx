'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveCertificateLevelAction } from './actions'
import { CERTIFICATE_LEVELS, type CertificateLevel } from '@/lib/certificates/types'

type CertificateLevelFormProps = {
  currentLevel: CertificateLevel | null
}

// Always shows the current value, editable — same convention as pilot-id-form.tsx's own
// "prefilled, always resubmittable" shape, rather than a separate first-declare vs. later-
// redeclare UI split.
export function CertificateLevelForm({ currentLevel }: CertificateLevelFormProps) {
  const router = useRouter()
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
        // The declared level drives server-computed content (the checklist in index.tsx) this
        // client component has no other way to refresh — router.refresh() re-runs the server
        // components on the next paint so the checklist below reflects the new level.
        router.refresh()
      } else {
        setStatus({ kind: 'error', message: result.message })
      }
    })
  }

  return (
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
      <p aria-live="polite" className="text-sm opacity-70">
        {status.kind === 'success' && 'Saved.'}
      </p>
      <p className="text-sm opacity-70">Self-declared, unverified.</p>
    </form>
  )
}
