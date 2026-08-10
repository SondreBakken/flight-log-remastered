import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// The magic-link email points here with a `code` query param (see emailRedirectTo in
// features/sign-in/index.tsx) — exchanging it for a session is what actually completes
// sign-in, distinct from the sign-in page just requesting the link.
export async function GET(request: Request): Promise<Response> {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/sign-in?error=auth-code-exchange-failed`)
}
