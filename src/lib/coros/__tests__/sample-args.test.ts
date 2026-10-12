import { describe, expect, it } from 'vitest';
import { build_sample_args, shift_date } from '@/lib/coros/sample-args';

const TODAY = '2026-10-12';

describe('shift_date', () => {
  it('goes back across a month boundary', () => {
    expect(shift_date('2026-10-03', 6)).toBe('2026-09-27');
  });
});

describe('build_sample_args', () => {
  it('fills a start/end range covering the last 7 days', () => {
    const args = build_sample_args({ properties: { startDate: { type: 'string' }, endDate: { type: 'string' } } }, TODAY);
    expect(args).toEqual({ startDate: '2026-10-06', endDate: '2026-10-12' });
  });

  it('uses YYYYMMDD integers when the schema says integer', () => {
    const args = build_sample_args({ properties: { startDay: { type: 'integer' }, endDay: { type: 'integer' } } }, TODAY);
    expect(args).toEqual({ startDay: 20261006, endDay: 20261012 });
  });

  it('uses compact strings when the description says yyyyMMdd', () => {
    const args = build_sample_args({ properties: { date: { type: 'string', description: 'Date in yyyyMMdd format' } } }, TODAY);
    expect(args).toEqual({ date: '20261012' });
  });

  it('uses seconds for a timestamp field', () => {
    const args = build_sample_args({ properties: { fromDate: { type: 'number', description: 'Unix timestamp' } } }, TODAY);
    expect(args).toEqual({ fromDate: Date.parse('2026-10-06T00:00:00Z') / 1000 });
  });

  it('fills required non-date fields it understands and skips optional ones', () => {
    const args = build_sample_args({
      properties: { sportType: { enum: ['cycling', 'running'] }, pageSize: { type: 'integer' }, keyword: { type: 'string' }, distance: { type: 'number' } },
      required: ['sportType', 'pageSize'],
    }, TODAY);
    expect(args).toEqual({ sportType: 'cycling', pageSize: 20 });
  });

  it('does not treat a day count as a date', () => {
    const args = build_sample_args({ properties: { days: { type: 'integer' } }, required: ['days'] }, TODAY);
    expect(args).toEqual({ days: 7 });
  });

  it('returns empty args for a tool with no inputs', () => {
    expect(build_sample_args(undefined, TODAY)).toEqual({});
    expect(build_sample_args({}, TODAY)).toEqual({});
  });
});
