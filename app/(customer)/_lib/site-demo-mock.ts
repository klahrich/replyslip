/**
 * Mock for the site assistant demo routes. Dev only (VALETTO_MOCK=1). Delete this file when
 * PlumberBot's routes land. The business is made up; no real business's text or screenshot.
 *
 * Tokens: demo-sample (works), demo-capped (every typed message hits the daily cap),
 * demo-loadfail (first load fails, retry works), demo-longname (120-character name), demo-expired (410),
 * anything else (404). Setting sessionStorage "vt-demo-mock:revoked" to a token makes it 404 (a rotated link).
 * Typed messages: price, booking or availability words -> needs_owner; weather, joke or pizza -> off_topic;
 * "#fail" fails once per client_message_id, then works on retry; "#cap" -> 429 cap_reached.
 */
import type { DemoApi } from './site-demo-api';
import { DemoApiError, type DemoConversation, type DemoMessage, type Lang, type ReplyStatus } from './site-demo-types';

const NAME = 'Sample Frame Shop';
const LONG_NAME = 'Sample Frame Shop and Gallery of Custom Picture Framing, Mirror Repair, Jersey Shadow Boxes and Art Hanging Services Inc';
const KNOWN = new Set(['demo-sample', 'demo-capped', 'demo-loadfail', 'demo-longname']);
const failedOnce = new Set<string>();
// demo-loadfail fails the loads that start within 200 ms of the first (React dev mode loads twice), so a later Try again works.
let firstLoadAt = 0;

const banner = (b: string): Record<Lang, string> => ({
  en: `Demo built by Valetto from ${b}'s public pages. Not operated by ${b}. Answers may be wrong.`,
  fr: `Démo créée par Valetto à partir des pages publiques de ${b}. ${b} ne l'exploite pas. Les réponses peuvent être erronées.`,
});

const SUGGESTED: DemoConversation['suggested_questions'] = [
  { id: 'sq-en-1', language: 'en', checked_at: '2026-10-29T14:00:00Z', question: 'What are your opening hours?', answer: 'Sample Frame Shop is open Tuesday to Saturday, 10 am to 6 pm. It is closed Sunday and Monday.' },
  { id: 'sq-en-2', language: 'en', checked_at: '2026-10-29T14:00:00Z', question: 'Do you frame sports jerseys?', answer: 'Yes. Sample Frame Shop frames jerseys in shadow boxes with UV-filtering glass.' },
  { id: 'sq-en-3', language: 'en', checked_at: '2026-10-29T14:00:00Z', question: 'Where are you located?', answer: 'The shop is at 123 Example Street, in the old market building. Street parking is free after 6 pm.' },
  { id: 'sq-fr-1', language: 'fr', checked_at: '2026-10-29T14:00:00Z', question: "Quelles sont vos heures d'ouverture?", answer: 'Sample Frame Shop est ouvert du mardi au samedi, de 10 h à 18 h. Fermé le dimanche et le lundi.' },
  { id: 'sq-fr-2', language: 'fr', checked_at: '2026-10-29T14:00:00Z', question: 'Encadrez-vous des chandails de sport?', answer: 'Oui. Sample Frame Shop encadre les chandails dans des boîtes vitrées avec un verre anti-UV.' },
  { id: 'sq-fr-3', language: 'fr', checked_at: '2026-10-29T14:00:00Z', question: 'Où êtes-vous situés?', answer: "La boutique est au 123, rue Exemple, dans l'ancien marché. Le stationnement dans la rue est gratuit après 18 h." },
];

const OWNER_WORDS = /\b(prix|price|prices|cost|costs|combien|how much|quote|devis|soumission|book|booking|reserve|réserver|rendez-vous|appointment|available|disponible|disponibilités?|refund|rembourse\w*)\b|\$/i;
const OFF_TOPIC = /\b(weather|joke|pizza|météo|blague)\b/i;
const FRENCH = /[àâçéèêëîïôûùüÿœ]|\b(bonjour|vous|est-ce|quels?|quelles?|combien|heures?|où|merci|le|la|les|des)\b/i;

const FIXED: Record<'needs_owner' | 'off_topic', Record<Lang, string>> = {
  // Demo version of the needs_owner reply: no contact sentence (the demo never asks for contact).
  needs_owner: { en: "I'll check with the team and get back to you.", fr: "Je vérifie avec l'équipe et je vous reviens." },
  off_topic: { en: `I can only help with questions about ${NAME}.`, fr: `Je peux seulement répondre aux questions sur ${NAME}.` },
};
const ANSWER: Record<Lang, string> = {
  en: 'Sample Frame Shop does custom framing for art, photos, mirrors and jerseys, and repairs old frames. Most frames are ready in about two weeks.',
  fr: 'Sample Frame Shop fait de l’encadrement sur mesure pour les œuvres, les photos, les miroirs et les chandails, et répare les vieux cadres. La plupart des cadres sont prêts en deux semaines environ.',
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const key = (token: string) => `vt-demo-mock:${token}`;

function stored(token: string): DemoMessage[] {
  try {
    return JSON.parse(sessionStorage.getItem(key(token)) ?? '[]') as DemoMessage[];
  } catch {
    return [];
  }
}
function save(token: string, rows: DemoMessage[]) {
  sessionStorage.setItem(key(token), JSON.stringify([...stored(token), ...rows]));
}
function check(token: string) {
  if (token === 'demo-expired') throw new DemoApiError(410, 'demo_expired', 'This demo has expired.');
  if (!KNOWN.has(token) || sessionStorage.getItem('vt-demo-mock:revoked') === token) throw new DemoApiError(404, 'demo_not_found', 'Not found.');
}
const row = (role: DemoMessage['role'], body: string, status: ReplyStatus | null): DemoMessage => ({
  id: crypto.randomUUID(),
  role,
  body,
  status,
  created_at: now(),
});

export const mockDemoApi: DemoApi = {
  async load(token) {
    await wait(300);
    check(token);
    if (token === 'demo-loadfail' && (firstLoadAt ||= Date.now()) > Date.now() - 200) {
      throw new DemoApiError(0, 'network_error', 'Network error');
    }
    const name = token === 'demo-longname' ? LONG_NAME : NAME;
    return {
      business: { name, status: 'unclaimed', tile: { color: '#2F5D50', logo_url: null } },
      banner: banner(name),
      suggested_questions: SUGGESTED,
      messages: stored(token),
    };
  },

  async send(token, body) {
    check(token);
    if ('suggested_question_id' in body) {
      const sq = SUGGESTED.find((s) => s.id === body.suggested_question_id);
      if (!sq) throw new DemoApiError(404, 'not_found', 'Not found.');
      const reply = row('assistant', sq.answer, 'answered');
      save(token, [row('visitor', sq.question, null), reply]);
      return { message: reply };
    }
    const text = body.text.trim();
    await wait(1200);
    if (text.length > 1000) throw new DemoApiError(400, 'message_too_long', 'Too long.');
    if (token === 'demo-capped' || text.includes('#cap')) throw new DemoApiError(429, 'cap_reached', 'Daily limit reached.');
    if (text.includes('#fail') && !failedOnce.has(body.client_message_id)) {
      failedOnce.add(body.client_message_id);
      throw new DemoApiError(0, 'network_error', 'Network error');
    }
    const lang: Lang = FRENCH.test(text) ? 'fr' : 'en';
    const status: ReplyStatus = OWNER_WORDS.test(text) ? 'needs_owner' : OFF_TOPIC.test(text) ? 'off_topic' : 'answered';
    const reply = row('assistant', status === 'answered' ? ANSWER[lang] : FIXED[status][lang], status);
    save(token, [row('visitor', text, null), reply]);
    return { message: reply };
  },
};
