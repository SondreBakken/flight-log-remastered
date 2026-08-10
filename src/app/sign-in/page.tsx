import { Suspense } from 'react'
import SignIn from '@/features/sign-in'

// No server-side "redirect if already signed in" guard here: AuthStatus already hides the
// sign-in link once signed in (see components/site-nav/auth-status.tsx), so this route is
// only reachable by typing the URL directly, and a signed-in visitor who does that just sees
// a form that would send them another magic link — mildly redundant, not broken. A cookie
// read + soft client-side redirect() here bought that for the cost of making the whole route
// dynamic; not worth it for this one path.
export default function SignInPage() {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm opacity-70">We&rsquo;ll email you a link, no password needed.</p>
      </header>
      {/* SignIn reads the `error` query param via useSearchParams (to surface a failed
          magic-link exchange, see app/auth/callback/route.ts) — that needs a Suspense
          boundary to keep the rest of this route prerenderable; see the useSearchParams doc
          comment in node_modules/next/dist/docs on "Missing Suspense boundary". */}
      <Suspense fallback={<SignInSkeleton />}>
        <SignIn />
      </Suspense>
    </section>
  )
}

function SignInSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-8 w-40 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="h-8 w-full max-w-sm animate-pulse rounded bg-black/5 dark:bg-white/5" />
    </div>
  )
}
