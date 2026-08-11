// Shared verbatim across account/page.tsx's link and account-activity/index.tsx's two sign-in/
// no-flights prompts, so the three read as one consistent sentence. account/activity/page.tsx's
// "Who follows your pilot id, and who has commented on your flights." is deliberately NOT this
// constant — different subject (pilot id, not "you"), a paraphrase rather than a duplicate; see
// issue #145.
export const WHO_FOLLOWS_AND_COMMENTED = 'who follows you and who has commented on your flights'
