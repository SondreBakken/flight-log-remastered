import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import SignIn from '@/features/sign-in'
import { createClient } from '@/lib/supabase/server'

// The redirect-if-signed-in check reads the request's Supabase session (a cookie), so under
// Cache Components it has to sit behind a Suspense boundary rather than at the top of the
// page — an un-Suspended dynamic read here blocks the whole route from prerendering (see
// "Uncached data was accessed outside of <Suspense>" in the Next.js build output).
export default function SignInPage() {
  return (
    <Suspense fallback={<SignInSkeleton />}>
      <SignInGuard />
    </Suspense>
  )
}

async function SignInGuard() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Nothing on this page is meaningful once signed in — send an already-signed-in visitor
  // straight back rather than showing them a form to request a link they don't need.
  if (user) redirect('/')

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm opacity-70">We&rsquo;ll email you a link, no password needed.</p>
      </header>
      <SignIn />
    </section>
  )
}

function SignInSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-8 w-32 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="h-4 w-72 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="h-24 w-full max-w-sm animate-pulse rounded bg-black/5 dark:bg-white/5" />
    </div>
  )
}
