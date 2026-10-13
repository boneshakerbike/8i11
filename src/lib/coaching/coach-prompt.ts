/**
 * The coach's system prompt: its general rules, then Bill's framework,
 * biomarker targets, profile and recent sessions. Pure, so it can be tested.
 * It stays the same for every turn of a session, so the whole thing is one
 * cached block; the per-turn hint goes in a separate block after it.
 */

import type { CoachMemory } from '@/lib/coaching/memory';
import { parse_stored_review, review_memory_lines } from '@/lib/coaching/session-review';
import { COACHING_SYSTEM_PROMPT, DEFAULT_PROFILE, FALLBACK_FRAMEWORK } from '@/lib/coaching/system-prompt';

/** How many past sessions the coach remembers, in full. */
export const SESSION_MEMORY = 7;

export interface PastSession {
  date: number; // epoch day (Mountain Time)
  advice_summary: string | null;
  advice_full: string;
  /** The session's validated review as JSON, when it has one. */
  summary_json?: string | null;
}

const day_label = (epoch_day: number) =>
  new Date(epoch_day * 86400000).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** The saved summary, else the conversation without the data block that starts it. */
function session_text(s: PastSession): string {
  const review = review_memory_lines(parse_stored_review(s.summary_json));
  if (s.advice_summary?.trim()) return review ? `${s.advice_summary.trim()}\n${review}` : s.advice_summary.trim();
  const conversation = s.advice_full.split('[Conversation]').pop() ?? s.advice_full;
  const text = conversation.trim();
  return text.length > 995 ? `${text.slice(0, 992)}...` : text;
}

export function build_coach_system(memory: CoachMemory, sessions: PastSession[]): string {
  const parts = [COACHING_SYSTEM_PROMPT];

  parts.push(`## His Framework\n\n<framework>\n${memory.framework?.body ?? FALLBACK_FRAMEWORK}\n</framework>`);
  if (memory.crosswalk) parts.push(`## His Biomarker Targets\n\n<biomarker_targets>\n${memory.crosswalk.body}\n</biomarker_targets>`);
  parts.push(`## His Profile\n\n<profile>\n${memory.profile?.body ?? DEFAULT_PROFILE}\n</profile>`);

  const recent = sessions.slice(0, SESSION_MEMORY);
  if (recent.length > 0) {
    const lines = recent.map(s => `[${day_label(s.date)}] ${session_text(s)}`);
    parts.push(`## Your Recent Sessions With Him (newest first; for continuity, don't repeat advice already given)\n\n${lines.join('\n\n')}`);
  }

  return parts.join('\n\n');
}
