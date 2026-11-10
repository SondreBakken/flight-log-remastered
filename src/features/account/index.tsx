import Link from 'next/link'
import { getCurrentUserId } from '@/lib/auth/current-user'
import { getDb } from '@/lib/db/client'
import { getOwnPilotVerification } from '@/lib/profiles/get-own-pilot-verification'
import { getProfile } from '@/lib/profiles/get-profile'
import { ProfilesQueryError } from '@/lib/profiles/profiles-query-error'
import type { OwnPilotVerificationState } from './pilot-verification'
import { SignedInAccountSettings, type OwnProfileState } from './signed-in-account-settings'

// Server Component, rendered inside account/page.tsx's Suspense boundary so the page shell stays
// prerendered: the session, the signed-in user's own profile and their own pilot verification are
// read here, on the server, and handed to the forms as props.
export default async function AccountSettings() {
  const userId = await getCurrentUserId()
  if (!userId) return <SignInPrompt />

  const [ownProfile, ownVerification] = await Promise.all([loadOwnProfile(userId), loadOwnPilotVerification(userId)])
  return <SignedInAccountSettings ownProfile={ownProfile} ownVerification={ownVerification} />
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

async function loadOwnPilotVerification(userId: string): Promise<OwnPilotVerificationState> {
  try {
    return await getOwnPilotVerification(getDb(), userId)
  } catch (error) {
    if (!(error instanceof ProfilesQueryError)) throw error
    return { kind: 'error' }
  }
}

function SignInPrompt() {
  return (
    <p className="text-sm opacity-70">
      <Link href="/sign-in">
        Sign in
      </Link>{' '}
      to set a display name.
    </p>
  )
}
