/**
 * Reading the coach model's response. Opus 5.5 always thinks, so a response
 * can start with thinking blocks (empty text by default): read the reply by
 * block type, never by position.
 */

export interface ReplyBlock {
  type: string;
  text?: string;
}

/** The reply text, from text blocks only. Empty when there is none. */
export function reply_text(content: ReplyBlock[]): string {
  return content
    .filter(b => b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text as string)
    .join('\n\n')
    .trim();
}

/** Shown when every model declined (after the server-side fallback). */
export const DECLINED_REPLY = 'The coach could not answer this one. Try rewording it, or start a new session.';
