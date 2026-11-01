import { redirect } from 'next/navigation';
import { Dashboard } from '@/components/dashboard/Dashboard';
import { currentUser } from '@/components/dashboard/session';
import { VALETTO_URL } from '@/components/site/valetto/seo';
import { agentDocs } from '@/lib/agent-docs';
import { FREE_GUEST_WORKSPACES, workspacePlanUsage } from '@/lib/plans';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  // Join-code prompts and doc links point at valetto.tech, the production origin.
  const origin = VALETTO_URL;

  if (!user.workspace) {
    // verify-code creates the workspace on first sign-in, so this should not happen.
    return (
      <section className="dash-card">
        <h1>No workspace yet</h1>
        <p>
          Your account doesn’t have a workspace. Sign out and sign in again with a new code to create one.
        </p>
      </section>
    );
  }

  const { llms, skill, gettingStarted, api, mcp } = agentDocs.paths;
  // The API enforces this cap on free workspaces (lib/plans) but does not return it, so read it here.
  const { plan } = await workspacePlanUsage(user.workspace.id);
  return (
    <Dashboard
      workspace={{
        id: user.workspace.id,
        name: user.workspace.name,
        handle: user.workspace.handle,
        created_at: user.workspace.createdAt.toISOString(),
      }}
      email={user.email}
      marketingOptIn={user.marketingOptIn}
      origin={origin}
      paths={{ llms, skill, gettingStarted, api, mcp }}
      guestLimit={plan === 'unlimited' ? null : FREE_GUEST_WORKSPACES}
    />
  );
}
