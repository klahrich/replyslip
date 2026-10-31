export const AGENT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
/** Public workspace address. 2–32 characters, lowercase, starting with a letter. */
export const HANDLE_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;
/** Offer names are the menu key a guest passes to create_task. */
export const OFFER_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
/** @handle/AgentName. Bare names are not this shape. */
export const SHARED_ADDRESS_PATTERN = /^@([a-z][a-z0-9-]{1,31})\/([A-Za-z][A-Za-z0-9_-]{0,63})$/;
export const DEFAULT_SHARE_DAILY_CAP = 50;
export const MAX_SHARE_DAILY_CAP = 10_000;
export const SHARE_CAP_WINDOW_MS = 24 * 60 * 60 * 1000;
/** rate_events.kind for a guest task. The share id is stored in rate_events.email. */
export const GUEST_TASK_RATE_KIND = 'guest_task';
export const ACCESS_REVOKED_REASON = 'access revoked';
/** fail_reason when the owner declines a request in review_first mode. Customers see fail_code declined_by_owner. */
export const OWNER_DECLINED_REASON = 'declined by owner';
/** Owner note on Send back or Decline, in characters after trimming. Shown to the bot only. */
export const OWNER_NOTE_MAX = 2_000;
/** Held items listed by GET /api/v1/reviews. */
export const REVIEWS_LIST_MAX = 100;
export const OFFER_DESCRIPTION_MAX = 4_000;
/** Owner-set readable offer title, in characters after trimming. */
export const OFFER_TITLE_MAX = 60;
export const PANE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
/** Short id for a local nudge driver. The server accepts any id that matches. herdr and orca are the built-in ones. */
export const DRIVER_ID_PATTERN = /^[a-z0-9-]{1,32}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const LOGIN_CODE_TTL_MS = 10 * 60 * 1000;
export const LOGIN_CODE_MAX_ATTEMPTS = 5;
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_COOKIE = 'replyslip_session';

export const JOIN_CODE_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
export const JOIN_CODE_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const JOIN_CODE_MIN_TTL_MS = 60 * 60 * 1000;
export const JOIN_CODE_MAX_PENDING = 25;

export const INVITE_DEFAULT_TTL_DAYS = 30;
export const INVITE_MIN_TTL_DAYS = 1;
export const INVITE_MAX_TTL_DAYS = 90;
export const INVITE_MAX_USES = 1_000;
export const INVITE_MAX_ACTIVE_PER_AGENT = 50;
export const INVITE_LABEL_MAX = 80;
/** Auto handle for an invite workspace: g- plus 10 lowercase base32 characters. Matches HANDLE_PATTERN. */
export const INVITE_HANDLE_PREFIX = 'g-';
/** Unclaimed invite workspaces whose agent never called the API are deleted after this. */
export const INVITE_WORKSPACE_IDLE_DAYS = 30;

/** Customer invites (personal and public links). */
export const CUSTOMER_DEFAULT_DAILY_CAP = 20;
export const CUSTOMER_BOT_DAILY_CAP = 300;
/** rate_events.kind for the per-bot guest task cap. The agent id is stored in rate_events.email. */
export const BOT_GUEST_TASK_RATE_KIND = 'bot_guest_task';
export const MAX_PENDING_PER_BOT = 50;
export const PENDING_REQUEST_TTL_DAYS = 14;
export const PREAPPROVED_EMAILS_MAX = 500;
export const PENDING_NOTIFY_INTERVAL_MS = 60 * 60 * 1000;
export const CUSTOMER_LINK_MAX_USES = 100_000;

/** Customer API (R3-R8). */
export const CUSTOMER_BOTS_LIST_MAX = 100;
export const CUSTOMER_NOTES_MAX = 2_000;
export const TASK_ANSWER_MAX = 2_000;
export const CUSTOMER_REQUESTS_PAGE_DEFAULT = 20;
export const CUSTOMER_REQUESTS_PAGE_MAX = 50;

/** Owner branding (spec 13). */
export const BRANDING_LOGO_MAX_BYTES = 512 * 1024;
export const BRANDING_LOGO_RATE_KIND = 'branding_logo';
export const BRANDING_LOGO_UPLOADS_PER_HOUR = 20;
export const BRANDING_LOGO_MIN_PX = 64;
export const BRANDING_LOGO_MAX_PX = 2048;
export const BRANDING_LOGO_OUTPUT_PX = 512;
export const CUSTOMER_INVITE_MAX_TTL_DAYS = 365;
export const CUSTOMER_INVITE_MAX_ACTIVE_PER_AGENT = 200;
/** Name of the hidden, keyless agent a customer workspace sends tasks as. */
export const CUSTOMER_SENDER_NAME = 'valetto';
/** An anonymous agent-guest workspace must be claimed within this many days. */
export const CLAIM_TOKEN_TTL_DAYS = 7;

/**
 * Karim's anonymous agent guests (redeem an rsi_ invite without an account, claim later).
 * Off unless VALETTO_AGENT_GUESTS=1. Read on every call so tests and deploys can flip it.
 */
export function agentGuestsEnabled(): boolean {
  return process.env.VALETTO_AGENT_GUESTS?.trim() === '1';
}

export const RATE_LIMITS = {
  requestCode: { email: 5, ip: 100, windowMs: 15 * 60 * 1000 },
  register: { ip: 60, windowMs: 15 * 60 * 1000 },
  redeem: { ip: 30, windowMs: 15 * 60 * 1000 },
  invitePreview: { ip: 120, windowMs: 15 * 60 * 1000 },
  claimPreview: { ip: 60, windowMs: 15 * 60 * 1000 },
  customerLink: { ip: 60, windowMs: 15 * 60 * 1000 },
  /** Keyed by the signed-in user id (stored where agent keys go). */
  customerAccept: { agent: 20, windowMs: 15 * 60 * 1000 },
  /** R8 answers, keyed by the signed-in user id. */
  customerAnswer: { agent: 30, windowMs: 15 * 60 * 1000 },
  testWake: { agent: 10, windowMs: 15 * 60 * 1000 },
  /** Owner review actions (approve, decline, release, send back), keyed by the signed-in user id. */
  reviewAction: { agent: 300, windowMs: 15 * 60 * 1000 },
  /** review_mode changes, keyed by the signed-in user id. */
  reviewMode: { agent: 30, windowMs: 15 * 60 * 1000 },
  /** Site assistant demo page loads (demo info), per IP (stored as a keyed hash). */
  siteEntry: { ip: 300, windowMs: 15 * 60 * 1000 },
  /** Site assistant demo screenshots, per IP (keyed hash). Their own generous bucket so images never eat siteEntry. */
  siteShot: { ip: 2000, windowMs: 15 * 60 * 1000 },
  /** Site assistant demo messages, per IP (keyed hash). The daily caps in lib/site-assistant/caps.ts sit behind this. */
  siteMessage: { ip: 30, windowMs: 15 * 60 * 1000 },
} as const;

/** A local agent is watcher_online when some non-revoked workspace watcher key polled within this window. */
export const WATCHER_ONLINE_MS = 30_000;

export const WAKE_MAX_ATTEMPTS = 8;
export const WEBHOOK_TIMEOUT_MS = 5_000;
export const RESULT_SCHEMA_MAX_CHARS = 64_000;
/** Offer input shape (input_schema). One flat object of form fields, checked by lib/input-schema.ts. */
export const INPUT_SCHEMA_MAX_CHARS = 8_192;
export const INPUT_MAX_PROPERTIES = 20;
/** Every text field needs maxLength, at most this. */
export const INPUT_STRING_MAX = 1_000;
export const INPUT_ENUM_MAX = 50;
export const INPUT_ENUM_VALUE_MAX = 100;
export const INPUT_PATTERN_MAX = 200;
export const INPUT_TITLE_MAX = 100;
export const INPUT_DESCRIPTION_MAX = 300;
/** JSON.stringify(input).length cap, checked before Ajv runs. */
export const INPUT_MAX_CHARS = 16_000;
/** Notes a guest may add to a form task. Stored in tasks.description. */
export const FORM_NOTES_MAX = 2_000;
export const INPUT_PROPERTY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
/** Compiled input validators kept in memory. */
export const INPUT_VALIDATOR_CACHE_MAX = 500;
export const MESSAGE_BODY_MAX = 32_000;
export const TASK_DESCRIPTION_MAX = 32_000;
export const TASK_TITLE_MAX = 200;

export const PRODUCT_NAME = 'ReplySlip';

export const ONE_LINER =
  'ReplySlip lets AI agents send each other tasks whose answers must match a JSON Schema, and message each other inside a task.';
