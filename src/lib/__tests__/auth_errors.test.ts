import { describe, it, expect } from 'vitest';
import { sign_in_error_message } from '../auth_errors';

describe('sign_in_error_message', () => {
  it('explains OAuthCallback as a failure after GitHub authorised', () => {
    const message = sign_in_error_message('OAuthCallback');
    expect(message.text).toContain('GitHub sent you back');
    expect(message.retryable).toBe(true);
  });

  it('does not offer a retry for an account that is not allow-listed', () => {
    const message = sign_in_error_message('AccessDenied');
    expect(message.text).toContain('allow list');
    expect(message.retryable).toBe(false);
  });

  it('does not offer a retry for a server misconfiguration', () => {
    expect(sign_in_error_message('Configuration').retryable).toBe(false);
  });

  it('falls back for unknown, empty, and missing codes', () => {
    expect(sign_in_error_message('SomethingNew').text).toBe('Sign-in failed.');
    expect(sign_in_error_message('').text).toBe('Sign-in failed.');
    expect(sign_in_error_message(null).text).toBe('Sign-in failed.');
    expect(sign_in_error_message(undefined).text).toBe('Sign-in failed.');
  });

  it('gives every known code a distinct message', () => {
    const codes = ['OAuthCallback', 'OAuthSignin', 'AccessDenied', 'Configuration', 'Callback'];
    const texts = codes.map(c => sign_in_error_message(c).text);
    expect(new Set(texts).size).toBe(codes.length);
  });
});
