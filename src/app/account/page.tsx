import type { Metadata } from 'next'
import { Suspense } from 'react'
import Link from 'next/link'
import AccountSettings from '@/features/account'
import { WHO_FOLLOWS_AND_COMMENTED } from '@/features/account-activity/copy'

export const metadata: Metadata = { title: 'Account' }

// AccountSettings reads the session, so it sits behind a Suspense boundary and the rest of the
// page stays a prerendered shell. The activity link is static: /account/activity handles every
// auth state itself.
export default function AccountPage() {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-sm opacity-70">Set the display name shown on your comments, and link your flightlog.org pilot id.</p>
      </header>
      <Suspense fallback={<AccountSettingsSkeleton />}>
        <AccountSettings />
      </Suspense>
      <Link className="text-sm underline underline-offset-2" href="/account/activity">
        See {WHO_FOLLOWS_AND_COMMENTED}
      </Link>
    </section>
  )
}

function AccountSettingsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex max-w-sm flex-col gap-2">
        <div className="h-4 w-24 animate-pulse rounded bg-black/10 dark:bg-white/10" />
        <div className="h-8 w-full animate-pulse rounded bg-black/5 dark:bg-white/5" />
      </div>
      <div className="flex max-w-sm flex-col gap-2">
        <div className="h-4 w-36 animate-pulse rounded bg-black/10 dark:bg-white/10" />
        <div className="h-8 w-full animate-pulse rounded bg-black/5 dark:bg-white/5" />
      </div>
    </div>
  )
}
