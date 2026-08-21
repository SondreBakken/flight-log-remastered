import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, fireEvent, createEvent } from '@testing-library/react'
import type { Flight } from '@/lib/flightlog/types'
import { FlightRow } from './flight-row'

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

const FLIGHT: Flight = {
  tripId: 1002674,
  userId: 12677,
  date: '2026-07-23',
  country: 'Norway',
  takeoff: 'Voss, Hjelle/Gjelle',
  takeoffRef: null,
  glider: 'skywalk Mescal 6',
  duration: '00:10',
  flightCount: 1,
  distanceKm: null,
  openDistanceKm: null,
  note: null,
}

// Selects via container.querySelector('tr') rather than screen.getByRole('button'): the row no
// longer carries role="button" (#233 — that role is ARIA-invalid on a <tr>), same selection
// strategy browse-takeoff-detail/components/flight-row.test.tsx and feed-entry-row.test.tsx
// already use for their own <tr>.
function renderRow(hasTrack: boolean) {
  const { container } = render(
    <table>
      <tbody>
        <FlightRow flight={FLIGHT} hasTrack={hasTrack} />
      </tbody>
    </table>,
  )
  return container.querySelector('tr') as HTMLTableRowElement
}

beforeEach(() => {
  mockPush.mockClear()
})

describe('FlightRow', () => {
  // #213: before this fix, an untracked row's only navigation was the Track cell's Link, which
  // only rendered when hasTrack was true — most flights have no track, so most rows had no way
  // to reach /flights/{tripId} (and its comments) at all. The row itself is now the target.
  it('navigates to the flight page when an untracked row is clicked anywhere', () => {
    const row = renderRow(false)

    fireEvent.click(row)

    expect(mockPush).toHaveBeenCalledWith('/flights/1002674')
  })

  it('navigates to the flight page when a tracked row is clicked anywhere', () => {
    const row = renderRow(true)

    fireEvent.click(row)

    expect(mockPush).toHaveBeenCalledWith('/flights/1002674')
  })

  it('navigates on Enter and Space, for keyboard users who cannot click', () => {
    const row = renderRow(false)

    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })

    expect(mockPush).toHaveBeenCalledTimes(2)
    expect(mockPush).toHaveBeenCalledWith('/flights/1002674')
  })

  it('does not navigate on an unrelated keypress', () => {
    const row = renderRow(false)

    fireEvent.keyDown(row, { key: 'Tab' })

    expect(mockPush).not.toHaveBeenCalled()
  })

  // The row has no native semantics that would suppress Space's default browser action (page
  // scroll) on its own — only the row's own preventDefault() in handleKeyDown does that.
  // createEvent (rather than fireEvent) is used so the event object survives dispatch and its
  // defaultPrevented flag can be inspected afterwards.
  it('prevents the default Space action (page scroll) when Space is pressed', () => {
    const row = renderRow(false)

    const keyDownEvent = createEvent.keyDown(row, { key: ' ' })
    fireEvent(row, keyDownEvent)

    expect(keyDownEvent.defaultPrevented).toBe(true)
  })

  // #233: role="button" was removed from the row since it can't validly hold that role on a
  // <tr>. aria-label carries the "this row is actionable" signal instead, without asserting a
  // role the markup can't validly hold.
  it('exposes an aria-label on the row instead of an invalid role="button"', () => {
    const row = renderRow(false)

    expect(row.getAttribute('role')).toBeNull()
    expect(row.getAttribute('aria-label')).toBe('View flight details')
  })
})
