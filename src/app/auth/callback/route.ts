import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// The magic-link email points here with a `code` query param (see emailRedirectTo in
// features/sign-in/index.tsx) — exchanging it for a session is what actually completes
// sign-in, distinct from the sign-in page just requesting the link. No `next` param: nothing
// sets one today, and redirecting to an unvalidated caller-supplied URL is an open-redirect
// risk the moment something does — always land on `/` instead.
export async function GET(request: Request): Promise<Response> {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    let supabase: Awaited<ReturnType<typeof createClient>>
    try {
      supabase = await createClient()
    } catch (error) {
      console.error('[auth/callback] Supabase is not configured:', error)
      return NextResponse.redirect(`${origin}/sign-in?error=auth-code-exchange-failed`)
    }

    try {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (!error) {
        return NextResponse.redirect(`${origin}/`)
      }
      // The PKCE code verifier cookie is browser-specific, so this fires every time someone
      // opens the magic link on a different device than the one that requested it — logged
      // server-side since the sign-in page can only show a generic message, not this detail.
      console.error('[auth/callback] exchangeCodeForSession failed:', error)
    } catch (error) {
      console.error('[auth/callback] failed to exchange code for session:', error)
    }
  }

  return NextResponse.redirect(`${origin}/sign-in?error=auth-code-exchange-failed`)
}
