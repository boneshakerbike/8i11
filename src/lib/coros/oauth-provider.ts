/**
 * OAuthClientProvider for the COROS MCP server, backed by CorosStore.
 *
 * The MCP SDK's auth() drives the flow: discovery, dynamic client registration,
 * PKCE, code exchange and refresh. This class only stores what it hands over.
 * Serverless: nothing is kept in memory between requests.
 */

import type { OAuthClientProvider, OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { CorosStore } from '@/lib/coros/store';

export const COROS_CALLBACK_PATH = '/api/coros/callback';

export class CorosOAuthProvider implements OAuthClientProvider {
  /** Set when auth() wants the user sent to COROS to sign in. */
  authorization_url: URL | null = null;

  constructor(
    private readonly origin: string,
    private readonly store: CorosStore,
    /** CSRF state for an interactive sign-in; also kept in a cookie and checked on callback. */
    private readonly oauth_state?: string,
  ) {}

  get redirectUrl(): string {
    return `${this.origin}${COROS_CALLBACK_PATH}`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: '8i11',
      client_uri: this.origin,
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      // Public client with PKCE, the way MCP chat clients register
      token_endpoint_auth_method: 'none',
    };
  }

  state(): string {
    // A background call (sync, refresh) never redirects, so any value works there
    return this.oauth_state ?? crypto.randomUUID();
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return (await this.store.get(this.origin)).client_info ?? undefined;
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    await this.store.set(this.origin, 'client_info', info);
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.store.get(this.origin)).tokens ?? undefined;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.store.set(this.origin, 'tokens', tokens);
  }

  redirectToAuthorization(url: URL): void {
    this.authorization_url = url;
  }

  async saveCodeVerifier(verifier: string): Promise<void> {
    await this.store.set(this.origin, 'code_verifier', verifier);
  }

  async codeVerifier(): Promise<string> {
    const verifier = (await this.store.get(this.origin)).code_verifier;
    if (!verifier) throw new Error('No PKCE code verifier saved. Start the COROS connection again.');
    return verifier;
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return (await this.store.get(this.origin)).discovery ?? undefined;
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    await this.store.set(this.origin, 'discovery', state);
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    if (scope === 'all') return void (await this.store.clear(this.origin, ['client_info', 'tokens', 'code_verifier', 'discovery']));
    const field = { client: 'client_info', tokens: 'tokens', verifier: 'code_verifier', discovery: 'discovery' } as const;
    await this.store.clear(this.origin, [field[scope]]);
  }
}
