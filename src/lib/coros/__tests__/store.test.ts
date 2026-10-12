import { beforeEach, describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { create_coros_store, type CorosStore } from '@/lib/coros/store';
import { CorosOAuthProvider } from '@/lib/coros/oauth-provider';

const PROD = 'https://8i11.vercel.app';
const PREVIEW = 'https://8i11-git-branch-team.vercel.app';

describe('CorosOAuthProvider with CorosStore', () => {
  let store: CorosStore;

  beforeEach(() => {
    store = create_coros_store(createClient({ url: ':memory:' }));
  });

  it('round-trips client info, tokens, verifier and discovery per origin', async () => {
    const p = new CorosOAuthProvider(PROD, store);
    await p.saveClientInformation({ client_id: 'abc' });
    await p.saveTokens({ access_token: 'at', token_type: 'Bearer', refresh_token: 'rt' });
    await p.saveCodeVerifier('verifier');

    expect(await p.clientInformation()).toEqual({ client_id: 'abc' });
    expect((await p.tokens())?.access_token).toBe('at');
    expect(await p.codeVerifier()).toBe('verifier');
  });

  it('keeps production and preview connections apart', async () => {
    await new CorosOAuthProvider(PROD, store).saveTokens({ access_token: 'prod', token_type: 'Bearer' });
    const preview = new CorosOAuthProvider(PREVIEW, store);
    expect(await preview.tokens()).toBeUndefined();
    expect(preview.redirectUrl).toBe(`${PREVIEW}/api/coros/callback`);
  });

  it('invalidates only the requested credentials', async () => {
    const p = new CorosOAuthProvider(PROD, store);
    await p.saveClientInformation({ client_id: 'abc' });
    await p.saveTokens({ access_token: 'at', token_type: 'Bearer' });
    await p.invalidateCredentials('tokens');
    expect(await p.tokens()).toBeUndefined();
    expect(await p.clientInformation()).toEqual({ client_id: 'abc' });

    await p.invalidateCredentials('all');
    expect(await p.clientInformation()).toBeUndefined();
  });

  it('registers the callback on its own origin as a public client', () => {
    const meta = new CorosOAuthProvider(PROD, store).clientMetadata;
    expect(meta.redirect_uris).toEqual([`${PROD}/api/coros/callback`]);
    expect(meta.token_endpoint_auth_method).toBe('none');
  });

  it('uses the CSRF state it was given', () => {
    expect(new CorosOAuthProvider(PROD, store, 'abc123').state()).toBe('abc123');
  });

  it('throws a clear error when no verifier was saved', async () => {
    await expect(new CorosOAuthProvider(PROD, store).codeVerifier()).rejects.toThrow(/Start the COROS connection again/);
  });

  it('remove deletes the origin row', async () => {
    await new CorosOAuthProvider(PROD, store).saveTokens({ access_token: 'at', token_type: 'Bearer' });
    expect(await store.remove(PROD)).toBe(true);
    expect((await store.get(PROD)).tokens).toBeNull();
  });
});
