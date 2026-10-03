import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { is_owner_token } from '../owner';

describe('is_owner_token', () => {
  const saved = process.env.ALLOWED_GITHUB_USERS;
  beforeEach(() => { delete process.env.ALLOWED_GITHUB_USERS; });
  afterEach(() => { process.env.ALLOWED_GITHUB_USERS = saved; });

  it('accepts the allowed GitHub login', () => {
    expect(is_owner_token({ provider: 'github', login: 'boneshakerbike' })).toBe(true);
  });

  it('honours ALLOWED_GITHUB_USERS', () => {
    process.env.ALLOWED_GITHUB_USERS = 'someone, other';
    expect(is_owner_token({ provider: 'github', login: 'other' })).toBe(true);
    expect(is_owner_token({ provider: 'github', login: 'boneshakerbike' })).toBe(false);
  });

  it('falls back to the default when ALLOWED_GITHUB_USERS is blank', () => {
    process.env.ALLOWED_GITHUB_USERS = ' , ';
    expect(is_owner_token({ provider: 'github', login: 'boneshakerbike' })).toBe(true);
  });

  it('rejects guest and admin PIN sessions', () => {
    expect(is_owner_token({ provider: 'guest-pin' })).toBe(false);
    expect(is_owner_token({ provider: 'admin-pin' })).toBe(false);
    expect(is_owner_token({ provider: 'guest-pin', login: 'boneshakerbike' })).toBe(false);
  });

  it('rejects sessions from before provider was recorded', () => {
    expect(is_owner_token({ login: 'boneshakerbike' })).toBe(false);
    expect(is_owner_token({})).toBe(false);
    expect(is_owner_token(null)).toBe(false);
  });

  it('rejects a GitHub login that is not allowed', () => {
    expect(is_owner_token({ provider: 'github', login: 'stranger' })).toBe(false);
    expect(is_owner_token({ provider: 'github', login: '' })).toBe(false);
  });
});
