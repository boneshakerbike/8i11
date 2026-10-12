# Health Roadmap

Source of truth for the Health and Coach redo that began 2026-10-12. It replaces `coach-roadmap.md`. Issues may reference this doc, but planned work has been closed in the tracker before without being built (#241 to #243), so this file is what counts. Update the Status section as work lands.

## Goal

Bill, in his words: a 99-year-old athlete who can ride a mountain bike at a downhill park, strong enough to resist crashing and fit enough to go all day. Active and off meds as long as possible. The coach adapts but holds its ground. Flexible, but the main goal is definitive.

## Why the redo

- **COROS released an official MCP server** (`https://mcp.coros.com/mcp`, OAuth, free). It gives structured sleep, HRV, resting HR, stress, recovery, VO2max, activities (HR, elevation, descent, laps, zones) and training load, and can write workouts.
- **COROS ingestion has never been reliable.** No API and terms that ban scraping (#8, #158). The Chrome-extension scrape broke twice (#175, #256). Today it is a manual paste into `/api/coros/save`, stored as a blob.
- **The coach lost trust.** 66 sessions reviewed 2026-07-03, most ended in arguments. Root causes:
  1. Context amnesia: only the last 3 session summaries, cut to 300 characters each.
  2. Data errors: wrong weekday (UTC vs Mountain Time), wrong sleep night, a nap read as the night, descent read as climbing.
  3. Broken summaries fed into later sessions.
  4. Arguing against Bill's philosophy instead of coaching within it.
  5. Caving to the Oura advisor, which has 10 years of his data.
- **#277 (open):** the coach treated nervous-system overload as a mindset problem and ignored 90-day trends.

## Design

### Source roles

- **Oura** is the source for recovery: last night's sleep, HRV, resting HR, SpO2. It decides how hard today can be.
- **COROS** is the source for training: what was done, Zone 2 time, strength sessions, ride and park days, VO2max trend. It decides whether the week moved toward the goal. COROS records every ride.
- **Ride with GPS** keeps its page for extra ride detail. The coach does not read it.
- **Rule kept from #193:** device load or fatigue scores never drive decisions. They are stored and shown only.

### The direction: 4 pillars, measured weekly

Draft. Bill's research replaces the pillars and targets.

1. **Engine** (ride all day): Zone 2 minutes per week, VO2max trend. COROS.
2. **Strength and power** (resist crashes): strength sessions per week. COROS sport type.
3. **Skill and balance** (ride the park): ride days, park days, descent. COROS.
4. **Recovery and body:** sleep, HRV and resting HR (7-day vs 90-day baseline) from Oura; weight (7-day average, typed in).

### Coach memory

- **Core:** Bill's Master State of Knowledge, fixed. Position changes need new information, never pressure alone. When Bill is going to ride regardless, coach the ride he is actually going to do.
- **Profile:** facts editable in the app: routine, injuries (knee/ACL), e-assist calibration, "biking is regulatory", bike parks use lifts, autism and nervous-system context (#277).
- **Sessions:** the last 7 session summaries, not truncated.
- At save, the coach proposes profile edits; Bill accepts or rejects each one.

CAUTION on seeding the core: Bill's studies live in `My Drive/Health/` and there are many. Do not guess which is the Master SoK. Confirm with Bill first.

### Pages

- `/health` is the daily page (Today): recovery line, training line, pillar scorecard, inputs, coach chat.
- Tabs: Trends, Oura, COROS, Ride with GPS.
- The home page Health card keeps its drill-down links.
- `/coach` redirects to `/health`.

## Phases (one PR each, in order)

### Phase 0: Prove COROS access (gate)

COROS documents ChatGPT, Codex and Claude as clients. It is unconfirmed that it accepts our own OAuth client (dynamic registration plus our callback URL). The Claude cloud sandbox cannot reach mcp.coros.com, so the test runs on a Vercel preview.

- `src/lib/coros/mcp-client.ts`: official `@modelcontextprotocol/sdk` client against the US server (`https://mcpus.coros.com/mcp`, override with `COROS_MCP_URL`). The SDK's `auth()` does discovery, registration, PKCE and refresh.
- `src/lib/coros/store.ts` and `oauth-provider.ts`: OAuth state in a `coros_oauth` table, one row per site origin, because production and each preview register their own callback and share one database.
- Read-only allowlist `COROS_READ_TOOLS`. Write tools are refused before reaching COROS.
- Routes: `/api/coros/authorize`, `/api/coros/callback` (CSRF state cookie), `/api/coros/disconnect`, `/api/coros/mcp` (status, 7-day sample, single call).
- Test page: `/health/coros/mcp`.
- **Test path:** sign in on the branch preview with the Admin PIN. `is_owner_or_preview_admin` (`src/lib/owner.ts`) accepts that session only when `VERCEL_ENV === 'preview'`; production stays GitHub-owner only.
- **Go:** sign-in completes and the sample returns data. Save the sample output as fixtures for Phase 2.
- **No-go fallback:** a daily Claude Routine with the COROS connector calls the read tools and POSTs JSON to an owner-secret ingest route.

### Phase 1: Foundation fixes

Done in this branch; see Status.

### Phase 2: COROS through MCP

- Read-only tool allowlist: `querySleepData`, `querySleepHrv`, `queryRestingHeartRate`, `queryRecoveryStatus`, `queryFitnessAssessmentOverview`, `querySportRecords`, `getActivityDetail`, `queryTrainingLoadAssessment` (display only).
- Tables `coros_daily` and `coros_activities` (ascent and descent kept separate). `coros_data` stays readable, no new writes.
- The one daily cron syncs Oura, then COROS, then computes trends. "Sync now" button on the COROS page.
- Retire the Chrome prompt, the paste box, `/api/coros/save` and the blanket `api/coros` proxy exemption.

### Phase 3: Coach rebuild

- `src/lib/health/daily-brief.ts` replaces `data-injection.ts`: pure function, states date and weekday (America/Denver), names the sleep night, separates descent from climbing, marks lift-assisted park days.
- 7-day vs 90-day baselines; `src/lib/health/scorecard.ts` for the pillars.
- `coach_documents` table (core, profile; versioned).
- Prompt: cached framework + core + profile, then the daily brief.
- Summarizer returns structured output (facts learned, decisions, developer notes, proposed profile edits) and stores nothing when validation fails.
- Model change proposed: `COACHING_DAILY` to `claude-opus-5-5` at low effort, `COACHING_REFINE` to `claude-haiku-5-5`. Bill decides.

### Phase 4: Health area layout

- Split `src/app/coach/page.tsx` into components; `/health` becomes Today.
- `/health/trends` with 90-day and 1-year ranges.
- Nav and home card: Today, Trends, Oura, COROS, Ride with GPS.

### Later

- COROS workout writing behind an Approve button (`createScheduledWorkout`, cycling only).

## Decisions locked with Bill

- 2026-07-03: weight input stays typed; blank on the road is intentional. Back and bowel are 4-level tap selectors stored numerically (shipped #244). The notes field stays as is.
- 2026-10-12: COROS has all rides, so it is the coach's training source. Ride with GPS stays as a drill-down page. Health is the coach plus access to all the data, with home page drill-downs kept. COROS stays read-only for now; writing comes later behind Approve.

## Needed from Bill

- Which Drive file is the Master SoK.
- Pillar targets, or confirm the draft pillars.
- Yes or no on the coach model change.
- Any research, data or agent review to fold in before Phase 3.

## Status

### Done

- Earlier: mobile layout and collapsible metrics (#240), tap selectors (#244), Mountain Time day boundary (#248), in-progress chat survives refresh (#262).
- Phase 1 (#296):
  - Daily trends cron reaches its route. The proxy redirected it to `/login` because cron requests have no session; it now passes on the `CRON_SECRET` bearer alone, for that exact path (`src/lib/cron_auth.ts`, `src/proxy.ts`). The route fails closed if `CRON_SECRET` is unset.
  - `daily_metrics` writes merge instead of replace (`DAILY_METRICS_MERGE_SQL`): a null never erases a saved value, so the cron no longer blanks session inputs.
  - `daily_metrics` is no longer pruned after 365 days.
  - `src/lib/health/oura-derive.ts`: one `primary_sleep` (longest long_sleep, never a nap) and one `estimate_cv_age`, replacing 5 copies. Oura sync now takes HRV and resting HR from the night instead of the first period.
  - Removed dead code: Oura personal-info helpers, `get_wellness_scores`, `getMetricByColumn`, `/api/coaching/backfill`, orphan `/health/wellness`.
  - CI runs `npx vitest run`.

- Phase 1 merged in #296 (2026-10-12). A calendar reminder checks the first cron run on 2026-10-13.

### In progress

- Phase 0: code built, awaiting Bill's preview test (Admin PIN, Connect COROS, Run 7-day sample, paste the output).

### Next

- Phase 2, once Phase 0 passes.

## Regenerating the session dump

The full coaching transcript dump (`coaching_sessions_dump.txt`, gitignored) is derived data. Regenerate with Turso creds in `.env.local`:

```js
// dump_coaching_tmp.mjs: run from repo root: node dump_coaching_tmp.mjs > coaching_sessions_dump.txt
import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
const r = await db.execute('SELECT date, advice_full, advice_summary, conversation_turns, token_count, created_at FROM coaching_history ORDER BY date ASC');
console.log('TOTAL SESSIONS:', r.rows.length);
for (const row of r.rows) {
  const d = new Date(Number(row.date) * 86400000).toISOString().split('T')[0];
  console.log(`\n========================================\nDATE: ${d} | turns: ${row.conversation_turns} | tokens: ${row.token_count}`);
  console.log('--- SUMMARY ---\n' + (row.advice_summary || '(none)'));
  console.log('--- FULL ---\n' + row.advice_full);
}
```
