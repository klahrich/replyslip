import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GET as valettoSitemap } from '@/app/valetto-seo/sitemap/route';
import { VALETTO_PATHS } from '@/components/site/valetto/seo';

const ROOT = join(__dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const guide = read('app/(site)/share/page.tsx');
const invites = read('components/dashboard/InviteLinks.tsx');
const sharing = read('components/dashboard/Sharing.tsx');
const toggle = read('components/dashboard/SharingToggle.tsx');
const preview = read('app/(site)/i/InvitePreview.tsx');
const agentPage = read('app/(site)/valetto/agent-to-agent/page.tsx');
const connectPage = read('app/(site)/connect/page.tsx');
const home = read('app/(site)/valetto/page.tsx');

/** Visible dashboard and invite-page labels the public guide quotes. */
const LABELS = [
  'Agent invite links',
  'Tasks they can send',
  'Who it’s for (optional)',
  'Expires after (days)',
  'Tasks per day, per guest',
  'How many agents can use it',
  'One customer',
  'They can use these tasks as soon as they connect',
  'Create invite link',
  'Copy message',
  'Copy prompt',
  'Copy link',
  'Send this to your customer',
  'Yes, revoke',
  'Revoke guests…',
];

describe('public share guide', () => {
  it('is a Valetto page with two navigable sections and no sample credential', () => {
    expect(VALETTO_PATHS).toContain('/share');
    expect(guide).toContain('Share your agent');
    expect(guide).toContain('Got a link?');
    expect(guide).toContain('id="share-your-agent"');
    expect(guide).toContain('id="got-a-link"');
    expect(guide).toContain('Connect via MCP with an authorization header, or through the API.');
    expect(guide).not.toMatch(/rsi_|rsk_|Bearer [A-Za-z0-9]{8,}/);
    expect(guide).not.toMatch(/VALETTO_AGENT_GUESTS|security-reviewed|IMPLEMENTED|Production activation|c771185|\bgated\b/i);
  });

  it('quotes the current owner and recipient labels', () => {
    for (const label of LABELS) {
      expect(invites, label).toContain(label);
      expect(guide, label).toContain(label);
    }
    expect(sharing).toContain('Your handle');
    expect(sharing).toContain('Shared agents');
    expect(guide).toContain('Your handle');
    expect(guide).toContain('Shared agents');
    expect(toggle).toContain('Share this agent');
    expect(guide).toContain('Share this agent');
    // The confirmation builds the noun: "guest who" or "N guests who".
    expect(invites).toContain('Also revoke the');
    expect(invites).toContain("'guest who'");
    expect(invites).toContain('joined with it');
    expect(guide).toContain('Also revoke the guest who joined with it');
    for (const label of [
      'What your agent can ask',
      'What you send',
      'What it returns',
      'Give this to your agent',
      'Copy instructions',
      'Or paste an MCP config',
      'Copy config',
    ]) {
      expect(preview, label).toContain(label);
      expect(guide, label).toContain(label);
    }
  });

  it('points the other public guides here and keeps their own requirements', () => {
    expect(agentPage).toContain('href="/share"');
    expect(agentPage).not.toContain('as shown on the');
    expect(agentPage).toContain('Invite a workspace by handle');
    expect(agentPage).toContain('Sign in to Valetto');
    expect(agentPage).toContain('needs its own Valetto workspace');
    expect(connectPage).toContain('href="/share#got-a-link"');
    expect(connectPage).toContain('Sign in to Valetto');
    expect(connectPage).toContain('Connect via MCP with an authorization header, or through the API.');
    expect(read('components/site/valetto/ValettoChrome.tsx')).toContain('href={SHARE}');
  });

  it('leaves the shop homepage story alone', () => {
    expect(home).toContain('text="Answer every customer."');
    expect(home).not.toContain('/share');
    expect(home).not.toMatch(/Share your agent|Got a link\?/);
  });

  it('lists /share on the valetto sitemap', async () => {
    const xml = await valettoSitemap().text();
    expect(xml).toContain('https://valetto.tech/share</loc>');
  });

  it('tells an owner what to do when Agent invite links is not on the page', () => {
    expect(guide).toContain('If you don’t see Agent invite links');
    expect(guide).toContain('Invite a workspace by handle');
    expect(guide).toContain('Customer links');
    expect(guide).toContain('Signing them up does not stand in for it');
    expect(sharing).toContain('if you don’t see Agent invite links');
    expect(guide).not.toMatch(/VALETTO_AGENT_GUESTS|agent_guests_enabled|process\.env|\bflag\b/i);
  });

  it('does not treat a link revoke or Stop sharing as removing every guest', () => {
    expect(guide).not.toContain('revoke it when you want it to stop');
    expect(guide).not.toContain('stops every guest');
    expect(guide).toContain('keys already handed out keep working until you revoke those guests');
    expect(guide).toContain('The guests stay listed');
    expect(guide).toContain('those same guests can send new tasks');
    expect(toggle).toContain('Guests stay listed so you can revoke them');
  });
});
