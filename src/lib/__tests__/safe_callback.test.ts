import { describe, it, expect } from 'vitest';
import { safe_callback_url } from '../safe_callback';

const ORIGIN = 'https://8i11.vercel.app';

describe('safe_callback_url', () => {
  it('falls back to / when there is no callbackUrl', () => {
    expect(safe_callback_url(null, ORIGIN)).toBe(`${ORIGIN}/`);
    expect(safe_callback_url('', ORIGIN)).toBe(`${ORIGIN}/`);
  });

  it('keeps same-origin absolute and relative targets', () => {
    expect(safe_callback_url(`${ORIGIN}/f1?x=1`, ORIGIN)).toBe(`${ORIGIN}/f1?x=1`);
    expect(safe_callback_url('/coach', ORIGIN)).toBe(`${ORIGIN}/coach`);
  });

  it('rejects other origins', () => {
    expect(safe_callback_url('https://evil.com/', ORIGIN)).toBe(`${ORIGIN}/`);
    expect(safe_callback_url('//evil.com', ORIGIN)).toBe(`${ORIGIN}/`);
    expect(safe_callback_url('/\\evil.com', ORIGIN)).toBe(`${ORIGIN}/`);
    expect(safe_callback_url('javascript:alert(1)', ORIGIN)).toBe(`${ORIGIN}/`);
  });

  it('drops targets on /login so the redirect cannot loop', () => {
    expect(safe_callback_url(`${ORIGIN}/login?callbackUrl=%2F`, ORIGIN)).toBe(`${ORIGIN}/`);
    expect(safe_callback_url('/login', ORIGIN)).toBe(`${ORIGIN}/`);
  });
});
