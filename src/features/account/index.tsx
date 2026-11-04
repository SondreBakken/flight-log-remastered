import Link from 'next/link'
import { getCurrentUserId } from '@/lib/auth/current-user'
import { getDb } from '@/lib/db/client'
import { getProfile } from '@/lib/profiles/get-profile'
import { ProfilesQueryError } from '@/lib/profiles/profiles-query-error'
import { SignedInAccountSettings, type OwnProfileState } from './signed-in-account-settings'

// Server Component, rendered inside account/page.tsx's Suspense boundary so the page shell stays
// prerendered: the session and the signed-in user's own profile are read here, on the server,
// and handed to the forms as their initial values.
export default async function AccountSettings() {
  const userId = await getCurrentUserId()
  if (!userId) return <SignInPrompt />

  return <SignedInAccountSettings ownProfile={await loadOwnProfile(userId)} userId={userId} />
}

// A failed lookup becomes its own state rather than an empty profile: the forms then disable
// themselves instead of prefilling blanks a save would write over the real values with.
async function loadOwnProfile(userId: string): Promise<OwnProfileState> {
  try {
    return { kind: 'loaded', profile: await getProfile(getDb(), userId) }
  } catch (error) {
    if (!(error instanceof ProfilesQueryError)) throw error
    return { kind: 'error' }
  }
}

function SignInPrompt() {
  return (
    <p className="text-sm opacity-70">
      <Link className="underline underline-offset-2" href="/sign-in">
        Sign in
      </Link>{' '}
      to set a display name.
    </p>
  )
}
