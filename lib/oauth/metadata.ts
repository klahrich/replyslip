import { absoluteIssuerUrl, dcrEnabled, oauthIssuer, oauthResource, OAUTH_SCOPES } from './config';

/** RFC 9728 protected resource metadata (§2.1). Served at the path-suffixed URL and at the root fallback. */
export function protectedResourceMetadata() {
  return {
    resource: oauthResource(),
    authorization_servers: [oauthIssuer()],
    scopes_supported: OAUTH_SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: 'Valetto',
    resource_documentation: absoluteIssuerUrl('/docs/api.md'),
  };
}

/**
 * RFC 8414 authorization server metadata (§2.3). DCR is not built yet (rollout PR 3), so registration_endpoint and
 * the client_secret_* methods are listed only once MCP_OAUTH_DCR=1 and the register route exist.
 */
export function authorizationServerMetadata() {
  const dcr = dcrEnabled();
  const authMethods = dcr ? ['none', 'client_secret_post', 'client_secret_basic'] : ['none'];
  return {
    issuer: oauthIssuer(),
    authorization_endpoint: absoluteIssuerUrl('/api/oauth/authorize'),
    token_endpoint: absoluteIssuerUrl('/api/oauth/token'),
    ...(dcr ? { registration_endpoint: absoluteIssuerUrl('/api/oauth/register') } : {}),
    revocation_endpoint: absoluteIssuerUrl('/api/oauth/revoke'),
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: authMethods,
    revocation_endpoint_auth_methods_supported: authMethods,
    scopes_supported: OAUTH_SCOPES,
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: absoluteIssuerUrl('/docs/api.md'),
  };
}

/** The resource_metadata URL in the 401 challenge from /api/mcp (§2.2). */
export const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource/api/mcp';
