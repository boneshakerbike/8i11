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
  // Opus 5.5 always thinks (no "disabled"); the coach route sets low effort
  // and reads the reply by block type (src/lib/coaching/reply.ts).
  COACHING_DAILY:   'claude-opus-5-5',
  COACHING_REFINE:  'claude-haiku-4-5-20251001',
  DRIVE_KNOWLEDGE:  'claude-sonnet-5',
  // Web search fact check; same always-thinking rules as COACHING_DAILY.
  FACT_CHECK:       'claude-opus-5-5',
}
