'use client'

import { useState, type FormEvent } from 'react'
import { createClient } from '@/lib/supabase/client'

type SignInStatus = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent'; email: string } | { kind: 'error'; message: string }

export default function SignIn() {
  const [status, setStatus] = useState<SignInStatus>({ kind: 'idle' })

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = new FormData(event.currentTarget).get('email')
    if (typeof email !== 'string' || email.trim() === '') return

    setStatus({ kind: 'sending' })

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // The callback route (src/app/auth/callback/route.ts) exchanges the magic-link code
        // for a session — this has to be an absolute URL the email client can follow, so it's
        // built from wherever this page is actually being served rather than hardcoded.
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    setStatus(error ? { kind: 'error', message: error.message } : { kind: 'sent', email })
  }

  if (status.kind === 'sent') {
    return (
      <p className="rounded-md border border-dashed border-black/15 p-6 text-sm opacity-70 dark:border-white/20">
        Check {status.email} for a sign-in link.
      </p>
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
