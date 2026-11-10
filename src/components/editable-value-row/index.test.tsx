import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { EditableValueRow } from './index'

function Harness({ toggle = false, initiallyEditing = false, showFormInitially = false }) {
  const [isEditing, setIsEditing] = useState(initiallyEditing)
  return (
    <EditableValueRow
      closeLabel="Close it"
      editLabel="Edit it"
      feedback={<p>feedback</p>}
      isEditing={isEditing}
      label="Thing:"
      note={<p>note</p>}
      onEdit={() => setIsEditing(toggle ? (editing) => !editing : true)}
      showForm={showFormInitially || isEditing}
      toggle={toggle}
      value="v1"
    >
      <form>
        <input aria-label="field" disabled />
        <input aria-label="enabled field" />
        <button onClick={() => setIsEditing(false)} type="button">
          Done
        </button>
      </form>
    </EditableValueRow>
  )
}

describe('EditableValueRow default mode', () => {
  it('shows the row and not the form until the pencil is clicked, then swaps them', () => {
    render(<Harness />)
    screen.getByText('v1')
    expect(screen.queryByLabelText('enabled field')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Edit it' }))

    expect(screen.queryByText('v1')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit it' })).toBeNull()
    screen.getByLabelText('enabled field')
  })

  it('focuses the first enabled field on open, skipping disabled ones', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit it' }))

    expect(document.activeElement).toBe(screen.getByLabelText('enabled field'))
  })

  it('returns focus to the pencil when editing closes', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit it' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit it' }))
  })

  it('does not steal focus when the form is shown on first mount', () => {
    render(<Harness showFormInitially />)

    expect(document.activeElement).toBe(document.body)
  })

  it('does not focus the pencil on first mount when the row is shown', () => {
    render(<Harness />)

    expect(document.activeElement).toBe(document.body)
  })

  it('renders row/form, then note, then feedback', () => {
    render(<Harness />)
    const row = screen.getByText('v1')
    const note = screen.getByText('note')
    const feedback = screen.getByText('feedback')

    expect(row.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(note.compareDocumentPosition(feedback) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('EditableValueRow toggle mode', () => {
  it('keeps the row, hides the value and relabels the pencil while editing, with the form below', () => {
    render(<Harness toggle />)
    screen.getByText('v1')

    fireEvent.click(screen.getByRole('button', { name: 'Edit it' }))

    expect(screen.queryByText('v1')).toBeNull()
    const close = screen.getByRole('button', { name: 'Close it' })
    expect(close.compareDocumentPosition(screen.getByLabelText('enabled field')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('enabled field'))
  })

  it('leaves the pencil focused after toggling closed', () => {
    render(<Harness toggle />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit it' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close it' }))

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit it' }))
  })
})
