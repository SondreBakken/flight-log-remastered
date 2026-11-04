'use client'

import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { Mail } from 'lucide-react'
import { authClient } from '@/lib/auth/client'

type SignInStatus = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent'; email: string } | { kind: 'error'; message: string }

// Keyed on the `?error=` values Better Auth's magic-link verify endpoint appends to
// errorCallbackURL. The link carries its own token, so it works on any device or browser.
const CALLBACK_ERROR_MESSAGES: Record<string, string> = {
  INVALID_TOKEN:
    "That sign-in link didn't work. It may have expired or already been used. Request a new one below.",
}

function errorFromCallback(searchParams: URLSearchParams): SignInStatus | null {
  const code = searchParams.get('error')
  if (!code) return null
  return { kind: 'error', message: CALLBACK_ERROR_MESSAGES[code] ?? 'Sign-in failed. Try again.' }
}

// Relative URLs: Better Auth resolves them against BETTER_AUTH_URL, the public origin. A network
// failure rejects instead of returning an error, so it is folded into the same shape.
async function requestMagicLink(email: string): Promise<{ error: unknown }> {
  try {
    return await authClient.signIn.magicLink({ email, callbackURL: '/', errorCallbackURL: '/sign-in' })
  } catch (error) {
    return { error }
  }
}

export default function SignIn() {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<SignInStatus>(() => errorFromCallback(searchParams) ?? { kind: 'idle' })

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = new FormData(event.currentTarget).get('email')
    if (typeof email !== 'string' || email.trim() === '') return

    setStatus({ kind: 'sending' })

    const { error } = await requestMagicLink(email)

    if (error) {
      console.error('[sign-in] magic link request failed:', error)
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
        className="flex items-center gap-1.5 self-start rounded border border-black/20 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/25"
        disabled={status.kind === 'sending'}
        type="submit"
      >
        <Mail aria-hidden="true" size={14} />
        {status.kind === 'sending' ? 'Sending…' : 'Send magic link'}
      </button>
      {status.kind === 'error' && <p className="text-sm text-red-600 dark:text-red-400">{status.message}</p>}
    </form>
  )
}
