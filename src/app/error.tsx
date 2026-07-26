'use client'

type ErrorPageProps = {
  error: Error & { digest?: string }
  reset: () => void
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-md border border-red-500/30 bg-red-500/5 p-6">
      <h2 className="text-lg font-semibold">Could not load this from flightlog.org</h2>
      <p className="text-sm opacity-80">{error.message}</p>
      <button
        className="rounded border border-black/20 px-3 py-1.5 text-sm dark:border-white/25"
        onClick={reset}
        type="button"
      >
        Try again
      </button>
    </div>
  )
}
