import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SCORING_KINDS } from '@/lib/flightlog/types'
import type { ScoringGeometryKind, ScoringGeometryResult, Track } from '@/lib/flightlog/types'
import { ScoringOverlaySelect } from './scoring-overlay-select'

const SCORING = Object.fromEntries(
  SCORING_KINDS.map((kind, index): [ScoringGeometryKind, ScoringGeometryResult] => [
    kind,
    index === 0 ? 'unparseable' : null,
  ]),
) as Track['scoring']

describe('ScoringOverlaySelect', () => {
  it('renders None plus one option per kind inside a select labelled Scoring overlay', () => {
    render(<ScoringOverlaySelect scoring={SCORING} selectedKind={null} onSelectKind={() => {}} />)

    screen.getByRole('combobox', { name: /Scoring overlay/ })
    expect(screen.getAllByTestId('scoring-overlay-option')).toHaveLength(SCORING_KINDS.length + 1)
    expect(screen.getByRole('option', { name: 'None' })).toHaveProperty('selected', true)
  })

  it('disables unavailable kinds and states the reason in the option text', () => {
    render(<ScoringOverlaySelect scoring={SCORING} selectedKind={null} onSelectKind={() => {}} />)

    SCORING_KINDS.forEach((kind, index) => {
      const suffix = index === 0 ? '(could not be read)' : '(not available)'
      const option = screen
        .getAllByTestId('scoring-overlay-option')
        .find((candidate) => candidate.getAttribute('value') === kind) as HTMLOptionElement
      expect(option.disabled).toBe(true)
      expect(option.textContent?.endsWith(suffix)).toBe(true)
    })
  })

  it('calls onSelectKind with null for None', () => {
    const onSelectKind = vi.fn()
    render(<ScoringOverlaySelect scoring={SCORING} selectedKind="distance_open" onSelectKind={onSelectKind} />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })

    expect(onSelectKind).toHaveBeenCalledWith(null)
  })

  it('shows the summary line only for a selected kind', () => {
    const { rerender } = render(<ScoringOverlaySelect scoring={SCORING} selectedKind={null} onSelectKind={() => {}} />)
    expect(screen.queryByTestId('scoring-overlay-summary')).toBeNull()

    rerender(<ScoringOverlaySelect scoring={SCORING} selectedKind="distance_open" onSelectKind={() => {}} />)
    screen.getByTestId('scoring-overlay-summary')
  })
})
