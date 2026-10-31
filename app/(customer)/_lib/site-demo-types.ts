/**
 * Site assistant demo (valetto-site-assistant-spec.md, Stories 1 to 3, slim story 0 cut; backend in PR #112).
 * Shapes for `GET /api/v1/s/demo/<token>` and `POST /api/v1/s/demo/<token>/messages` (docs/API.md).
 */
export type Lang = 'en' | 'fr';

export type BusinessStatus = 'unclaimed' | 'claimed' | 'public';
export type ReplyStatus = 'answered' | 'needs_owner' | 'off_topic';

export type DemoBusiness = {
  name: string;
  status: BusinessStatus;
  /** `logo_url` is always null for now; the tile shows initials from `name` on `color`. */
  tile: { color: string; logo_url: string | null };
  /** Main language of the business's own site. Picks the page language until the visitor switches. */
  language: string;
};

export type SuggestedQuestion = {
  id: string;
  question: string;
  answer: string;
  language: string;
  checked_at: string;
};

export type DemoMessage = {
  id: string;
  role: 'visitor' | 'assistant' | 'owner';
  body: string;
  /** Assistant rows only. */
  status: ReplyStatus | null;
  created_at: string;
  language?: string | null;
  client_message_id?: string | null;
  suggested_question_id?: string | null;
  /** needs_owner only: the server's note on why the question went to the owner, in the reply's language. */
  demo_note?: string | null;
};

export type DemoConversation = {
  business: DemoBusiness;
  /** Shown exactly as sent. */
  banner: Record<Lang, string>;
  suggested_questions: SuggestedQuestion[];
  /** This visitor's conversation, oldest first (visitor cookie). */
  messages: DemoMessage[];
  /** Plain text under the input until the first message. */
  notice?: Partial<Record<Lang, string>> | null;
  expires_at?: string;
  message_max_chars?: number;
};

export type SendBody = { client_message_id: string } & ({ text: string } | { suggested_question_id: string });

export type SendResponse = { message: DemoMessage };

export class DemoApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
