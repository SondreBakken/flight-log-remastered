# App-Wide Icon Pass — Design

## Goal

Extend the app's existing minimal, text-first visual language with a consistent icon system, applied to navigation, actions, and status/notice patterns across the whole app. Not a redesign: the existing palette, typography, and layout stay as-is. Icons reinforce existing affordances and consolidate duplicated notice/empty-state markup; they do not introduce new visual accents.

Precedent: `src/features/browse-pilot-certificate/certificate-level-form.tsx` already ships a `Pencil` icon (from `lucide-react`, already a project dependency) as the edit affordance for that form. This pass generalizes that pattern.

## Icon System

- **Library:** `lucide-react` (already installed, `^1.34.0`). Thin stroke-based icons, matching the app's hairline borders and restrained aesthetic.
- **Sizing:** `14px` for icons placed inline next to text (matches the certificate-form precedent). `18px` for standalone icon-only controls that need a larger tap target (e.g. view-toggle buttons).
- **Color:** no icon carries its own color. Every icon inherits `currentColor` through the same `opacity-70` / `opacity-60` convention already used for secondary text throughout the app. Icons never become a new visual accent color.
- **Placement:** leading icon + label where horizontal space allows (nav links, buttons with visible text). Icon-only with `aria-label` where space is tight (compact table cells, small controls) — same pattern as the certificate edit icon's `aria-label="Edit certificate level"`.
- **Trailing exception:** external links (leaving the app to flightlog.org or an external map) get a trailing `ExternalLink` icon, not leading — trailing external-link icons are the established convention for "this leaves the site" across web UI, and leading would compete with the link text for attention.

## Tier 1 — Icon Additions

| File | Element | Icon | Notes |
|---|---|---|---|
| `src/components/site-nav/index.tsx` | "Flights" nav link | `Plane` | leading |
| `src/components/site-nav/index.tsx` | "Find a pilot" nav link | `Search` | leading |
| `src/components/site-nav/index.tsx` | "Countries" nav link | `Globe` | leading |
| `src/components/site-nav/auth-status.tsx` | "Sign in" link | `LogIn` | leading |
| `src/components/site-nav/auth-status.tsx` | account email link | `User` | leading |
| `src/components/site-nav/auth-status.tsx` | "Sign out" button | `LogOut` | leading |
| `src/components/follow-button/index.tsx` | Follow button (not-followed state) | `UserPlus` | leading — rendered in the `<button>` JSX in `index.tsx`, wrapping `presentation.label`; `presentation.ts`'s `getFollowButtonPresentation` stays a pure string-returning function, unchanged, since it's tested independently of rendering |
| `src/components/follow-button/index.tsx` | Following/Unfollow button (followed state) | `UserCheck` | leading, same placement |
| `src/features/browse-flight-detail/back-link.tsx` | "Back" button | `ChevronLeft` | leading |
| `src/features/browse-club/index.tsx` | "Back to {countryName} clubs" link | `ChevronLeft` | leading |
| `src/features/browse-country-clubs/index.tsx` | "Back to countries" link | `ChevronLeft` | leading |
| `src/features/browse-takeoff-detail/index.tsx` | "Back to {countryName} takeoffs" link | `ChevronLeft` | leading |
| `src/app/flights/[tripId]/page.tsx` | "View on flightlog.org" external link | `ExternalLink` | **trailing** |
| `src/features/browse-club/index.tsx` | "View on map" external link | `ExternalLink` | **trailing** |
| `src/features/browse-takeoff-detail/index.tsx` | "View on flightlog.org" / "More info" external links | `ExternalLink` | **trailing** |
| `src/features/comment-on-flight/comment-item.tsx` | "Delete" button (own comment) | `Trash2` | leading |
| `src/features/account/pilot-verification.tsx` | "Verify your pilot id" / "Re-verify" / "Send a new code" trigger buttons (all three `StartVerificationTrigger` labels) | `ShieldCheck` | leading |
| `src/features/sign-in/index.tsx` | "Send magic link" button | `Mail` | leading |
| `src/features/browse-club/stats-leaderboard.tsx` | Sortable column headers' `↓`/`↑` text glyphs | `ArrowUp` / `ArrowDown` | direct replacement of the existing ad-hoc text glyph, not an addition |
| `src/features/browse-country-takeoffs/index.tsx` | `ViewToggle` List/Map buttons | `List` / `Map` | leading, 18px (standalone icon-bearing buttons) |
| `src/features/browse-pilot-certificate/certificate-level-form.tsx` | Edit button | `Pencil` | already shipped — no change |

## Tier 2 — Included Optional Items

| File | Element | Icon | Notes |
|---|---|---|---|
| `src/features/browse-country-takeoffs/index.tsx` | "Filter by name" text input | `Search` | leading, inside the input (absolute-positioned or input group) |
| `src/features/browse-country-takeoffs/index.tsx` | "Sort by distance from me" checkbox label | `LocateFixed` | leading |

## Shared Component Extraction

Two markup patterns are duplicated near-verbatim across the app. Rather than paste an icon into each copy, extract one shared component per pattern, add the icon there, and replace each call site.

### `Callout` (warning/error notice)

Currently duplicated (amber warning box and/or red error box, same `border` + `rounded` + tinted-background shape) in:
- `src/app/error.tsx` (red error box)
- `src/features/browse-flight-feed/flight-feed-view.tsx` — `FollowsUnavailableNotice`, `FailedPilotsNotice` (amber)
- `src/features/browse-flown-sites-map/index.tsx` — `LoadFailure` (matches the same shape)
- `src/features/account-activity/index.tsx` — `UnverifiedLinkNote` (amber-family "unverified" warning)

New component: `src/components/callout/index.tsx`, exporting `Callout({ tone: 'warning' | 'error', children })`. Renders the existing tinted-box markup (colors/borders unchanged — pull the exact classes from `error.tsx` and `flight-feed-view.tsx` verbatim, do not invent new ones) with a leading icon: `AlertTriangle` for `warning`, matching icon for `error` (reuse `AlertTriangle`, tone drives color only — do not introduce a second icon for a color-only distinction). Each call site above is updated to render `<Callout tone="...">` instead of its own inline box, passing its existing message text/children through unchanged.

`error.tsx`'s "Try again" button additionally gets a leading `RotateCw` icon (this button is specific to `error.tsx`, not part of the shared component).

### `EmptyState` (dashed-border empty box)

Currently duplicated (`rounded-md border-dashed ... opacity-70` box) in at least:
- `src/features/search-pilots/index.tsx` — "No pilots match" state
- `src/features/browse-club/index.tsx` — "No clubs recorded" (or equivalent)
- `src/features/browse-flown-sites-map/index.tsx` — `NoFlights`, `NoSitesMapped`
- `src/features/browse-pilot-statistics/index.tsx` — `EmptyStatistics`
- `src/features/browse-takeoff-detail/index.tsx` — `EmptyFlights`
- any other file matching the same dashed-border-box shape found during implementation

New component: `src/components/empty-state/index.tsx`, exporting `EmptyState({ children })`. Renders the existing dashed-border box markup (pull exact classes from one of the current call sites, do not invent new spacing/border values) with a leading `Inbox` icon — one generic icon for every empty state, not a bespoke icon per context (keeps the pass restrained; a distinct icon per empty-state flavor is out of scope). Each call site is updated to render `<EmptyState>` instead of its own inline box, passing its existing message content through unchanged.

Both new components live in `src/components/`, matching the existing placement of `site-nav`, `follow-button`, `flown-sites-map`, `takeoffs-map` (cross-feature UI primitives, not feature-specific business logic) — consistent with this repo's `src/lib` (infra/generic) vs `src/features` (business logic) vs `src/components` (shared UI) layering.

## Tier 3 — Explicit Skip (do not add icons here)

- **Feed "New" badge** (`src/features/browse-flight-feed/components/feed-entry-row.tsx`) — already a colored badge; an icon here would introduce a second visual accent alongside its existing color, breaking the "icons stay monochrome/secondary" rule.
- **Flight-detail `<dl>` labels** (`src/app/flights/[tripId]/page.tsx`'s `FlightDetailTable`) — a dense values table; per-label icons (Date, Country, Takeoff, Glider, Duration, Distance, Max altitude, Takeoff type) would be visual noise, not clarity.
- **Per-section stat headers** (`src/features/browse-pilot-statistics/index.tsx` — "Hours by year", "By glider", "By site", etc.) — heavy-handed for a data-dense page; these are plain section labels, not actions or navigation.
- **Clickable data rows** (`comment-row.tsx`, `longest-flights.tsx`, both `flight-row.tsx` components in `browse-pilot-logbook` and `browse-takeoff-detail`) — none of these currently carry any icon affordance for "click to navigate"; adding one only to some rows (there's no room to add one to a `<tr>`'s cells without picking an arbitrary column) would be inconsistent with the pattern established by the pilot logbook's `FlightRow`, which the certificate/verification work already reviewed and left icon-free.
- **Generic form-submit buttons** (`account-form.tsx` "Save", `pilot-id-form.tsx` "Save", `confirm-pilot-verification-form.tsx` "Confirm", `comment-form.tsx` "Post comment") — no icon metaphor beyond a generic save/check icon that would be pure repetition (four visually near-identical icons across four unrelated forms) rather than added clarity.

## Testing

Every changed component already has test coverage (button labels, link hrefs, empty-state text) exercised via `getByRole`/`getByText` queries in this repo's existing test suite (Testing Library). Icon additions must not change accessible names: an icon-only control keeps its existing `aria-label` (or gains one if it didn't have one, per the Placement rule above); a leading/trailing icon next to visible text must not duplicate or alter that text's accessible name (lucide-react icons render as inert `<svg>` with no default `role`/`aria-label`, so no extra suppression is needed by default — verify this holds for the installed version during implementation). Existing tests should continue to pass without modification for text/role assertions; only tests that currently assert exact DOM structure (rare in this codebase, which favors `getByRole`/`getByText`) may need adjustment.

Both new shared components (`Callout`, `EmptyState`) get their own test file, covering: each tone/variant renders its icon, renders passed-through children, and preserves the existing accessible text.

## Out of Scope

- No changes to color palette, typography, or layout beyond what's needed to accommodate an icon (e.g. `flex items-center gap-X` on a previously text-only element).
- No new visual "signature" element, hero treatment, or branding — this is an icon-application pass on an established design, not a rebrand.
- No icon library other than `lucide-react`.
- Any icon-worthy element not listed in Tier 1/Tier 2 above stays as-is; this spec's Tier 1/2 lists are the complete scope, not illustrative examples.
