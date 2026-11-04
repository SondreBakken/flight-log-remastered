type OwnPilotIdResponse = { pilotId: number | null }

const OWN_PILOT_ID_URL = '/api/account/pilot-id'

// Throws on any answer other than a well-formed pilot id, so a failed lookup is never mistaken
// for "no pilot linked".
export async function fetchOwnPilotId(): Promise<number | null> {
  const response = await fetch(OWN_PILOT_ID_URL)
  if (!response.ok) throw new Error(`${OWN_PILOT_ID_URL} answered ${response.status}`)

  const body: unknown = await response.json()
  if (!isOwnPilotIdResponse(body)) throw new Error(`${OWN_PILOT_ID_URL} answered an unexpected body`)
  return body.pilotId
}

function isOwnPilotIdResponse(body: unknown): body is OwnPilotIdResponse {
  if (typeof body !== 'object' || body === null || !('pilotId' in body)) return false
  return body.pilotId === null || typeof body.pilotId === 'number'
}
