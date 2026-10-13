import { describe, expect, it } from 'vitest';
import { reply_text } from '@/lib/coaching/reply';

describe('reply_text', () => {
  it('skips the thinking blocks Opus 5.5 puts first', () => {
    expect(reply_text([{ type: 'thinking', text: '' }, { type: 'text', text: 'Ride easy today.' }])).toBe('Ride easy today.');
  });

  it('joins several text blocks and ignores other block types', () => {
    expect(reply_text([{ type: 'text', text: 'One.' }, { type: 'fallback' }, { type: 'text', text: 'Two.' }])).toBe('One.\n\nTwo.');
  });

  it('is empty when there is no text', () => {
    expect(reply_text([{ type: 'thinking' }])).toBe('');
  });
});
