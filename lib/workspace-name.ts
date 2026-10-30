/** The name a workspace gets at first sign-in, from the email's local part. */
export function workspaceNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  const cleaned = local.replace(/[^A-Za-z0-9]+/g, ' ').trim().slice(0, 40);
  return cleaned ? `${cleaned} workspace` : 'Workspace';
}

/**
 * The owner-chosen workspace name, or null when it is still the one made from a member's email.
 * Customers must never see that default: it is a piece of the owner's email address.
 */
export function chosenWorkspaceName(name: string, memberEmails: string[]): string | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed === 'Workspace') return null;
  if (memberEmails.some((email) => workspaceNameFromEmail(email) === trimmed)) return null;
  return trimmed;
}
