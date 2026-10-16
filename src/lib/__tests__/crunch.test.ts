import { describe, it, expect } from 'vitest';
import { count_words, crunch_target_words } from '../crunch';

describe('count_words', () => {
  it('counts words separated by spaces', () => {
    expect(count_words('the quick brown fox')).toBe(4);
  });

  it('treats newlines, tabs, and repeated spaces as one break', () => {
    expect(count_words('one  two\n\nthree\tfour')).toBe(4);
  });

  it('ignores leading and trailing whitespace', () => {
    expect(count_words('  \n hello world \n ')).toBe(2);
  });

  it('returns 0 for empty or blank text', () => {
    expect(count_words('')).toBe(0);
    expect(count_words('   \n\t ')).toBe(0);
  });
});

describe('crunch_target_words', () => {
  it('asks for half the words', () => {
    expect(crunch_target_words(400)).toBe(200);
  });

  it('rounds an odd count up', () => {
    expect(crunch_target_words(7)).toBe(4);
  });

  it('never asks for fewer than one word', () => {
    expect(crunch_target_words(1)).toBe(1);
    expect(crunch_target_words(0)).toBe(1);
  });
});
