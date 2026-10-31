/**
 * Fixed server text (spec 4.2). The visitor never sees model text for needs_owner, off_topic or capped.
 * Demo replies never ask for an email or phone: the demo takes no visitor contact.
 */
export type ReplyLanguage = 'en' | 'fr';

/** Why a question went to the owner. Public: the page shows the matching demo note. */
export type HandoffReason = 'owner_topic' | 'not_in_context' | 'other_language' | 'check_failed';

export function replyLanguage(language: string | null | undefined): ReplyLanguage {
  return language === 'fr' ? 'fr' : 'en';
}

export function bannerText(name: string): { en: string; fr: string } {
  return {
    en: `Demo built by Valetto from ${name}'s public pages. Not operated by ${name}. Answers may be wrong.`,
    fr: `Démo créée par Valetto à partir des pages publiques de ${name}. Non exploitée par ${name}. Les réponses peuvent être erronées.`,
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

export function offTopicReply(language: ReplyLanguage, name: string): string {
  return language === 'fr'
    ? `Je peux seulement répondre aux questions sur ${name}.`
    : `I can only help with questions about ${name}.`;
}

export function cappedReply(language: ReplyLanguage): string {
  return language === 'fr'
    ? 'Cette démo a atteint la limite de messages du jour. Revenez demain.'
    : 'This demo has reached today’s message limit. Come back tomorrow.';
}

/** Demo-only note under a needs_owner reply: why it went to the owner, and what the live site would do. */
export function demoNote(reason: HandoffReason, language: ReplyLanguage, name: string): string {
  if (language === 'fr') {
    switch (reason) {
      case 'owner_topic':
        return `Démo : les questions de prix, de disponibilités, de réservations et de plaintes vont toujours au propriétaire. Sur le vrai site de ${name}, la question irait à l’équipe.`;
      case 'not_in_context':
        return `Démo : les pages publiques de ${name} ne répondent pas à cette question, alors l’assistant ne devine pas. Sur le vrai site, la question irait à l’équipe.`;
      case 'other_language':
        return `Démo : l’assistant répond en français et en anglais. Les autres langues vont à l’équipe de ${name}.`;
      case 'check_failed':
        return `Démo : l’assistant n’a pas pu vérifier sa réponse dans les pages de ${name}, alors il ne l’affiche pas. Sur le vrai site, la question irait à l’équipe.`;
    }
  }
  switch (reason) {
    case 'owner_topic':
      return `Demo: questions about prices, availability, bookings and complaints always go to the owner. On ${name}'s live site, the question would go to the team.`;
    case 'not_in_context':
      return `Demo: ${name}'s public pages don't answer this, so the assistant doesn't guess. On the live site, the question would go to the team.`;
    case 'other_language':
      return `Demo: the assistant answers in English and French. Other languages go to ${name}'s team.`;
    case 'check_failed':
      return `Demo: the assistant couldn't check its answer against ${name}'s pages, so it doesn't show it. On the live site, the question would go to the team.`;
  }
}
