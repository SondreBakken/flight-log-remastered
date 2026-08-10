'use client'

import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type SignInStatus = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent'; email: string } | { kind: 'error'; message: string }

// Keyed on the callback route's own `?error=` values (see app/auth/callback/route.ts) — the
// callback only ever sets one today, but a lookup keeps the mapping between "what the
// callback reports" and "what the visitor reads" in one place rather than an inline string
// compare, and gives a clear seam for a second value later.
const CALLBACK_ERROR_MESSAGES: Record<string, string> = {
  'auth-code-exchange-failed':
    "That sign-in link didn't work. It may have expired, already been used, or been opened on a different device or browser than the one you requested it from — request a new one below.",
}

function errorFromCallback(searchParams: URLSearchParams): SignInStatus | null {
  const code = searchParams.get('error')
  if (!code) return null
  return { kind: 'error', message: CALLBACK_ERROR_MESSAGES[code] ?? 'Sign-in failed. Try again.' }
}

export default function SignIn() {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<SignInStatus>(() => errorFromCallback(searchParams) ?? { kind: 'idle' })

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = new FormData(event.currentTarget).get('email')
    if (typeof email !== 'string' || email.trim() === '') return

    setStatus({ kind: 'sending' })

    let supabase: ReturnType<typeof createClient>
    try {
      supabase = createClient()
    } catch (error) {
      console.error('[sign-in] Supabase is not configured:', error)
      setStatus({ kind: 'error', message: 'Sign-in is not available right now. Please try again later.' })
      return
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // The callback route (src/app/auth/callback/route.ts) exchanges the magic-link code
        // for a session — this has to be an absolute URL the email client can follow, so it's
        // built from wherever this page is actually being served rather than hardcoded.
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      console.error('[sign-in] signInWithOtp failed:', error)
      setStatus({ kind: 'error', message: 'Something went wrong sending the sign-in link. Try again.' })
      return
    }

    setStatus({ kind: 'sent', email })
  }

  if (status.kind === 'sent') {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="rounded-md border border-dashed border-black/15 p-6 text-sm opacity-70 dark:border-white/20">
          Check {status.email} for a sign-in link.
        </p>
        <button
          className="text-sm underline-offset-2 hover:underline"
          onClick={() => setStatus({ kind: 'idle' })}
          type="button"
        >
          Use a different email
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm" htmlFor="email">
        Email
        <input
          className="rounded border border-black/20 px-3 py-1.5 text-sm dark:border-white/25"
          id="email"
          name="email"
          placeholder="you@example.com"
          required
          type="email"
        />
      </label>
      <button
        className="self-start rounded border border-black/20 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/25"
        disabled={status.kind === 'sending'}
        type="submit"
      >
        {status.kind === 'sending' ? 'Sending…' : 'Send magic link'}
      </button>
      {status.kind === 'error' && <p className="text-sm text-red-600 dark:text-red-400">{status.message}</p>}
    </form>
  )
}
