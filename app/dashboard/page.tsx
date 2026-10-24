import { redirect } from 'next/navigation';
import { Dashboard } from '@/components/dashboard/Dashboard';
import { currentUser } from '@/components/dashboard/session';
import { SITE_URL } from '@/components/site/seo';
import { agentDocs } from '@/lib/agent-docs';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const origin = SITE_URL;

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
  return (
    <Dashboard
      workspace={{
        id: user.workspace.id,
        name: user.workspace.name,
        created_at: user.workspace.createdAt.toISOString(),
      }}
      email={user.email}
      marketingOptIn={user.marketingOptIn}
      origin={origin}
      paths={{ llms, skill, gettingStarted, api, mcp }}
    />
  );
}
