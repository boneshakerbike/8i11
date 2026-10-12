import { describe, expect, it } from 'vitest';
import { is_interval_session, strength_kind } from '@/lib/coros/classify';

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

describe('strength_kind', () => {
  it('calls a stretching or bodyweight session mobility (Oct 8: 17 sets, none loaded)', () => {
    expect(strength_kind({ working_sets: 17, loaded_sets: 0 })).toBe('mobility');
  });

  it('calls 6 or more loaded sets heavy', () => {
    expect(strength_kind({ working_sets: 8, loaded_sets: 6 })).toBe('heavy');
    expect(strength_kind({ working_sets: 8, loaded_sets: 5 })).toBe('mobility');
  });

  it('does not guess before the exercises are read, or when COROS recorded none', () => {
    expect(strength_kind({ working_sets: null, loaded_sets: null })).toBeNull();
    expect(strength_kind({ working_sets: 0, loaded_sets: 0 })).toBeNull();
  });
});
