/**
 * Build a prefilled GitHub "new issue" URL from a block of text.
 *
 * No API token involved — the button just opens GitHub's own new-issue form with
 * the title and body filled in, and the author submits it there.
 */

export const ISSUES_REPO = 'boneshakerbike/8i11';

/** Longest title GitHub accepts is 256; keep it shorter so it reads as a summary. */
const MAX_TITLE = 70;

/**
 * Browsers and GitHub both cap URL length (GitHub answers 414 well before the
 * browser gives up). Stay comfortably under it and truncate the body instead of
 * sending a request that fails.
 */
const MAX_URL = 6000;

const TRUNCATION_NOTE = '\n\n...(truncated, full text was copied to your clipboard)';

/** First sentence or line, whichever ends sooner, trimmed to a title-ish length. */
export function derive_issue_title(text: string): string {
  const first_line = text.trim().split('\n').find(l => l.trim()) ?? '';
  const sentence_end = first_line.search(/[.!?](\s|$)/);
  const candidate = (sentence_end === -1 ? first_line : first_line.slice(0, sentence_end)).trim();

  if (!candidate) return 'Note from Say What?';
  if (candidate.length <= MAX_TITLE) return candidate;

  // Cut at the last word boundary that fits rather than mid-word.
  const clipped = candidate.slice(0, MAX_TITLE);
  const last_space = clipped.lastIndexOf(' ');
  return `${(last_space > 20 ? clipped.slice(0, last_space) : clipped).trimEnd()}...`;
}

export interface IssueUrl {
  url: string;
  /** True when the body had to be shortened to fit the URL. */
  truncated: boolean;
}

export function build_issue_url(text: string, repo: string = ISSUES_REPO): IssueUrl {
  const body = text.trim();
  const title = derive_issue_title(body);
  const base = `https://github.com/${repo}/issues/new?title=${encodeURIComponent(title)}&body=`;

  const encoded = encodeURIComponent(body);
  if (base.length + encoded.length <= MAX_URL) {
    return { url: base + encoded, truncated: false };
  }

  // encodeURIComponent can expand a character up to 9 bytes, so shrink the slice
  // until the encoded form fits rather than guessing a character count.
  const budget = MAX_URL - base.length - encodeURIComponent(TRUNCATION_NOTE).length;
  let keep = Math.min(body.length, budget);
  while (keep > 0 && encodeURIComponent(body.slice(0, keep)).length > budget) {
    keep = Math.floor(keep * 0.9);
  }

  return {
    url: base + encodeURIComponent(body.slice(0, keep).trimEnd() + TRUNCATION_NOTE),
    truncated: true,
  };
}
