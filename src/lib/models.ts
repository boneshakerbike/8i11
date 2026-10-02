// Last reviewed: July 2026
// Sonnet 5 uses the bare documented alias 'claude-sonnet-5' — dated snapshots
// (e.g. claude-sonnet-4-6-20260217) 404 from the API, so never append a date.
// Sonnet 5 runs adaptive thinking by default when `thinking` is omitted;
// routes pass `thinking: { type: 'disabled' }` for parity with the old
// Sonnet 4.6 thinking-off behavior.
export const MODELS = {
  STORY_GENERATION: 'claude-sonnet-5',
  KNOWLEDGE_DIFF:   'claude-sonnet-5',
  INTRO:            'claude-sonnet-5',
  PROMPT_REVIEW:    'claude-sonnet-5',
  CLEAN_TEXT:       'claude-sonnet-5',
  STRIP:            'claude-haiku-4-5-20251001',
  SUBSTACK:         'claude-sonnet-5',
  COACHING_DAILY:   'claude-sonnet-5',
  COACHING_REFINE:  'claude-haiku-4-5-20251001',
  DRIVE_KNOWLEDGE:  'claude-sonnet-5',
}
