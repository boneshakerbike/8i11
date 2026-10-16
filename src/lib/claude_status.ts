/**
 * Claude status light for the main page.
 *
 * Reads status.claude.com (an Atlassian Statuspage) and boils it down to one
 * of three levels for /api/claude-status. Green needs positive evidence:
 * anything missing, unreadable, or unrecognized is gray, never green.
 */

export const STATUS_PAGE_URL = 'https://status.claude.com';
const SUMMARY_URL = `${STATUS_PAGE_URL}/api/v2/summary.json`;

export type ClaudeStatusLevel = 'ok' | 'issue' | 'unknown';

export interface ClaudeStatus {
  level: ClaudeStatusLevel;
  /** The full line shown on the page, e.g. "Claude API: Operational". */
  label: string;
  /** Debug only, never rendered: the upstream components the level came from. */
  matched: { id: string; name: string; status: string }[];
  /** Debug only, never rendered: open incidents and the component ids they name. */
  incidents: { id: string; name: string; status: string; component_ids: string[] }[];
}

/** What the page needs; the debug fields stay in the route's JSON. */
export type ClaudeStatusView = Pick<ClaudeStatus, 'level' | 'label'>;

const API_PREFIX = 'Claude API:';
const OVERALL_PREFIX = 'Claude overall:';

export const CHECKING: ClaudeStatus = { level: 'unknown', label: `${API_PREFIX} Checking`, matched: [], incidents: [] };
export const UNAVAILABLE: ClaudeStatus = { level: 'unknown', label: `${API_PREFIX} Status unavailable`, matched: [], incidents: [] };

// The component's name on the status page is believed to be
// "Claude API (api.anthropic.com)". If neither pattern matches, the light
// falls back to the page-wide indicator and says "Claude overall:" instead.
const API_NAME_PATTERNS = [/api\.anthropic\.com/i, /\bclaude api\b/i];

/** Component statuses from least to most severe, with the text shown for each. */
const COMPONENT_STATES: [status: string, label: string][] = [
  ['operational', 'Operational'],
  ['under_maintenance', 'Under maintenance'],
  ['degraded_performance', 'Degraded performance'],
  ['partial_outage', 'Partial outage'],
  ['major_outage', 'Major outage'],
];

// A Map, not an object literal, so an upstream value like "constructor"
// can't resolve to something inherited.
const INDICATOR_STATES = new Map<string, { level: 'ok' | 'issue'; label: string }>([
  ['none', { level: 'ok', label: 'Operational' }],
  ['minor', { level: 'issue', label: 'Minor issues' }],
  ['major', { level: 'issue', label: 'Major issues' }],
  ['critical', { level: 'issue', label: 'Critical outage' }],
  ['maintenance', { level: 'issue', label: 'Under maintenance' }],
]);

const CLOSED_INCIDENT = new Set(['resolved', 'postmortem']);

const is_record = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

const as_string = (x: unknown): string => (typeof x === 'string' ? x : '');

/** Turn a parsed summary.json into the light's level and label. */
export function summarize_claude_status(summary: unknown): ClaudeStatus {
  if (!is_record(summary) || !Array.isArray(summary.components)) return UNAVAILABLE;

  const matched = summary.components
    .filter(is_record)
    .map(c => ({ id: as_string(c.id), name: as_string(c.name), status: as_string(c.status) }))
    .filter(c => API_NAME_PATTERNS.some(p => p.test(c.name)));

  const incidents = (Array.isArray(summary.incidents) ? summary.incidents : [])
    .filter(is_record)
    .map(i => ({
      id: as_string(i.id),
      name: as_string(i.name),
      status: as_string(i.status),
      component_ids: (Array.isArray(i.components) ? i.components : [])
        .filter(is_record)
        .map(c => as_string(c.id))
        .filter(Boolean),
    }))
    .filter(i => !CLOSED_INCIDENT.has(i.status));

  if (matched.length === 0) {
    const indicator = is_record(summary.status) ? as_string(summary.status.indicator) : '';
    const state = INDICATOR_STATES.get(indicator);
    if (!state) return { ...UNAVAILABLE, incidents };
    return { level: state.level, label: `${OVERALL_PREFIX} ${state.label}`, matched, incidents };
  }

  // A known problem on any matched component wins, even if another is unreadable.
  const worst = Math.max(...matched.map(c => COMPONENT_STATES.findIndex(([s]) => s === c.status)));
  if (worst > 0) {
    return { level: 'issue', label: `${API_PREFIX} ${COMPONENT_STATES[worst][1]}`, matched, incidents };
  }
  if (matched.some(c => c.status !== 'operational')) return { ...UNAVAILABLE, matched, incidents };

  // Components often stay "operational" while an incident is being investigated.
  // An incident that names no components may be about the API too: a false red
  // costs a click, a false green costs a failed run.
  const ids = new Set(matched.map(c => c.id).filter(Boolean));
  const incident_open = incidents.some(i => i.component_ids.length === 0 || i.component_ids.some(id => ids.has(id)));
  if (incident_open) return { level: 'issue', label: `${API_PREFIX} Incident reported`, matched, incidents };

  return { level: 'ok', label: `${API_PREFIX} Operational`, matched, incidents };
}

/**
 * Read status.claude.com fresh every time. Not Next's fetch cache: it serves
 * stale entries with no age limit while it revalidates, which would keep an
 * old green on screen during an outage.
 */
export async function fetch_claude_status(timeout_ms: number = 4000): Promise<ClaudeStatus> {
  const controller = new AbortController();
  // Spans the body read too, so a stalled response is cut off as well.
  const timer = setTimeout(() => controller.abort(), timeout_ms);
  try {
    const res = await fetch(SUMMARY_URL, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': '8i11/1.0 (Claude status light)' },
    });
    if (!res.ok) {
      console.error('Claude status fetch failed:', res.status);
      return UNAVAILABLE;
    }
    const result = summarize_claude_status(await res.json());
    if (result.matched.length === 0) {
      console.warn('Claude status: no API component matched on the status page; showing', result.label);
    }
    return result;
  } catch (e) {
    console.error('Claude status fetch error:', e instanceof Error ? e.message : String(e));
    return UNAVAILABLE;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Validate what the page got back from /api/claude-status. An expired session
 * answers with the login page instead of JSON, so anything that isn't exactly
 * the expected shape reads as unavailable.
 */
export function parse_claude_status_response(x: unknown): ClaudeStatusView {
  const unavailable = { level: UNAVAILABLE.level, label: UNAVAILABLE.label };
  if (!is_record(x)) return unavailable;
  const { level, label } = x;
  if (level !== 'ok' && level !== 'issue' && level !== 'unknown') return unavailable;
  if (typeof label !== 'string' || !label.trim()) return unavailable;
  return { level, label };
}
