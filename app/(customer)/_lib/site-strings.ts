/** Fixed strings for the site assistant demo (spec Stories 1 and 3), English and French. */
import type { Lang } from './site-demo-types';

const en = {
  greeting: (name: string) => `Hi. I answer questions about ${name} from its website.`,
  youCanAsk: 'You can ask',
  inputLabel: 'Your question',
  send: 'Send',
  thinking: 'Looking for the answer…',
  demoNote:
    'On your live site, the visitor leaves an email or phone here and the question comes to you. Your assistant leaves prices, availability, bookings and complaints to you.',
  demoCap: "This demo has reached today's message limit. Come back tomorrow.",
  notSent: 'Not sent.',
  tryAgain: 'Try again',
  tooLong: 'Keep your question under 1,000 characters.',
  rateLimited: 'Too many tries. Wait a few minutes, then try again.',
  deadTitle: 'This link no longer works',
  deadBody: 'Ask the person who sent it for a new one.',
  expiredTitle: 'This demo has expired',
  expiredBody: 'Demo links last 30 days. Ask the person who sent it for a new one.',
  loadFailed: "We couldn't load this demo. Check your connection and try again.",
  you: 'You',
  loading: 'Loading',
  chars: (n: number) => `${n} of 1,000 characters`,
};

const fr: typeof en = {
  greeting: (name) => `Bonjour. Je réponds aux questions sur ${name} à partir de son site web.`,
  youCanAsk: 'Vous pouvez demander',
  inputLabel: 'Votre question',
  send: 'Envoyer',
  thinking: 'Je cherche la réponse…',
  demoNote:
    'Sur votre site, le visiteur laisse ici son courriel ou son numéro, et la question vous arrive. Votre assistant vous laisse les questions de prix, de disponibilités, de réservations et de plaintes.',
  demoCap: 'Cette démo a atteint la limite de messages du jour. Revenez demain.',
  notSent: 'Non envoyé.',
  tryAgain: 'Réessayer',
  tooLong: 'Votre question doit faire moins de 1 000 caractères.',
  rateLimited: "Trop d'essais. Attendez quelques minutes, puis réessayez.",
  deadTitle: 'Ce lien ne fonctionne plus',
  deadBody: "Demandez-en un nouveau à la personne qui vous l'a envoyé.",
  expiredTitle: 'Cette démo a expiré',
  expiredBody: "Les liens de démo durent 30 jours. Demandez-en un nouveau à la personne qui vous l'a envoyé.",
  loadFailed: "Nous n'avons pas pu charger cette démo. Vérifiez votre connexion, puis réessayez.",
  you: 'Vous',
  loading: 'Chargement',
  chars: (n) => `${n} sur 1 000 caractères`,
};

export const SITE_STRINGS: Record<Lang, typeof en> = { en, fr };
export type SiteStrings = typeof en;
