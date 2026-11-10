// Every page on the site carries an `hp-nav` honeypot link: regenerated per request, off-screen,
// `rel='nofollow'`, `data-trap='1'` (see docs/flightlog-api.md). Match on these markers, not on
// where the trap happens to render, so a trap placed anywhere in the document is excluded.
export const HONEYPOT_SELECTOR = '.hp-nav, [data-trap], [rel="nofollow"]'
