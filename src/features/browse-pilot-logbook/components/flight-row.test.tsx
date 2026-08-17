import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, createEvent } from '@testing-library/react'
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

function renderRow(hasTrack: boolean) {
  return render(
    <table>
      <tbody>
        <FlightRow flight={FLIGHT} hasTrack={hasTrack} />
      </tbody>
    </table>,
  )
}

beforeEach(() => {
  mockPush.mockClear()
})

describe('FlightRow', () => {
  // #213: before this fix, an untracked row's only navigation was the Track cell's Link, which
  // only rendered when hasTrack was true — most flights have no track, so most rows had no way
  // to reach /flights/{tripId} (and its comments) at all. The row itself is now the target.
  it('navigates to the flight page when an untracked row is clicked anywhere', () => {
    renderRow(false)

    fireEvent.click(screen.getByRole('button'))

    expect(mockPush).toHaveBeenCalledWith('/flights/1002674')
  })

  it('navigates to the flight page when a tracked row is clicked anywhere', () => {
    renderRow(true)

    fireEvent.click(screen.getByRole('button'))

    expect(mockPush).toHaveBeenCalledWith('/flights/1002674')
  })

  it('navigates on Enter and Space, for keyboard users who cannot click', () => {
    renderRow(false)
    const row = screen.getByRole('button')

    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })

    expect(mockPush).toHaveBeenCalledTimes(2)
    expect(mockPush).toHaveBeenCalledWith('/flights/1002674')
  })

  it('does not navigate on an unrelated keypress', () => {
    renderRow(false)
    const row = screen.getByRole('button')

    fireEvent.keyDown(row, { key: 'Tab' })

    expect(mockPush).not.toHaveBeenCalled()
  })

  // A role="button" element gets no native activation from the browser, but Space still
  // triggers its default action for a role="button" — scrolling the page — unless
  // preventDefault() is called. createEvent (rather than fireEvent) is used so the event
  // object survives dispatch and its defaultPrevented flag can be inspected afterwards.
  it('prevents the default Space action (page scroll) when Space is pressed', () => {
    renderRow(false)
    const row = screen.getByRole('button')

    const keyDownEvent = createEvent.keyDown(row, { key: ' ' })
    fireEvent(row, keyDownEvent)

    expect(keyDownEvent.defaultPrevented).toBe(true)
  })
})
