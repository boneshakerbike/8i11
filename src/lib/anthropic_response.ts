/**
 * Helpers for reading Anthropic Messages API responses.
 */

import type Anthropic from '@anthropic-ai/sdk';

/**
 * The text of the first text block, trimmed, or '' when there is none.
 *
 * Reading `content[0]` directly is wrong: when thinking is enabled a thinking
 * block occupies the first slot, and on Sonnet 5 `thinking.display` defaults to
 * "omitted", so that block is present with empty text rather than absent. This
 * is a no-op while routes send `thinking: { type: 'disabled' }`, and keeps them
 * correct if that ever changes.
 */
export function first_text(message: Anthropic.Message): string {
  const block = message.content.find(b => b.type === 'text');
  return block && block.type === 'text' ? block.text.trim() : '';
}
