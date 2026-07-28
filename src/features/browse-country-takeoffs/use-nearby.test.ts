import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useNearby } from './use-nearby'

// jsdom does not implement navigator.geolocation at all — these tests install and remove a
// fake per test rather than relying on any real browser API, so 'unavailable' (the case where
// the property is simply absent) is the natural DEFAULT state of the test environment, not
// something that has to be faked separately.
type FakeGeolocation = {
  watchPosition: ReturnType<typeof vi.fn>
  clearWatch: ReturnType<typeof vi.fn>
}

function installFakeGeolocation(): FakeGeolocation {
  const fake: FakeGeolocation = { watchPosition: vi.fn(), clearWatch: vi.fn() }
  Object.defineProperty(window.navigator, 'geolocation', { value: fake, configurable: true, writable: true })
  return fake
}

function removeGeolocation(): void {
  Object.defineProperty(window.navigator, 'geolocation', { value: undefined, configurable: true, writable: true })
}

const PERMISSION_DENIED_ERROR = { code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }
const POSITION_UNAVAILABLE_ERROR = { code: 2, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }
const TIMEOUT_ERROR = { code: 3, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }

function fakePosition(lat: number, lon: number): GeolocationPosition {
  return { coords: { latitude: lat, longitude: lon } } as GeolocationPosition
}

afterEach(() => {
  removeGeolocation()
})

describe('useNearby', () => {
  it('starts idle, with no location, and never calls the geolocation API on its own', () => {
    const fake = installFakeGeolocation()

    const { result } = renderHook(() => useNearby())

    expect(result.current.status).toBe('idle')
    expect(result.current.location).toBeNull()
    expect(fake.watchPosition).not.toHaveBeenCalled()
  })

  it('reports "unavailable" when navigator.geolocation does not exist, instead of throwing', () => {
    removeGeolocation()

    const { result } = renderHook(() => useNearby())
    act(() => result.current.requestNearby())

    expect(result.current.status).toBe('unavailable')
    expect(result.current.location).toBeNull()
  })

  it('transitions to "pending" the moment nearby is requested, before the browser answers', () => {
    const fake = installFakeGeolocation()
    fake.watchPosition.mockImplementation(() => 1) // never calls success/error — simulates an in-flight request

    const { result } = renderHook(() => useNearby())
    act(() => result.current.requestNearby())

    expect(result.current.status).toBe('pending')
  })

  it('transitions to "granted" with the real coordinates once permission is granted', () => {
    const fake = installFakeGeolocation()
    fake.watchPosition.mockImplementation((onSuccess: (p: GeolocationPosition) => void) => {
      onSuccess(fakePosition(60.39, 5.32))
      return 1
    })

    const { result } = renderHook(() => useNearby())
    act(() => result.current.requestNearby())

    expect(result.current.status).toBe('granted')
    expect(result.current.location).toEqual({ lat: 60.39, lon: 5.32 })
  })

  it('transitions to "denied", with no location, when the browser reports PERMISSION_DENIED — not an error state', () => {
    const fake = installFakeGeolocation()
    fake.watchPosition.mockImplementation(
      (_onSuccess: unknown, onError: (e: typeof PERMISSION_DENIED_ERROR) => void) => {
        onError(PERMISSION_DENIED_ERROR)
        return 1
      },
    )

    const { result } = renderHook(() => useNearby())
    act(() => result.current.requestNearby())

    expect(result.current.status).toBe('denied')
    expect(result.current.location).toBeNull()
  })

  it('transitions to "unavailable" for a non-permission geolocation error (e.g. POSITION_UNAVAILABLE)', () => {
    const fake = installFakeGeolocation()
    fake.watchPosition.mockImplementation(
      (_onSuccess: unknown, onError: (e: typeof POSITION_UNAVAILABLE_ERROR) => void) => {
        onError(POSITION_UNAVAILABLE_ERROR)
        return 1
      },
    )

    const { result } = renderHook(() => useNearby())
    act(() => result.current.requestNearby())

    expect(result.current.status).toBe('unavailable')
  })

  // The bite specifically called out: a user who granted permission, then revoked it while
  // this page is still open. watchPosition (not a one-shot getCurrentPosition) is what makes
  // this reachable at all — the SAME error callback fires again on the existing watch.
  it('reverts to "denied" and clears the location when permission is revoked mid-session, after having been granted', () => {
    const fake = installFakeGeolocation()
    let capturedError: ((e: typeof PERMISSION_DENIED_ERROR) => void) | undefined
    fake.watchPosition.mockImplementation(
      (onSuccess: (p: GeolocationPosition) => void, onError: (e: typeof PERMISSION_DENIED_ERROR) => void) => {
        capturedError = onError
        onSuccess(fakePosition(60.39, 5.32))
        return 1
      },
    )

    const { result } = renderHook(() => useNearby())
    act(() => result.current.requestNearby())
    expect(result.current.status).toBe('granted')

    act(() => capturedError?.(PERMISSION_DENIED_ERROR))

    expect(result.current.status).toBe('denied')
    expect(result.current.location).toBeNull()
  })

  // watchPosition fires again on every GPS update, most of which repeat the same fix — a
  // fresh object identity on every one of those would invalidate a caller's memo (see
  // index.tsx's userLocation) and re-run its whole downstream pipeline for a location that
  // never actually changed.
  it('keeps the same location object reference across repeated fixes at identical coordinates', () => {
    const fake = installFakeGeolocation()
    let onSuccess: ((p: GeolocationPosition) => void) | undefined
    fake.watchPosition.mockImplementation((success: (p: GeolocationPosition) => void) => {
      onSuccess = success
      onSuccess(fakePosition(60.39, 5.32))
      return 1
    })

    const { result } = renderHook(() => useNearby())
    act(() => result.current.requestNearby())
    const firstLocation = result.current.location

    act(() => onSuccess?.(fakePosition(60.39, 5.32)))

    expect(result.current.location).toBe(firstLocation)
  })

  it('allocates a new location object once the coordinates actually change', () => {
    const fake = installFakeGeolocation()
    let onSuccess: ((p: GeolocationPosition) => void) | undefined
    fake.watchPosition.mockImplementation((success: (p: GeolocationPosition) => void) => {
      onSuccess = success
      onSuccess(fakePosition(60.39, 5.32))
      return 1
    })

    const { result } = renderHook(() => useNearby())
    act(() => result.current.requestNearby())

    act(() => onSuccess?.(fakePosition(61.0, 5.32)))

    expect(result.current.location).toEqual({ lat: 61.0, lon: 5.32 })
  })

  it('clears the active watch on unmount, instead of leaking it', () => {
    const fake = installFakeGeolocation()
    fake.watchPosition.mockImplementation(() => 42)

    const { result, unmount } = renderHook(() => useNearby())
    act(() => result.current.requestNearby())
    unmount()

    expect(fake.clearWatch).toHaveBeenCalledWith(42)
  })

  // D3: a TIMEOUT error (the common indoor case at the 15 second ceiling below) is not a
  // browser incapability — collapsing it into 'unavailable' the way a POSITION_UNAVAILABLE
  // error legitimately does would tell the user something false.
  it('transitions to "timeout", distinct from "unavailable", when the browser reports TIMEOUT', () => {
    const fake = installFakeGeolocation()
    fake.watchPosition.mockImplementation((_onSuccess: unknown, onError: (e: typeof TIMEOUT_ERROR) => void) => {
      onError(TIMEOUT_ERROR)
      return 1
    })

    const { result } = renderHook(() => useNearby())
    act(() => result.current.requestNearby())

    expect(result.current.status).toBe('timeout')
  })

  // Pins the deletion of the 15 second ceiling itself — a request with no timeout at all
  // would hang on "pending" forever if the browser never answers, rather than resting at
  // 'timeout' the way #12 promises this control always does.
  it('requests position with a 15 second timeout, not an unbounded wait', () => {
    const fake = installFakeGeolocation()
    fake.watchPosition.mockImplementation(() => 1)

    const { result } = renderHook(() => useNearby())
    act(() => result.current.requestNearby())

    const options = fake.watchPosition.mock.calls[0][2] as PositionOptions
    expect(options.timeout).toBe(15_000)
  })

  // D2: unchecking "nearby" must actually stop the watch, not just stop reading from it — a
  // stale watchId left running after the user opts out is a real, allocating, invalidating
  // subscription for the rest of the page's lifetime.
  it('stopNearby clears the active watch and resets to idle with no location', () => {
    const fake = installFakeGeolocation()
    fake.watchPosition.mockImplementation((onSuccess: (p: GeolocationPosition) => void) => {
      onSuccess(fakePosition(60.39, 5.32))
      return 7
    })

    const { result } = renderHook(() => useNearby())
    act(() => result.current.requestNearby())
    expect(result.current.status).toBe('granted')

    act(() => result.current.stopNearby())

    expect(fake.clearWatch).toHaveBeenCalledWith(7)
    expect(result.current.status).toBe('idle')
    expect(result.current.location).toBeNull()
  })

  // D3's other half: re-requesting after a denial, a timeout, or an unavailable browser must
  // actually retry, not silently no-op forever because requestNearby only ever fires from
  // 'idle' — stopNearby resetting to 'idle' (see the test above) is what makes a fresh
  // watchPosition call reachable again here.
  it('requestNearby fires again after stopNearby, even though the previous attempt was denied', () => {
    const fake = installFakeGeolocation()
    fake.watchPosition.mockImplementation((_onSuccess: unknown, onError: (e: typeof PERMISSION_DENIED_ERROR) => void) => {
      onError(PERMISSION_DENIED_ERROR)
      return 1
    })

    const { result } = renderHook(() => useNearby())
    act(() => result.current.requestNearby())
    expect(result.current.status).toBe('denied')
    act(() => result.current.stopNearby())
    expect(fake.watchPosition).toHaveBeenCalledTimes(1)

    act(() => result.current.requestNearby())

    expect(fake.watchPosition).toHaveBeenCalledTimes(2)
  })
})
