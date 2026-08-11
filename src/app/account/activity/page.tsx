import { Suspense } from 'react'
import AccountActivity from '@/features/account-activity'

// Suspense boundary wrapping a Server Component that reads cookie-based auth (see
// AccountActivity's own doc comment on why this is server-side, unlike account/page.tsx's
// client-only shell) — same shape as flights/[tripId]/page.tsx's own Flight boundary.
export default function AccountActivityPage() {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="text-sm opacity-70">Who follows your pilot id, and who has commented on your flights.</p>
      </header>
      <Suspense fallback={<ActivitySkeleton />}>
        <AccountActivity />
      </Suspense>
    </section>
  )
}

function ActivitySkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="h-3 w-72 animate-pulse rounded bg-black/5 dark:bg-white/5" />
      <div className="flex flex-col gap-4">
        <div className="h-6 w-28 animate-pulse rounded bg-black/10 dark:bg-white/10" />
        <div className="h-16 w-full animate-pulse rounded-md bg-black/5 dark:bg-white/5" />
      </div>
      <div className="flex flex-col gap-4">
        <div className="h-6 w-48 animate-pulse rounded bg-black/10 dark:bg-white/10" />
        <div className="h-16 w-full animate-pulse rounded-md bg-black/5 dark:bg-white/5" />
      </div>
    </div>
  )
}
