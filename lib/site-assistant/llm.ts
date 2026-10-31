import type { SiteLlmConfig } from './config';
import { SITE_ANSWER_JSON_SCHEMA } from './schema';

/**
 * One stateless call to the OpenAI Responses API with strict structured output. The HTTP layer is injectable so
 * tests never reach a real model: pass `transport`, or set one with setSiteLlmTransportForTests.
 */
export type SiteLlmHttpRequest = { url: string; headers: Record<string, string>; body: string; signal: AbortSignal };
export type SiteLlmHttpResponse = { status: number; text: string };
export type SiteLlmTransport = (req: SiteLlmHttpRequest) => Promise<SiteLlmHttpResponse>;

const fetchTransport: SiteLlmTransport = async (req) => {
  const res = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body, signal: req.signal });
  return { status: res.status, text: await res.text() };
};

let transportForTests: SiteLlmTransport | null = null;

/** Test hook, like setEmailSenderForTests. null restores the real fetch transport. */
export function setSiteLlmTransportForTests(transport: SiteLlmTransport | null): void {
  transportForTests = transport;
}

export function currentSiteLlmTransport(): SiteLlmTransport {
  return transportForTests ?? fetchTransport;
}

export type SiteLlmCallResult =
  | { kind: 'ok'; outputText: string; inputTokens: number; outputTokens: number }
  | { kind: 'invalid'; detail: string; inputTokens: number; outputTokens: number }
  | { kind: 'error'; detail: string; inputTokens: number; outputTokens: number; httpStatus?: number; errorCode?: string }
  | { kind: 'timeout' };

export function buildResponsesBody(config: SiteLlmConfig, instructions: string, input: string): Record<string, unknown> {
  return {
    model: config.model,
    instructions,
    input: [{ role: 'user', content: [{ type: 'input_text', text: input }] }],
    text: { format: { type: 'json_schema', name: 'site_answer', strict: true, schema: SITE_ANSWER_JSON_SCHEMA } },
    max_output_tokens: config.maxOutputTokens,
    ...(config.reasoningEffort ? { reasoning: { effort: config.reasoningEffort } } : {}),
    store: false,
  };
}

type ResponsesPayload = {
  status?: string;
  output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string; code?: string | null; type?: string | null } | null;
};

function usageOf(payload: ResponsesPayload | null): { inputTokens: number; outputTokens: number } {
  const input = Number(payload?.usage?.input_tokens ?? 0);
  const output = Number(payload?.usage?.output_tokens ?? 0);
  return {
    inputTokens: Number.isFinite(input) && input > 0 ? Math.floor(input) : 0,
    outputTokens: Number.isFinite(output) && output > 0 ? Math.floor(output) : 0,
  };
}

export async function callSiteLlm(
  config: SiteLlmConfig,
  instructions: string,
  input: string,
  transport: SiteLlmTransport = currentSiteLlmTransport(),
): Promise<SiteLlmCallResult> {
  if (!config.apiKey) return { kind: 'error', detail: 'SITE_LLM_API_KEY is not set', inputTokens: 0, outputTokens: 0 };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.timeoutMs);
  let res: SiteLlmHttpResponse;
  try {
    const call = transport({
      url: `${config.baseUrl}/responses`,
      headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(buildResponsesBody(config, instructions, input)),
      signal: controller.signal,
    });
    // A transport that ignores the signal still loses the race.
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    res = await Promise.race([call, aborted]);
  } catch (err) {
    if (timedOut) return { kind: 'timeout' };
    return { kind: 'error', detail: err instanceof Error ? err.name : 'transport error', inputTokens: 0, outputTokens: 0 };
  } finally {
    clearTimeout(timer);
  }

  let payload: ResponsesPayload | null = null;
  try {
    payload = JSON.parse(res.text) as ResponsesPayload;
  } catch {
    payload = null;
  }
  const usage = usageOf(payload);
  if (res.status < 200 || res.status >= 300) {
    const code = payload?.error?.code ?? payload?.error?.type ?? undefined;
    return { kind: 'error', detail: `http ${res.status}`, ...usage, httpStatus: res.status, ...(code ? { errorCode: String(code) } : {}) };
  }
  if (!payload) return { kind: 'invalid', detail: 'response is not JSON', ...usage };
  if (payload.status !== 'completed') return { kind: 'invalid', detail: `status ${payload.status ?? 'missing'}`, ...usage };
  const parts = (payload.output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? []);
  if (parts.some((part) => part.type === 'refusal')) return { kind: 'invalid', detail: 'refusal', ...usage };
  const text = parts
    .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
  if (!text) return { kind: 'invalid', detail: 'no output_text', ...usage };
  return { kind: 'ok', outputText: text, ...usage };
}

/** The primary model is missing or the provider failed on its side: worth one try on the fallback model. */
export function shouldTryFallback(result: SiteLlmCallResult): boolean {
  if (result.kind !== 'error' || result.httpStatus === undefined) return false;
  return result.httpStatus >= 500 || result.errorCode === 'model_not_found';
}
