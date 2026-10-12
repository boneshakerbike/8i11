import { describe, expect, it } from 'vitest';
import { is_interval_session } from '@/lib/coros/classify';

describe('is_interval_session', () => {
  it('does not count an easy base ride (Oct 10: focus Base, anaerobic 1.6)', () => {
    expect(is_interval_session({ anaerobic_te: 1.6, training_focus: 'Base' })).toBe(false);
  });

  it('counts a high-intensity training focus', () => {
    expect(is_interval_session({ anaerobic_te: 2.1, training_focus: 'VO2 Max' })).toBe(true);
    expect(is_interval_session({ anaerobic_te: null, training_focus: 'Threshold' })).toBe(true);
    expect(is_interval_session({ anaerobic_te: null, training_focus: 'Anaerobic Endurance' })).toBe(true);
  });

  it('counts a high anaerobic training effect whatever the label', () => {
    expect(is_interval_session({ anaerobic_te: 3.0, training_focus: 'Base' })).toBe(true);
  });

  it('does not count a ride with no intensity data (custom sports)', () => {
    expect(is_interval_session({ anaerobic_te: null, training_focus: null })).toBe(false);
  });
});
