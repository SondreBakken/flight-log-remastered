import AccountSettings from '@/features/account'

// No server-side session read here, no Suspense boundary needed — AccountSettings itself is a
// client component that reads auth state after mount and handles the signed-out case (see its
// own doc comment), the same "stay static under Cache Components" rule as sign-in/page.tsx.
export default function AccountPage() {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-sm opacity-70">Set the display name shown on your comments, and link your flightlog.org pilot id.</p>
      </header>
      <AccountSettings />
    </section>
  )
}
