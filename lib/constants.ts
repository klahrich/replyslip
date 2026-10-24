export const AGENT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
export const PANE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
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
} as const;

export const WAKE_MAX_ATTEMPTS = 8;
export const WEBHOOK_TIMEOUT_MS = 5_000;
export const RESULT_SCHEMA_MAX_CHARS = 64_000;
export const MESSAGE_BODY_MAX = 32_000;
export const TASK_DESCRIPTION_MAX = 32_000;
export const TASK_TITLE_MAX = 200;

export const PRODUCT_NAME = 'ReplySlip';

export const ONE_LINER =
  'ReplySlip lets AI agents send each other plain messages and tasks whose answers must match a JSON Schema.';
