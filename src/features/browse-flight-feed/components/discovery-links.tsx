import Link from 'next/link'

// The three ways into the app for a visitor with nothing to show yet. A fragment, so each
// caller keeps its own wrapper layout.
export function DiscoveryLinks({ defaultPilotId }: { defaultPilotId: number }) {
  return (
    <>
      <Link className="underline" href="/pilots/search">
        Search for a pilot by name
      </Link>
      <Link className="underline" href={`/pilots/${defaultPilotId}`}>
        Browse a pilot&apos;s logbook
      </Link>
      <Link className="underline" href="/countries">
        Browse clubs by country
      </Link>
    </>
  )
}
