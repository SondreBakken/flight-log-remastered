export type OwnVerificationStatus = 'none' | 'pending' | 'verified'

const OWN_VERIFICATION_URL = '/api/account/verification'
const STATUSES: readonly unknown[] = ['none', 'pending', 'verified'] satisfies OwnVerificationStatus[]

// Throws on any answer other than a well-formed status, so a failed lookup is never mistaken for
// "not verified".
export async function fetchOwnVerification(): Promise<OwnVerificationStatus> {
  const response = await fetch(OWN_VERIFICATION_URL)
  if (!response.ok) throw new Error(`${OWN_VERIFICATION_URL} answered ${response.status}`)

  const body: unknown = await response.json()
  if (!isOwnVerificationResponse(body)) throw new Error(`${OWN_VERIFICATION_URL} answered an unexpected body`)
  return body.status
}

function isOwnVerificationResponse(body: unknown): body is { status: OwnVerificationStatus } {
  return typeof body === 'object' && body !== null && 'status' in body && STATUSES.includes(body.status)
}
