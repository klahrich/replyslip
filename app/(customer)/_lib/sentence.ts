/** Ends a sentence after a name without doubling a trailing period ("613 Fencing Inc." stays as is). */
export function endSentence(text: string): string {
  const trimmed = text.trimEnd();
  return trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
}
