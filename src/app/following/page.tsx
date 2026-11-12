import type { Metadata } from 'next'
import { Suspense } from 'react'
import Following from '@/features/following'

export const metadata: Metadata = { title: 'Following' }

// Suspense boundary around a Server Component that reads cookie-based auth, same shape as
// account/activity/page.tsx.
export default function FollowingPage() {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Following</h1>
        <p className="text-sm opacity-70">The pilots and takeoffs you follow, newest follow first.</p>
      </header>
      <Suspense fallback={<div className="h-16 w-full animate-pulse rounded-md bg-black/5 dark:bg-white/5" />}>
        <Following />
      </Suspense>
    </section>
  )
}
