/**
 * Customer page API types. They mirror spec section 15 (valetto-input-schema-spec.md) field for field,
 * plus the review-first statuses from section 16 and the section 17 clarifications. Nothing here is mock-specific.
 */

export type Branding = {
  display_name: string;
  logo_url: string | null;
  logo_width: number | null;
  logo_height: number | null;
  primary_color: string;
  primary_foreground: string;
  /** Null when the owner set no accent. The page then uses the main color for highlights. */
  accent_color: string | null;
  accent_foreground: string | null;
  /** Section 17.3: the server's contrast verdicts. The page computes them itself only if they're missing. */
  primary_on_white_ok?: boolean;
  /** Section 17.3: always uppercase hex. Anything else is ignored and the page computes its own. */
  on_primary?: OnPrimary;
  show_footer: true;
};

export type OnPrimary = '#000000' | '#FFFFFF';
export type ReviewMode = 'auto' | 'review_first';

export type AccessMode = 'open_link' | 'approve_each';
export type ShareStatus = 'pending' | 'approved' | 'revoked';
export type LinkNext = 'sign_in' | 'accept' | 'open_bot' | 'wait' | 'blocked';

/** R1 `GET /api/v1/c/links/:token` */
export type LinkResponse = {
  link: { kind: 'public' | 'personal'; email_bound: boolean; expires_at: string | null };
  bot: { agent_id: string; branding: Branding };
  access_mode: AccessMode;
  viewer: { signed_in: boolean; share_status?: ShareStatus | null };
  next: LinkNext;
};

/** R2 `POST /api/v1/c/links/:token/accept` */
export type AcceptResponse = {
  share: { status: 'approved' | 'pending'; requested_at: string };
  bot: { agent_id: string };
  next: 'open_bot' | 'wait';
};

/* ---------- Input shape (spec 5.2): one flat object, five field kinds ---------- */

type FieldBase = { title?: string; description?: string };
export type TextField = FieldBase & { type: 'string'; enum?: undefined; maxLength: number; minLength?: number; pattern?: string; default?: string };
export type ChoiceField = FieldBase & { type: 'string'; enum: string[]; 'x-enum-titles'?: string[]; default?: string };
export type NumberField = FieldBase & { type: 'number' | 'integer'; minimum?: number; maximum?: number; default?: number };
export type BooleanField = FieldBase & { type: 'boolean'; default?: boolean };
export type MultiChoiceField = FieldBase & {
  type: 'array';
  /** Section 17.9: `items['x-enum-titles']` is the canonical place. */
  items: { type: 'string'; enum: string[]; 'x-enum-titles'?: string[] };
  /** Legacy array-level titles (the 15.5 example). The server normalizes these onto items; still read as a fallback. */
  'x-enum-titles'?: string[];
  minItems?: number;
  maxItems?: number;
  uniqueItems?: true;
  default?: string[];
};
export type InputField = TextField | ChoiceField | NumberField | BooleanField | MultiChoiceField;

export type InputSchema = {
  $schema?: string;
  type: 'object';
  title?: string;
  description?: string;
  properties: Record<string, InputField>;
  required?: string[];
  additionalProperties: false;
  'x-order': string[];
};

export type InputValue = string | number | boolean | string[];
export type InputObject = Record<string, InputValue>;

export type ResultField = { key: string; label: string; type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'json' };

export type Job = {
  name: string;
  /** Section 17.10: the offer's display name, present on every job (also when input_schema is null). */
  title: string;
  description: string;
  input_schema: InputSchema | null;
  notes_enabled: boolean;
  notes_max: number;
  result_fields: ResultField[];
};

export type ApprovedShare = { status: 'approved'; daily_cap: number; used_today: number; resets_at: string | null };
export type PendingShare = { status: 'pending'; requested_at: string };
export type RevokedShare = { status: 'revoked' };

/** R4 `GET /api/v1/c/bots/:agent_id` */
export type BotResponse = {
  bot: { agent_id: string; branding: Branding };
  /** Section 17.1: mirrors share.status. When "pending", `jobs` is the full list and the form shows disabled. */
  access: ShareStatus;
  /** Section 17.7. */
  review_mode: ReviewMode;
  share: ApprovedShare | PendingShare | RevokedShare;
  /** Full list for approved and pending; empty when revoked. */
  jobs: Job[];
};

/** R3 `GET /api/v1/c/bots` */
export type BotsResponse = {
  bots: { agent_id: string; branding: Branding; share_status: ShareStatus; open_requests: number }[];
};

/**
 * Request status. The first four are section 15.7. `in_review` and `awaiting_release` are the
 * review-first checkpoints from section 16 (names confirmed by PlumberBot).
 */
export type RequestStatus = 'in_review' | 'open' | 'needs_info' | 'awaiting_release' | 'done' | 'failed';

export type DisplayRow = { key: string; label: string; value: string };
export type ResultDisplayRow = DisplayRow & { kind: 'text' | 'number' | 'boolean' | 'list' | 'json' };
/** Section 17.5. */
export type FailCode = 'declined_by_owner' | 'bot_failed' | 'expired';

/** Section 17.4: R6 filter values. */
export type RequestListFilter = RequestStatus;

export type Answer = { question: string; answer: string; asked_at: string; answered_at: string };

/** R7 `GET /api/v1/c/requests/:task_id` (also the body of R5 and R8) */
export type CustomerRequest = {
  id: string;
  bot: { agent_id: string };
  offer: string;
  title: string;
  status: RequestStatus;
  input: InputObject | null;
  input_display: DisplayRow[];
  notes: string | null;
  question: string | null;
  answers: Answer[];
  result: unknown;
  result_display: ResultDisplayRow[];
  /** Section 17.5: set only when failed. */
  fail_code: FailCode | null;
  /** The bot's own words. Untrusted: render as plain text only. */
  fail_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type RequestResponse = { request: CustomerRequest };

/** R6 rows: R7 without `input` and `result`, plus `summary`. The spec's example row is shown trimmed. */
export type RequestListRow = Pick<CustomerRequest, 'id' | 'offer' | 'title' | 'status' | 'created_at' | 'updated_at'> & { summary: string };

/** R6 `GET /api/v1/c/bots/:agent_id/requests` */
export type RequestListResponse = { requests: RequestListRow[]; next_cursor: string | null; etag: string };

/** R5 body */
export type CreateRequestBody = { offer: string; input?: InputObject; notes?: string; client_request_id?: string };

export type Me = { user: { id: string; email: string } };

/** Error envelope `{ error: { code, message, details? } }` (spec 15.1). */
export type ApiErrorBody = {
  code: string;
  message: string;
  details?: { fields?: Record<string, string>; retry_after_seconds?: number; daily_cap?: number; [k: string]: unknown };
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorBody['details'];
  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}
