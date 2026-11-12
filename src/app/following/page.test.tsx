import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/features/following', () => ({ default: () => <p>following feature</p> }))

import FollowingPage from './page'

describe('FollowingPage', () => {
  it('renders the heading and the following feature', () => {
    render(<FollowingPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Following' })).toBeTruthy()
    expect(screen.getByText('following feature')).toBeTruthy()
  })
})
