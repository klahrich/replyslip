/**
 * The wording next to the marketing email checkbox. The API stores whatever
 * `consent_text` we send as proof of consent, so the sign-in checkbox and the
 * dashboard toggle both show this string and send exactly this string.
 * Changing it counts as new wording for anyone who opts in afterwards.
 */
export const MARKETING_CONSENT_TEXT = 'Email me about new plans and features. Unsubscribe anytime.';
