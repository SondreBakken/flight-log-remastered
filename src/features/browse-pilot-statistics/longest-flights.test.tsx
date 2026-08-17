import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import type { Flight } from '@/lib/flightlog/types'
import { LongestFlightsList } from './longest-flights'

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

function flight(overrides: Partial<Flight> = {}): Flight {
  return {
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
    ...overrides,
  }
}

const BY_DURATION = flight({ tripId: 1001, duration: '00:45' })
const BY_DISTANCE = flight({ tripId: 1002, distanceKm: 40 })

beforeEach(() => {
  mockPush.mockClear()
})

describe('LongestFlightsList', () => {
  // #218: neither row nests a link or button of its own (see this file's own header comment),
  // so the whole <li> is the click target, mirroring #213's FlightRow.
  it('navigates to the byDuration flight page when that row is clicked', () => {
    render(<LongestFlightsList byDuration={BY_DURATION} byDistance={BY_DISTANCE} />)

    fireEvent.click(screen.getByText(/By duration/))

    expect(mockPush).toHaveBeenCalledWith('/flights/1001')
  })

  it('navigates to the byDistance flight page when that row is clicked', () => {
    render(<LongestFlightsList byDuration={BY_DURATION} byDistance={BY_DISTANCE} />)

    fireEvent.click(screen.getByText(/By distance/))

    expect(mockPush).toHaveBeenCalledWith('/flights/1002')
  })

  it('navigates on Enter and Space, for keyboard users who cannot click', () => {
    render(<LongestFlightsList byDuration={BY_DURATION} byDistance={null} />)
    const row = screen.getByRole('button')

    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })

    expect(mockPush).toHaveBeenCalledTimes(2)
    expect(mockPush).toHaveBeenCalledWith('/flights/1001')
  })

  it('does not navigate on an unrelated keypress', () => {
    render(<LongestFlightsList byDuration={BY_DURATION} byDistance={null} />)
    const row = screen.getByRole('button')

    fireEvent.keyDown(row, { key: 'Tab' })

    expect(mockPush).not.toHaveBeenCalled()
  })

  it('renders only the row for whichever of byDuration/byDistance is non-null', () => {
    render(<LongestFlightsList byDuration={BY_DURATION} byDistance={null} />)

    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  // #223: role="button" must live on an inner wrapper, not the <li> itself — an <li> with its
  // implicit listitem role overridden stops the <ul> from being exposed as a list to assistive
  // tech (screen reader announces "button, button" instead of "list, 2 items").
  it('keeps the li a plain list item, exposing the ul as a list', () => {
    render(<LongestFlightsList byDuration={BY_DURATION} byDistance={BY_DISTANCE} />)

    const list = screen.getByRole('list')
    expect(list.querySelectorAll('li[role]')).toHaveLength(0)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('keeps the row focusable via tabIndex on the inner div wrapper', () => {
    render(<LongestFlightsList byDuration={BY_DURATION} byDistance={null} />)

    expect(screen.getByRole('button').getAttribute('tabindex')).toBe('0')
  })

  // A role="button" element gets no native activation from the browser, but Space still
  // triggers its default action for a role="button" — scrolling the page — unless
  // preventDefault() is called.
  it('prevents the default Space action (page scroll) when Space is pressed', () => {
    render(<LongestFlightsList byDuration={BY_DURATION} byDistance={null} />)
    const row = screen.getByRole('button')

    const keyDownEvent = createEvent.keyDown(row, { key: ' ' })
    fireEvent(row, keyDownEvent)

    expect(keyDownEvent.defaultPrevented).toBe(true)
  })
})
