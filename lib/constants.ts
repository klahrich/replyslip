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
export const OFFER_DESCRIPTION_MAX = 4_000;
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

export const RATE_LIMITS = {
  requestCode: { email: 5, ip: 100, windowMs: 15 * 60 * 1000 },
  register: { ip: 60, windowMs: 15 * 60 * 1000 },
  testWake: { agent: 10, windowMs: 15 * 60 * 1000 },
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
