/** Valetto early-access values shared by the route and the API docs. No server imports. */

/** Every Valetto early-access request is emailed here. */
export const VALETTO_EARLY_ACCESS_TO = 'karim@valetto.tech';

/** Submissions per IP, valid or not. A 429 makes the form fall back to its mailto link. */
export const EARLY_ACCESS_IP_LIMIT = { limit: 10, windowMs: 60 * 60 * 1000 } as const;
/**
 * One notice per email address per window. A repeat inside it gets the same 200 and sends nothing.
 * rate_events rows are pruned after a day, so the window cannot be longer than 24 hours.
 */
export const EARLY_ACCESS_EMAIL_WINDOW_MS = 24 * 60 * 60 * 1000;

export const INDUSTRIES = ['retail', 'services', 'manufacturing', 'professional', 'other'] as const;
export const TEAM_SIZES = ['solo', '2-10', '11-50', '50+'] as const;
export const USES_GROK_BOT = ['yes', 'not_yet'] as const;
