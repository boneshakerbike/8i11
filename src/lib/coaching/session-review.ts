/**
 * The structured review of a saved coaching session: a short summary Bill can
 * paste into the Oura app, what was learned and decided, notes for whoever
 * maintains the app, and proposed edits to his profile that he accepts or
 * rejects one by one. Pure, so it can be tested; the model call lives in the
 * finalize route.
 */

import { fit_to_limit } from '@/lib/coaching/share-limit'
import { normalizeCoachText } from '@/lib/coaching/normalize-text'

export type ProfileEditAction = 'add' | 'change' | 'remove'

export interface ProfileEdit {
  action: ProfileEditAction
  /** The exact line in the profile to change or remove; empty for add. */
  old_text: string
  /** The new line for add or change; empty for remove. */
  new_text: string
  reason: string
}

export interface SessionReview {
  summary: string
  facts_learned: string[]
  decisions: string[]
  developer_notes: string[]
  profile_edits: ProfileEdit[]
}

/** At most this many profile edits per session, so a review is quick to answer. */
export const MAX_PROFILE_EDITS = 5
const MAX_ITEMS = 8
const MAX_ITEM_CHARS = 400

const string_list = { type: 'array', items: { type: 'string' } } as const

/** JSON schema for the model's structured output. */
export const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'facts_learned', 'decisions', 'developer_notes', 'profile_edits'],
  properties: {
    summary: { type: 'string' },
    facts_learned: string_list,
    decisions: string_list,
    developer_notes: string_list,
    profile_edits: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'old_text', 'new_text', 'reason'],
        properties: {
          action: { type: 'string', enum: ['add', 'change', 'remove'] },
          old_text: { type: 'string' },
          new_text: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
} as const

export function review_prompt(conversation: string, profile: string | null): string {
  return `You review one coaching session between Bill and his health coach. Return the JSON described by the schema.

- summary: 2-3 sentences, under 800 characters with spaces: the main advice, any flags raised, and what was prescribed for today. No preamble, no em dashes.
- facts_learned: new facts about Bill stated in this session (an injury, a change in routine, equipment, a preference). Only what he said or clearly confirmed. Empty if none.
- decisions: what was agreed for the coming days. Empty if none.
- developer_notes: problems with the app itself, such as wrong or missing data the coach or Bill pointed out. Empty if none.
- profile_edits: at most ${MAX_PROFILE_EDITS} changes to his profile, only for facts that will still matter next week, not today's plan or numbers. Each is:
  - add: new_text is one new line; old_text is "".
  - change: old_text is one existing line copied exactly from the profile; new_text replaces it.
  - remove: old_text is one existing line copied exactly from the profile that this session showed is no longer true; new_text is "".
  - reason: one short sentence saying what in the session supports it.
  Propose nothing the profile already says. Empty if nothing should change.

<profile>
${profile?.trim() || '(no profile saved yet)'}
</profile>

<session>
${conversation}
</session>`
}

const clean_list = (v: unknown): string[] | null => {
  if (!Array.isArray(v) || !v.every(x => typeof x === 'string')) return null
  return v.map(x => normalizeCoachText(x).trim().slice(0, MAX_ITEM_CHARS)).filter(Boolean).slice(0, MAX_ITEMS)
}

const profile_lines = (profile: string) => profile.split('\n').map(l => l.trim()).filter(Boolean)

/**
 * Check the model's output. A wrong shape returns null, and the caller stores
 * no review. A single edit that doesn't fit the profile (a line that isn't
 * there, a line that is already there) is dropped and the rest kept.
 */
export function validate_review(raw: unknown, profile: string | null): SessionReview | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.summary !== 'string' || !r.summary.trim()) return null
  const facts_learned = clean_list(r.facts_learned)
  const decisions = clean_list(r.decisions)
  const developer_notes = clean_list(r.developer_notes)
  if (!facts_learned || !decisions || !developer_notes || !Array.isArray(r.profile_edits)) return null

  const lines = profile_lines(profile ?? '')
  const seen = new Set<string>()
  const profile_edits: ProfileEdit[] = []
  for (const e of r.profile_edits as unknown[]) {
    if (!e || typeof e !== 'object') return null
    const { action, old_text, new_text, reason } = e as Record<string, unknown>
    if (action !== 'add' && action !== 'change' && action !== 'remove') return null
    if (typeof old_text !== 'string' || typeof new_text !== 'string' || typeof reason !== 'string') return null
    const edit: ProfileEdit = {
      action,
      old_text: action === 'add' ? '' : old_text.trim(),
      new_text: action === 'remove' ? '' : normalizeCoachText(new_text).trim().slice(0, MAX_ITEM_CHARS),
      reason: normalizeCoachText(reason).trim().slice(0, MAX_ITEM_CHARS),
    }
    if (edit.action !== 'add' && !lines.includes(edit.old_text)) continue
    if (edit.action !== 'remove' && (!edit.new_text || lines.includes(edit.new_text))) continue
    const key = `${edit.action}|${edit.old_text}|${edit.new_text}`
    if (seen.has(key)) continue
    seen.add(key)
    profile_edits.push(edit)
    if (profile_edits.length === MAX_PROFILE_EDITS) break
  }

  return {
    // Bill pastes the summary into the Oura app's AI chat, which takes 995 characters
    summary: fit_to_limit(normalizeCoachText(r.summary)),
    facts_learned, decisions, developer_notes, profile_edits,
  }
}

/**
 * Apply one accepted edit to the current profile. Null when the line it
 * changes or removes is no longer there (the profile was edited since).
 */
export function apply_profile_edit(profile: string, edit: ProfileEdit): string | null {
  const text = profile.replace(/\r\n/g, '\n').trimEnd()
  if (edit.action === 'add') return text ? `${text}\n${edit.new_text}` : edit.new_text
  const lines = text.split('\n')
  const i = lines.findIndex(l => l.trim() === edit.old_text)
  if (i < 0) return null
  if (edit.action === 'remove') lines.splice(i, 1)
  else lines[i] = lines[i].replace(edit.old_text, edit.new_text)
  return lines.join('\n')
}

/** The decisions and facts a past session adds to the coach's memory of it. */
export function review_memory_lines(review: Pick<SessionReview, 'decisions' | 'facts_learned'> | null): string {
  if (!review) return ''
  return [
    review.decisions.length ? `Decided: ${review.decisions.join('; ')}` : '',
    review.facts_learned.length ? `Learned: ${review.facts_learned.join('; ')}` : '',
  ].filter(Boolean).join('\n')
}

/** Read back a stored review's decisions and facts; null when absent or unreadable. */
export function parse_stored_review(json: string | null | undefined): Pick<SessionReview, 'decisions' | 'facts_learned'> | null {
  if (!json) return null
  try {
    const r = JSON.parse(json) as Partial<SessionReview>
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    return { decisions: list(r.decisions), facts_learned: list(r.facts_learned) }
  } catch {
    return null
  }
}
