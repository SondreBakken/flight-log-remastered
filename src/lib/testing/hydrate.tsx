import type { ReactElement } from 'react'
import { act } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot, type Root } from 'react-dom/client'

// Renders on the server, hydrates that markup on the client, and hands back the resulting DOM.
//
// Every other test in this repo mounts through React Testing Library's `render`, which is a
// client-only mount: the DOM is built from scratch by the same code that computes the state, so
// the two can never disagree. A whole class of defect lives only in that disagreement and is
// therefore invisible to the entire suite by construction, not by oversight.
//
// #49 was one: a controlled <select> seeded from `?wind=`. The server has no `window`, so its
// markup selects "Any wind"; the client's lazy initialiser computes "N". React does not resync a
// controlled select's DOM value to that state during hydration, and emits no warning about it,
// so the list filtered correctly underneath a control that said otherwise. Deleting the mount
// effect that fixes it left `tsc`, `lint`, `pnpm run check` and every test green.
//
// Measured before writing this, because it is the question that decides whether the harness is
// worth having: jsdom's hydrateRoot DOES reproduce that non-resync. Without the effect the
// select reads "all", with it "N". So this belongs in the always-running tier rather than in a
// hand-run browser script.
//
// What it does not cover, stated so nobody reads more into a green run than is there: jsdom's
// hydration is not a browser's. It shares React's reconciler, which is where this class of
// defect lives, but not the browser's parser, layout or form-control quirks. A bundler-specific
// failure is still invisible here (see the README's maplibre note), and so is anything that
// needs a real paint.
export type HydratedTree = {
  readonly container: HTMLElement
  // The markup the server produced, before hydration touched it. Useful for asserting what the
  // two sides actually disagreed about rather than only the outcome.
  readonly serverMarkup: string
  readonly unmount: () => void
}

// `atUrl` is applied for the client half only. The server half always renders with the URL the
// server would see, which is the whole point: a component that reads `window.location` produces
// different state on the two sides, and that difference is what this harness exists to expose.
export function renderThenHydrate(
  element: ReactElement,
  options: { readonly atUrl?: string; readonly serverUrl?: string } = {},
): HydratedTree {
  const originalHref = window.location.href
  const restoreUrl = () => window.history.replaceState(null, '', originalHref)

  window.history.replaceState(null, '', options.serverUrl ?? '/')
  const serverMarkup = renderToString(element)

  window.history.replaceState(null, '', options.atUrl ?? originalHref)
  const container = document.createElement('div')
  // Not user input: `serverMarkup` is this process's own renderToString output for the element
  // the caller passed. Hydration requires the client to attach to markup it did not build, so
  // there is no way to express this test without setting it.
  container.innerHTML = serverMarkup
  document.body.appendChild(container)

  let root: Root | undefined
  act(() => {
    root = hydrateRoot(container, element)
  })

  return {
    container,
    serverMarkup,
    unmount: () => {
      act(() => root?.unmount())
      container.remove()
      restoreUrl()
    },
  }
}
