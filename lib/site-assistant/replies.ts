/**
 * Fixed server text (spec 4.2). The visitor never sees model text for off_topic or capped. A needs_owner reply is
 * fixed text, except for a checked partial answer placed before the fixed handoff line (partialHandoffReply).
 * Demo replies never ask for an email or phone: the demo takes no visitor contact.
 */
export type ReplyLanguage = 'en' | 'fr';

/** Why a question went to the owner. Public: the page shows the matching demo note. */
export type HandoffReason = 'owner_topic' | 'not_in_context' | 'other_language' | 'check_failed';

/**
 * Language of a fixed reply or demo note. A message in another language ('other') gets the business's language
 * (fr for a French business, en otherwise); the stored language stays 'other'.
 */
export function replyLanguage(language: string | null | undefined, businessLanguage?: string | null): ReplyLanguage {
  if (language === 'other') return businessLanguage === 'fr' ? 'fr' : 'en';
  return language === 'fr' ? 'fr' : 'en';
}

/**
 * `text` closed with a period, without doubling one it already ends with: "613 Fencing Inc." stays as is, "Maple"
 * becomes "Maple.". Use it wherever a sentence ends on a business name.
 */
export function endSentence(text: string): string {
  const trimmed = text.trimEnd();
  return trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
}

export function bannerText(name: string): { en: string; fr: string } {
  return {
    en: `Demo built by Valetto from ${name}'s public pages. Not operated by ${endSentence(name)} Answers may be wrong.`,
    fr: `Démo créée par Valetto à partir des pages publiques de ${endSentence(name)} Non exploitée par ${endSentence(name)} Les réponses peuvent être erronées.`,
  };
}

export function noticeText(): { en: string; fr: string } {
  return {
    en: "This is a demo. Don't type personal details. Messages are deleted after 30 days.",
    fr: "Ceci est une démo. N'entrez pas de renseignements personnels. Les messages sont supprimés après 30 jours.",
  };
}

export function needsOwnerReply(language: ReplyLanguage): string {
  return language === 'fr' ? 'Je vérifie avec l’équipe et je vous reviens.' : "I'll check with the team and get back to you.";
}

/**
 * A needs_owner reply that first answers the parts of the question the business's pages cover (`answered`, model
 * text the server already checked), then hands off only the rest with fixed server text.
 */
export function partialHandoffReply(answered: string, language: ReplyLanguage): string {
  const rest = language === 'fr' ? 'Pour le reste, je vérifie avec l’équipe et je vous reviens.' : "For the rest, I'll check with the team and get back to you.";
  return `${answered.trim()}\n\n${rest}`;
}

export function offTopicReply(language: ReplyLanguage, name: string): string {
  return language === 'fr'
    ? `Je peux seulement répondre aux questions sur ${endSentence(name)}`
    : `I can only help with questions about ${endSentence(name)}`;
}

export function cappedReply(language: ReplyLanguage): string {
  return language === 'fr'
    ? 'Cette démo a atteint la limite de messages du jour. Revenez demain.'
    : 'This demo has reached today’s message limit. Come back tomorrow.';
}

/**
 * Demo-only note under a needs_owner reply, in plain words for the visitor: why it went to the business (named
 * once), and a description of what the live site would do (take an email or phone so the owner can answer). It
 * describes; it never asks, and the demo has no contact step.
 */
export function demoNote(reason: HandoffReason, language: ReplyLanguage, name: string): string {
  if (language === 'fr') {
    const live = 'Sur le vrai site, vous pourriez laisser votre courriel ou votre numéro, et l’entreprise vous répondrait.';
    switch (reason) {
      case 'owner_topic':
        return `Les questions de prix, de disponibilités, de réservations et de plaintes vont directement à ${endSentence(name)} ${live}`;
      case 'not_in_context':
        return `Je n’ai pas trouvé ça sur le site de ${name}, alors je préfère transmettre la question plutôt que de deviner. ${live}`;
      case 'other_language':
        return `Je peux discuter en français et en anglais. Pour les autres langues, je transmettrais votre question à ${endSentence(name)} ${live}`;
      case 'check_failed':
        return `Je n’ai pas de réponse sûre à celle-ci, alors je préfère la transmettre à ${name} plutôt que de deviner. ${live}`;
    }
  }
  const live = "On the live site, you could leave your email or phone and they'd get back to you.";
  switch (reason) {
    case 'owner_topic':
      return `Prices, availability, bookings and complaints always go straight to ${endSentence(name)} ${live}`;
    case 'not_in_context':
      return `I couldn't find this on ${name}'s website, so I'd pass it to them rather than guess. ${live}`;
    case 'other_language':
      return `I can chat in English and French. For other languages, I'd pass your question to ${endSentence(name)} ${live}`;
    case 'check_failed':
      return `I'm not sure about this one, so I'd pass it to ${name} rather than guess. ${live}`;
  }
}
