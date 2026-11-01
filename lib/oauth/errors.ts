/** RFC 6749 §5.2 / RFC 8707 error codes the token, authorize and revoke endpoints return. */
export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'unsupported_response_type'
  | 'invalid_scope'
  | 'invalid_target'
  | 'access_denied'
  | 'server_error';

/**
 * An OAuth protocol error. `description` is fixed server copy: it never echoes request input (§5.5) and never carries
 * a token or code (§5.6).
 */
export class OAuthError extends Error {
  constructor(
    public code: OAuthErrorCode,
    public description: string,
    public status: number = code === 'invalid_client' ? 401 : 400,
  ) {
    super(description);
    this.name = 'OAuthError';
  }

  toJSON(): { error: OAuthErrorCode; error_description: string } {
    return { error: this.code, error_description: this.description };
  }
}
