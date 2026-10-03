import { describe, it, expect } from 'vitest';
import { Issuer, custom } from 'openid-client';
import { auth_options } from '../auth';

/**
 * GitHub returns an `iss` parameter on the OAuth callback (RFC 9207).
 * openid-client validates it against the issuer, so the GitHub provider must
 * name one. Without it the callback throws
 * "issuer must be configured on the issuer" and every sign-in fails with
 * ?error=OAuthCallback.
 */

const GITHUB_ISSUER = 'https://github.com/login/oauth';

function callback_client(issuer_value: string | undefined) {
  const issuer = new Issuer({
    issuer: issuer_value as string,
    authorization_endpoint: 'https://github.com/login/oauth/authorize',
    token_endpoint: 'https://github.com/login/oauth/access_token',
    userinfo_endpoint: 'https://api.github.com/user',
  });
  const client = new issuer.Client({
    client_id: 'id',
    client_secret: 'secret',
    redirect_uris: ['https://8i11.vercel.app/api/auth/callback/github'],
  });
  // Abort the token exchange immediately; only the pre-exchange checks matter.
  (client as unknown as Record<symbol, unknown>)[custom.http_options] = () => ({ timeout: 1 });
  return client;
}

async function run_callback(issuer_value: string | undefined) {
  const client = callback_client(issuer_value);
  try {
    await client.oauthCallback(
      'https://8i11.vercel.app/api/auth/callback/github',
      { code: 'abc', state: 'xyz', iss: GITHUB_ISSUER },
      { state: 'xyz' },
    );
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

describe('GitHub provider issuer', () => {
  it('is configured on the GitHub provider', () => {
    const github = auth_options.providers.find(p => p.id === 'github');
    // next-auth merges a provider's user options onto the provider at runtime.
    const options = (github as { options?: { issuer?: string } }).options;
    expect(options?.issuer).toBe(GITHUB_ISSUER);
  });

  it('reproduces the production failure when the issuer is missing', async () => {
    expect(await run_callback(undefined)).toBe('issuer must be configured on the issuer');
  });

  it('clears that check once the issuer is set', async () => {
    const message = await run_callback(GITHUB_ISSUER);
    // Gets past the iss validation and on to the token exchange.
    expect(message).not.toContain('issuer must be configured');
    expect(message).toContain('timed out');
  });
});
