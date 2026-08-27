'use client'

import { RotateCw } from 'lucide-react'
import { Callout } from '@/components/callout'

type ErrorPageProps = {
  error: Error & { digest?: string }
  reset: () => void
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  return (
    <Callout tone="error">
      <h2 className="text-lg font-semibold">Could not load this from flightlog.org</h2>
      <p className="text-sm opacity-80">{error.message}</p>
      <button
        className="flex items-center gap-1.5 rounded border border-black/20 px-3 py-1.5 text-sm dark:border-white/25"
        onClick={reset}
        type="button"
      >
        <RotateCw aria-hidden="true" size={14} />
        Try again
      </button>
    </Callout>
  )
}
