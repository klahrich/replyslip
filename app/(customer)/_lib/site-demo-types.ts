/**
 * Site assistant demo (valetto-site-assistant-spec.md, Stories 1 to 3, slim story 0 cut).
 * Shapes for `GET /api/v1/s/demo/<token>` and `POST /api/v1/s/demo/<token>/messages`.
 * Fields marked "guess" are not pinned down in the spec yet; see the PR description.
 */
export type Lang = 'en' | 'fr';

export type BusinessStatus = 'unclaimed' | 'claimed' | 'public';
export type ReplyStatus = 'answered' | 'needs_owner' | 'off_topic';

export type DemoBusiness = {
  name: string;
  status: BusinessStatus;
  /** guess: the tile is the brand color plus an optional logo; initials come from `name`. */
  tile: { color: string; logo_url: string | null };
};

export type SuggestedQuestion = {
  id: string;
  question: string;
  answer: string;
  language: Lang;
  checked_at: string;
};

export type DemoMessage = {
  id: string;
  role: 'visitor' | 'assistant' | 'owner';
  body: string;
  /** Assistant rows only. */
  status: ReplyStatus | null;
  created_at: string;
};

export type DemoConversation = {
  business: DemoBusiness;
  /** Shown as is (EvaluatorBot's wording). */
  banner: Record<Lang, string>;
  suggested_questions: SuggestedQuestion[];
  /** guess: the saved conversation, oldest first, so a returning visitor sees it again. */
  messages: DemoMessage[];
};

export type SendBody = { client_message_id: string } & ({ text: string } | { suggested_question_id: string });

/** guess: one JSON reply (no stream). */
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
