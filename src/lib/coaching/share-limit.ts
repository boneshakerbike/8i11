/**
 * Bill pastes coach replies and session summaries into the Oura app's AI chat,
 * which takes 995 characters. Everything the coach says stays under that.
 */

export const SHARE_LIMIT = 995;

/**
 * Cut text to fit `max` characters: at the last full sentence that fits when
 * that keeps at least half, else at a word boundary with "...".
 */
export function fit_to_limit(text: string, max = SHARE_LIMIT): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const last_end = [...head.matchAll(/[.!?](?=\s|$)/g)].pop()?.index;
  if (last_end != null && last_end + 1 >= max / 2) return head.slice(0, last_end + 1);
  const cut = head.slice(0, max - 3);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}...`;
}

/**
 * Keep a reply within the limit: ask for a shorter rewrite once (keeping the
 * meaning), then cut as a last resort so the limit always holds.
 */
export async function within_share_limit(text: string, shorten: (text: string) => Promise<string>): Promise<string> {
  if (text.trim().length <= SHARE_LIMIT) return text.trim();
  let shorter = text;
  try {
    const rewritten = await shorten(text);
    if (rewritten.trim() && rewritten.length < text.length) shorter = rewritten;
  } catch {
    // Keep the original; the cut below still applies
  }
  return fit_to_limit(shorter);
}
