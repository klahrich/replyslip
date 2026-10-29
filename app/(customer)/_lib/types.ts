/**
 * Customer page API types. They mirror spec section 15 (valetto-input-schema-spec.md) field for field,
 * plus the two review-first statuses from section 16. Nothing here is mock-specific.
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
  show_footer: true;
};

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
  items: { type: 'string'; enum: string[]; 'x-enum-titles'?: string[] };
  /** Section 15.5's example puts the titles here; 5.2 implies `items`. The page reads both. */
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
  description: string;
  input_schema: InputSchema | null;
  notes_enabled: boolean;
  notes_max: number;
  result_fields: ResultField[];
};

export type ApprovedShare = { status: 'approved'; daily_cap: number; used_today: number; resets_at: string };
export type PendingShare = { status: 'pending'; requested_at: string };
export type RevokedShare = { status: 'revoked' };

/** R4 `GET /api/v1/c/bots/:agent_id` */
export type BotResponse = {
  bot: { agent_id: string; branding: Branding };
  share: ApprovedShare | PendingShare | RevokedShare;
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
  notes: string;
  question: string | null;
  answers: Answer[];
  result: unknown;
  result_display: ResultDisplayRow[];
  fail_reason: string | null;
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
