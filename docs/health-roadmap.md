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

#### Phase 0 findings (preview test, 2026-10-12): PASSED

- COROS accepted our self-registered OAuth client on a preview URL. Sign-in, token exchange and tool calls all worked.
- The server offers 33 tools, read and write. The sleep tool is `querySleepOverview`; there is no `querySleepData`.
- **Output is human-readable text, not JSON.** Each result is one `text` block holding a JSON-encoded string (parse the string first, then the lines). Phase 2 needs a line parser per tool, tested against sanitized fixtures; store the raw text too.
- **Dates are wake-up days:** the sleep of night D is filed under D+1, the same convention as Oura's `day`. "Last night" is today's date in both sources.
- Date parameters are `yyyyMMdd` strings. `querySleepHrv` requires `startDate`, `endDate` and `days` (max 7). Health queries return at most 7 days per call.
- `querySportRecords` returns `labelId` and `sportType` per activity; `getActivityDetail` needs both. Sport codes seen: 204 mountain bike, 402 strength, 900 walk, 9806 custom outdoor (one e-MTB ride was logged this way). Ride pillars must count 200 to 205 plus 9806.
- COROS reports its own sleep HRV, resting HR and a "HRV Baseline" that differ from Oura's numbers. Keep one source per metric: Oura for recovery (HRV, resting HR, sleep), COROS for training.
- Activity results include GPS start coordinates. Do not commit raw results; fixtures must be sanitized.
- COROS fills a missing value with 65535 (seen as 655.35 for efficiency factor). Parsers treat 65535, 6553.5 and 655.35 as missing.
- `getActivityDetail` (needs `labelId` and `sportType`) reports elevation gain and loss separately. Ascent and descent can be stored apart, which fixes the old "descent read as climbing" bug at the source.
- `getActivityDetail` also reports COROS's intensity read: "Aerobic TE", "Anaerobic TE" and "Training Focus" (Oct 10 ride: 4.7, 1.6, "Base"). An interval session is recognized from it automatically (`src/lib/coros/classify.ts`): a high-intensity focus, or an anaerobic TE of 3.0 or more. The label wording will be confirmed on the first real interval ride.
- `getActivityDetail` on a strength session (402) has no exercises. `queryActivityLapData` does, and answers in JSON rather than text: `lapGroups[].laps[]` with `exerciseNameKey`, `sets`, `reps`, `time` and `weight`. Each exercise has effort and rest rows (`sets` 0), then one summary row (`sets` above 0); "Rest" summary rows are the breaks. On the Oct 8 session the summary rows add up to COROS's own total (17 sets, 1:19:55). The weight unit is not confirmed yet; every weight was 0 that day.
- Custom sports (9800-9807) get a generic detail with no elevation, max speed or training effect. Bill's e-MTB rides logged as custom "Missoula E MTB" (9806) therefore have no climbing data. The built-in Mountain E-Bike mode (205) reports the full set, so it's the better watch mode for e-MTB rides. Rides logged as 9806 still count as ride days.

#### When the data actually arrives (Bill, 2026-10-12, corrected 2026-10-13)

- Neither device uploads on its own. Oura and COROS data reach the web only after Bill opens each app in the morning and it syncs with the ring and the watch. Until then, last night's sleep and yesterday's later activities are not in either cloud.
- So the daily job runs at midday (18:00 UTC), and every run re-fetches the whole last 7 days from both sources. A morning when the apps were opened late (or a trip) heals on the next run.
- Pace on the weekly scorecard is measured through yesterday, so an unsynced morning never counts against Bill.
- The coach's morning session will pull fresh data itself (Phase 3), not rely on the daily job alone. When last night has not been uploaded yet, the brief must say so ("open the Oura app") instead of reading the gap as no sleep.

### Phase 2: COROS through MCP

- Read-only tool allowlist: `queryDailyHealthData`, `querySleepOverview`, `querySleepHrv`, `queryRestingHeartRate`, `queryRecoveryStatus`, `queryFitnessAssessmentOverview`, `querySportRecords`, `getActivityDetail`, `queryTrainingLoadAssessment` (display only).
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

## Resource budget (free tiers)

Standing rule: stay inside the free tiers. Every change states what it adds.

| Service | Free limit | Health features use |
|---|---|---|
| Vercel cron (Hobby) | 2 jobs, at most daily | 1 job, daily at 18:00 UTC |
| Vercel functions (Hobby) | 1M invocations/month | ~30/day (page loads, one daily run, Sync now) |
| Turso (free) | 500M rows read, 10M rows written, 5 GB/month; over the limit, queries are BLOCKED. A read is a row scan. | <100 rows written/day; reads are primary-key or indexed range reads |
| COROS MCP | free; FIT files 50/day | ~8 calls/day plus at most 10 detail or lap lookups per run; no FIT files |
| Oura API | 5,000 requests per 5 minutes | ~13/day |
| GitHub Actions | free for a public repo | lint + tests per push |
| Claude API (paid) | n/a | coach: 1-3 turns/day, cents |

## Decisions locked with Bill

- 2026-07-03: weight input stays typed; blank on the road is intentional. Back and bowel are 4-level tap selectors stored numerically (shipped #244). The notes field stays as is.
- 2026-10-12 (Phase 3 inputs): the core is Drive `Health/Personal-Health-Ledger/Vetted-Longevity-Research/2026-04-02-Longevity-Coaching-Framework.md` (15 Levers), stored in the app database, never in this public repo. The framework overrides Bill's wishes where they differ. The coach moves to Opus 5.5 at low effort. Weekly checks:
  - ride time at least 7 h
  - a ride every day (MTB, e-MTB, gravel)
  - yoga/mobility every work day
  - heavy strength 3x/week
  - 1 interval session/week
  - sleep: 8 h average goal, 7 h asleep minimum
  - resting HR and HRV: against Bill's own 90-day normal
  - weight: never above 195 lb, under 190 lb at least once a week

  Intervals and heavy strength are detected from COROS automatically, not logged (`src/lib/coros/classify.ts`). Heavy strength means at least 6 working sets with added weight; a session with fewer is mobility (the Oct 8 session: 17 sets, none loaded). Confirm on the first real heavy session. The coach must nudge framework items that are behind; it never did for two months.
- 2026-10-12: COROS has all rides, so it is the coach's training source. Ride with GPS stays as a drill-down page. Health is the coach plus access to all the data, with home page drill-downs kept. COROS stays read-only for now; writing comes later behind Approve.

## Needed from Bill

- Settled 2026-10-12: the core is the Longevity Coaching Framework, the weekly targets are set (Decisions above), and the coach model moves to Opus 5.5.
- Later in Phase 3: paste the framework text into the app once (coach memory step). It lives in the database, never in this repo.

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

- Phase 0 (#297): COROS sign-in and read-only probe. Passed on the preview 2026-10-12; findings above.

- Phase 2 (#298 to #302, merged 2026-10-12):
  - `src/lib/coros/parse.ts`: one parser per read tool, tested on sanitized fixtures and checked once against real output (kept out of the repo).
  - `coros_daily` and `coros_activities` tables (merge writes, never pruned); `src/lib/coros/sync.ts` pulls the last 7 days, so a missed night heals itself. Tool errors and "text but nothing parsed" are reported, not skipped.
  - Production stores the COROS connection under its fixed domain (`coros_origin`, from `VERCEL_PROJECT_PRODUCTION_URL`) so the daily job finds it.
  - Daily job at midday (18:00 UTC): Oura re-fetch of 7 days (moved to `src/lib/health/oura-sync.ts`), then COROS, then trends. Each step runs even if another fails; every run is logged in `health_sync_runs`.
  - "Daily sync ran ..." line on the Coach and COROS pages (`src/components/sync_status.tsx`). It turns red if the job is over 26 hours late, a step failed, or COROS is disconnected.
  - COROS page rebuilt on the synced data, with Sync now. The Chrome-scrape prompt, the paste box, `/api/coros/save` and the blanket `api/coros` proxy exemption are gone. `daily_metrics` reads COROS from `coros_daily`.
  - Ascent and descent per outdoor activity from `getActivityDetail` ("Elevation Gain / Loss: X m / Y m"): asked once per activity, at most 10 per run. A ride with no elevation line is reported as a possible format change.
  - Strength sessions: exercises, working sets and loaded sets from `queryActivityLapData`, asked once per session within the same 10-per-run cap (about 5 to 8 calls a week). The COROS page labels each one "Heavy strength" or "Mobility" and lists the exercises, or says "Exercises not read yet" / "No exercise list in COROS". Lap data it cannot read is reported once as a possible format change, and so is an empty lap list on a session COROS counted sets for.
  - When more activities need a detail or lap call than the 10-per-run cap allows, the sync line says "N more next run" (first seen 2026-10-12: two strength sessions waited silently).
  - Preview test 2026-10-12: Connect, then Sync now returned "7 days, 14 activities" with no warnings.

### In progress

- Phase 3, step 1: weekly scorecard (`src/lib/health/scorecard.ts`, `/api/coaching/scorecard`, box on `/coach`).
  - Collapsed by default to one line: "N of M on track", colored by the worst status, naming anything missed or behind. Tap to see every row; the choice is remembered on the device.
  - This week, Monday to Sunday Mountain Time, against the targets in Decisions. Plain counting, no AI; the coach will read the same rows.
  - Status per row: Done, On track (at the pace needed through yesterday), Behind, Missed (no longer reachable this week, or weight over 195), No data.
  - HRV and resting HR: the last 7 days against the 90 days before them. Off normal means more than half a standard deviation from the 90-day mean on the bad side (smallest worthwhile change, Plews et al., Sports Med 2013). Needs 28 days of history first.
  - Rides count built-in bike types 200 to 205 plus custom 9806 (e-MTB). Yoga/mobility counts strength sessions not classified heavy, on Monday to Friday.
  - Sleep, HRV and resting HR come from the Oura cache, with coach-session history (`daily_metrics`, the same Oura numbers) filling days the cache lacks. The old daily job never ran, so the cache alone was too thin for a 90-day normal (seen on the first preview, 2026-10-12).
  - The daily job now fetches Oura through today: Oura files last night's sleep under today, and it is final by midday. Today's partial activity is replaced by the next day's forced re-fetch. The Oura page's Sync button still ends yesterday.
  - Resource use: one page load reads about 7 activity rows, 7 sleep rows, 97 HRV rows, 97 coach-history rows and 7 weight rows. No COROS or Oura calls.

### Next

- Phase 3, next steps (one at a time): the daily brief (data in, labeled text out), coach memory (framework and profile in the database), the coach reading the brief and scorecard with nudges for what is behind, then the structured session summary.

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
