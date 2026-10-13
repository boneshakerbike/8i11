import { describe, expect, it } from 'vitest';
import { oura_sync_range } from '@/lib/health/oura-sync';

describe('oura_sync_range', () => {
  it('ends yesterday by default: today\'s activity is still accumulating', () => {
    expect(oura_sync_range('2026-10-13', 7, false)).toEqual({ start: '2026-10-06', end: '2026-10-12' });
  });

  it('includes today for the midday job, so last night\'s sleep (filed under today) counts', () => {
    expect(oura_sync_range('2026-10-13', 7, true)).toEqual({ start: '2026-10-07', end: '2026-10-13' });
  });

  it('crosses month ends', () => {
    expect(oura_sync_range('2026-11-02', 7, true)).toEqual({ start: '2026-10-27', end: '2026-11-02' });
  });
});
