/** Fixed strings for the site assistant demo (spec Stories 1 and 3), English and French. */
import type { Lang } from './site-demo-types';

const en = {
  greeting: (name: string) => `Hi. I answer questions about ${name} from its website.`,
  youCanAsk: 'You can ask',
  inputLabel: 'Your question',
  send: 'Send',
  thinking: 'Looking for the answer…',
  /** Only when the server sends no demo note of its own. */
  demoLabel: 'Demo',
  demoNote: (name: string) => `I'd pass this one to ${name}. On the live site, you could leave your email or phone and they'd get back to you.`,
  demoCap: "This demo has reached today's message limit. Come back tomorrow.",
  notSent: 'Not sent.',
  tryAgain: 'Try again',
  tooLong: (max: number) => `Keep your question under ${max.toLocaleString('en-CA')} characters.`,
  rateLimited: 'Too many tries. Wait a few minutes, then try again.',
  busy: 'That one didn’t go through. Try again in a moment.',
  network: 'Couldn’t connect. Check your connection, then try again.',
  server: 'Something went wrong on our side. Try again in a moment.',
  badRequest: 'This message couldn’t be sent. Try rewording it.',
  deadTitle: 'This link no longer works',
  deadBody: 'Ask the person who sent it for a new one.',
  expiredTitle: 'This demo has expired',
  expiredBody: 'Demo links last 30 days. Ask the person who sent it for a new one.',
  loadFailed: "We couldn't load this demo. Check your connection and try again.",
  you: 'You',
  loading: 'Loading',
  chars: (n: number, max: number) => `${n.toLocaleString('en-CA')} of ${max.toLocaleString('en-CA')} characters`,
};

const fr: typeof en = {
  greeting: (name) => `Bonjour. Je réponds aux questions sur ${name} à partir de son site web.`,
  youCanAsk: 'Vous pouvez demander',
  inputLabel: 'Votre question',
  send: 'Envoyer',
  thinking: 'Je cherche la réponse…',
  demoLabel: 'Démo',
  demoNote: (name) => `Je transmettrais cette question à ${name}. Sur le vrai site, vous pourriez laisser votre courriel ou votre numéro, et l’entreprise vous répondrait.`,
  demoCap: 'Cette démo a atteint la limite de messages du jour. Revenez demain.',
  notSent: 'Non envoyé.',
  tryAgain: 'Réessayer',
  tooLong: (max) => `Votre question doit faire moins de ${max.toLocaleString('fr-CA')} caractères.`,
  rateLimited: "Trop d'essais. Attendez quelques minutes, puis réessayez.",
  busy: 'Ce message n’est pas passé. Réessayez dans un instant.',
  network: 'Connexion impossible. Vérifiez votre connexion, puis réessayez.',
  server: 'Un problème est survenu de notre côté. Réessayez dans un instant.',
  badRequest: 'Ce message n’a pas pu être envoyé. Essayez de le reformuler.',
  deadTitle: 'Ce lien ne fonctionne plus',
  deadBody: "Demandez-en un nouveau à la personne qui vous l'a envoyé.",
  expiredTitle: 'Cette démo a expiré',
  expiredBody: "Les liens de démo durent 30 jours. Demandez-en un nouveau à la personne qui vous l'a envoyé.",
  loadFailed: "Nous n'avons pas pu charger cette démo. Vérifiez votre connexion, puis réessayez.",
  you: 'Vous',
  loading: 'Chargement',
  chars: (n, max) => `${n.toLocaleString('fr-CA')} sur ${max.toLocaleString('fr-CA')} caractères`,
};

export const SITE_STRINGS: Record<Lang, typeof en> = { en, fr };
export type SiteStrings = typeof en;
