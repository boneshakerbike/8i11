import { describe, expect, it } from 'vitest';
import { is_cron_authorized, is_cron_path } from '@/lib/cron_auth';

describe('is_cron_authorized', () => {
  it('accepts the exact bearer secret', () => {
    expect(is_cron_authorized('Bearer s3cret', 's3cret')).toBe(true);
  });

  it('rejects a missing or wrong header', () => {
    expect(is_cron_authorized(null, 's3cret')).toBe(false);
    expect(is_cron_authorized('Bearer nope', 's3cret')).toBe(false);
    expect(is_cron_authorized('s3cret', 's3cret')).toBe(false);
  });

  it('fails closed when the secret is unset', () => {
    expect(is_cron_authorized('Bearer undefined', undefined)).toBe(false);
    expect(is_cron_authorized('Bearer ', '')).toBe(false);
  });
});

describe('is_cron_path', () => {
  it('matches the trends cron exactly', () => {
    expect(is_cron_path('/api/coaching/trends')).toBe(true);
  });

  it('does not open sibling routes', () => {
    expect(is_cron_path('/api/coaching/trends/today')).toBe(false);
    expect(is_cron_path('/api/coaching/chat')).toBe(false);
  });
});
