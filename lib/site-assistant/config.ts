/**
 * Site assistant settings. Everything is read from env at call time, so tests and scripts can change it.
 * The API key is only ever read server-side and never logged.
 */
export const SITE_DEFAULT_MODEL = 'gpt-6-luna';
/** Tried once when the primary model is not found or returns a 5xx. SITE_LLM_FALLBACK_MODEL=off disables it. */
export const SITE_DEFAULT_FALLBACK_MODEL = 'gpt-6.1-terra';
/** gpt-6-luna list prices, USD per million tokens. Override with SITE_LLM_PRICE_IN_PER_M / _OUT_PER_M. */
export const SITE_DEFAULT_PRICE_IN_PER_M = 0.1;
export const SITE_DEFAULT_PRICE_OUT_PER_M = 0.5;
export const SITE_DEFAULT_MAX_OUTPUT_TOKENS = 800;
export const SITE_DEFAULT_TIMEOUT_MS = 20_000;
/** Lowest effort on current OpenAI reasoning models. Set SITE_LLM_REASONING_EFFORT=off to omit the field. */
export const SITE_DEFAULT_REASONING_EFFORT = 'none';
export const SITE_DEFAULT_GLOBAL_DAILY_COST_CAP_USD = 5;
/**
 * Typed messages per IP per UTC day: on one demo link, and across all demo links. These sit beside the per-cookie
 * visitor cap so clearing cookies doesn't reset the limit. Override with SITE_IP_DAILY_MESSAGES_PER_LINK and
 * SITE_IP_DAILY_MESSAGES.
 */
export const SITE_DEFAULT_IP_DAILY_MESSAGES_PER_LINK = 20;
export const SITE_DEFAULT_IP_DAILY_MESSAGES = 40;

/** Visitor question limit, in characters. */
export const SITE_MESSAGE_MAX_CHARS = 1_000;
/** Conversation history sent to the model: last N messages, capped in characters (oldest dropped first). */
export const SITE_HISTORY_MAX_MESSAGES = 20;
export const SITE_HISTORY_MAX_CHARS = 8_000;
/** Context sent to the model, in characters (spec SITE_CONTEXT_MAX_CHARS). */
export const SITE_CONTEXT_MAX_CHARS = 60_000;
/** Demo links expire after this many days; demo conversations are deleted this many days after the last message. */
export const SITE_DEMO_LINK_TTL_DAYS = 30;
export const SITE_DEMO_RETENTION_DAYS = 30;

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export type SiteLlmConfig = {
  apiKey: string | null;
  model: string;
  /** null: no fallback. */
  fallbackModel: string | null;
  baseUrl: string;
  maxOutputTokens: number;
  reasoningEffort: string | null;
  timeoutMs: number;
  priceInPerM: number;
  priceOutPerM: number;
  /**
   * The fallback model's own prices, USD per million tokens. No default: the repo has no list price for it, so
   * the fallback only runs once both are set.
   */
  fallbackPriceInPerM: number | null;
  fallbackPriceOutPerM: number | null;
};

function fallbackModelEnv(): string | null {
  const raw = process.env.SITE_LLM_FALLBACK_MODEL?.trim() || SITE_DEFAULT_FALLBACK_MODEL;
  return raw === 'off' ? null : raw;
}

export function siteLlmConfig(): SiteLlmConfig {
  const effort = process.env.SITE_LLM_REASONING_EFFORT?.trim() || SITE_DEFAULT_REASONING_EFFORT;
  return {
    apiKey: process.env.SITE_LLM_API_KEY?.trim() || null,
    model: process.env.SITE_LLM_MODEL?.trim() || SITE_DEFAULT_MODEL,
    fallbackModel: fallbackModelEnv(),
    baseUrl: (process.env.SITE_LLM_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    maxOutputTokens: Math.max(1, Math.floor(numberEnv('SITE_LLM_MAX_OUTPUT_TOKENS', SITE_DEFAULT_MAX_OUTPUT_TOKENS))),
    reasoningEffort: effort === 'off' ? null : effort,
    timeoutMs: numberEnv('SITE_LLM_TIMEOUT_MS', SITE_DEFAULT_TIMEOUT_MS),
    priceInPerM: numberEnv('SITE_LLM_PRICE_IN_PER_M', SITE_DEFAULT_PRICE_IN_PER_M),
    priceOutPerM: numberEnv('SITE_LLM_PRICE_OUT_PER_M', SITE_DEFAULT_PRICE_OUT_PER_M),
    fallbackPriceInPerM: optionalPriceEnv('SITE_LLM_FALLBACK_PRICE_IN_PER_M'),
    fallbackPriceOutPerM: optionalPriceEnv('SITE_LLM_FALLBACK_PRICE_OUT_PER_M'),
  };
}

function optionalPriceEnv(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** The config for the fallback call, at the fallback model's own prices; null when there's no usable fallback. */
export function siteFallbackLlmConfig(config: SiteLlmConfig): SiteLlmConfig | null {
  if (!config.fallbackModel || config.fallbackModel === config.model) return null;
  if (config.fallbackPriceInPerM === null || config.fallbackPriceOutPerM === null) return null;
  return {
    ...config,
    model: config.fallbackModel,
    priceInPerM: config.fallbackPriceInPerM,
    priceOutPerM: config.fallbackPriceOutPerM,
  };
}

/** Global LLM spend cap per UTC day, in micro-USD. */
export function siteGlobalDailyCostCapMicroUsd(): number {
  return Math.round(numberEnv('SITE_DAILY_COST_CAP_USD', SITE_DEFAULT_GLOBAL_DAILY_COST_CAP_USD) * 1_000_000);
}

export function siteIpDailyLimits(): { perLink: number; all: number } {
  return {
    perLink: Math.floor(numberEnv('SITE_IP_DAILY_MESSAGES_PER_LINK', SITE_DEFAULT_IP_DAILY_MESSAGES_PER_LINK)),
    all: Math.floor(numberEnv('SITE_IP_DAILY_MESSAGES', SITE_DEFAULT_IP_DAILY_MESSAGES)),
  };
}

/** The /s and /api/v1/s routes 404 unless VALETTO_SITE_ASSISTANT=1 (spec section 5). */
export function siteAssistantEnabled(): boolean {
  return process.env.VALETTO_SITE_ASSISTANT === '1';
}

/** Cost in micro-USD, rounded up. Prices are USD per million tokens, so tokens x price = micro-USD. */
export function costMicroUsd(inputTokens: number, outputTokens: number, config: SiteLlmConfig): number {
  return Math.ceil(inputTokens * config.priceInPerM + outputTokens * config.priceOutPerM);
}

/**
 * Conservative input-token estimate: 1 token per 3 characters (English runs near 4, French near 3.5), plus a
 * fixed overhead for message framing.
 */
export function estimateInputTokens(chars: number): number {
  return Math.ceil(chars / 3) + 64;
}
