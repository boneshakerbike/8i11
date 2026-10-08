/**
 * Substack title helpers — anti-cliche detection, duplicate detection, and
 * output parsing for the `substack` mode of /api/clean-text.
 *
 * Pure functions only (no DB, no network) so they stay unit-testable.
 */

export interface TitlePair {
  title: string;
  subtitle: string;
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'is',
  'it', 'its', 'my', 'of', 'on', 'or', 'the', 'this', 'to', 'up', 'with', 'your',
]);

/** Lowercase, strip punctuation and collapse whitespace for comparison. */
export function normalize_title(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function content_words(raw: string): string[] {
  return normalize_title(raw)
    .split(' ')
    .filter(w => w.length > 0 && !STOPWORDS.has(w));
}

/**
 * Overdone title shapes. These are the "pre-made cheesy" templates — anything
 * matching gets rejected and regenerated rather than shipped.
 */
export const CLICHE_PATTERNS: Array<{ name: string; test: RegExp }> = [
  { name: '"... Again"', test: /\bagain$/ },
  { name: '"When Your/When The ..."', test: /^when (your|the|you|i|it|a) \b/ },
  { name: '"The Art of ..."', test: /^the (art|zen|joy|beauty|magic|power) of\b/ },
  { name: '"A Love Letter to ..."', test: /^(a )?love letter to\b/ },
  { name: '"In Praise of ..."', test: /^in (praise|defense|defence) of\b/ },
  { name: '"Notes/Dispatches/Postcards from ..."', test: /^(notes|dispatches|postcards|letters|scenes|report) from\b/ },
  { name: '"Confessions of ..."', test: /^confessions of\b/ },
  { name: '"Adventures in ..."', test: /^adventures in\b/ },
  { name: '"The Trouble With ..."', test: /^the (trouble|problem) with\b/ },
  { name: '"Tales of/from ..."', test: /^tales? (of|from)\b/ },
  { name: '"Lessons from/in ..."', test: /^lessons (from|in)\b/ },
  { name: '"A Brief History of ..."', test: /^a (brief|short) history of\b/ },
  { name: '"Chasing ..."', test: /^chasing\b/ },
  { name: '"That Time I ..."', test: /^that time (i|we)\b/ },
  { name: '"How I .../Why I ..."', test: /^(how|why) (i|we|you) \b/ },
  { name: '"On X and Y"', test: /^on \w+ and \w+$/ },
  { name: '"... Gone Wrong"', test: /\bgone (wrong|sideways|right)$/ },
  { name: '"The X Chronicles/Diaries/Files"', test: /\b(chronicles|diaries|files|edition|saga)$/ },
  { name: '"Welcome to ..."', test: /^welcome to\b/ },
  { name: '"Everything I/You ..."', test: /^everything (i|you|we)\b/ },
  { name: '"... : A Love Story"', test: /\ba (love )?story$/ },
  { name: '"In Which ..."', test: /^in which\b/ },
  { name: '"The Day I/The Day The ..."', test: /^the day (i|we|the|my)\b/ },
  { name: '"Anatomy of ..."', test: /^anatomy of\b/ },
  { name: '"Ode to ..."', test: /^(an )?ode to\b/ },
  { name: '"... 101"', test: /\b101$/ },
  { name: '"... , Revisited"', test: /\brevisited$/ },
  { name: '"Small Things/Little Things ..."', test: /^(small|little|quiet|simple) (things|moments|joys|victories)\b/ },
];

/** Returns the name of the overdone template a title matches, or null. */
export function find_cliche_pattern(title: string): string | null {
  const norm = normalize_title(title);
  if (!norm) return null;
  for (const { name, test } of CLICHE_PATTERNS) {
    if (test.test(norm)) return name;
  }
  return null;
}

/**
 * True when `title` is the same as, or a close rewording of, a previous title.
 * Close = identical after normalization, or >= 60% content-word overlap.
 */
export function is_duplicate_title(title: string, previous: string[]): boolean {
  const norm = normalize_title(title);
  if (!norm) return false;

  const words = new Set(content_words(title));

  for (const prev of previous) {
    const prev_norm = normalize_title(prev);
    if (!prev_norm) continue;
    if (prev_norm === norm) return true;

    const prev_words = new Set(content_words(prev));
    if (words.size === 0 || prev_words.size === 0) continue;

    let shared = 0;
    for (const w of words) if (prev_words.has(w)) shared++;
    const union = words.size + prev_words.size - shared;
    if (union > 0 && shared / union >= 0.6) return true;
  }

  return false;
}

/**
 * Rotating title angles. A random couple are injected into each prompt so
 * successive generations approach the title from different directions instead
 * of settling into one house style.
 */
export const TITLE_ANGLES: string[] = [
  'name a specific, concrete object from the story and let it carry the whole title',
  'use a flat understatement that undersells what actually happened',
  'borrow the register of an official notice, form, or incident report',
  'lead with a number or quantity that sounds oddly precise',
  'misapply a technical or bureaucratic term to something domestic',
  'write it as a fragment of overheard speech',
  'state a plain fact from the story that sounds absurd out of context',
  'name what did NOT happen instead of what did',
  'pair two nouns from the story that have no business together',
  'use the vocabulary of a completely unrelated field (finance, law, geology, sports officiating)',
  'phrase it as a self-assessment or verdict on yourself',
  'name the day by its least impressive accomplishment',
  'use a verb that is too dramatic for the thing it describes',
  'title it after the rule, excuse, or superstition at the center of the story',
  'let a piece of equipment or an animal be the subject doing the acting',
  'use a comparison to something mundane and slightly unflattering',
];

/** Pick `count` distinct items at random, without replacement. */
function sample_without_replacement(source: string[], count: number, rand: () => number): string[] {
  const pool = [...source];
  const picked: string[] = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.min(Math.floor(rand() * pool.length), pool.length - 1);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}

/** Pick `count` distinct angles at random. */
export function pick_title_angles(count: number, rand: () => number = Math.random): string[] {
  return sample_without_replacement(TITLE_ANGLES, count, rand);
}

/**
 * Angles for the "On This Day" story title. Same voice as TITLE_ANGLES, wider
 * aperture: that title spans ten years of posts, so single-incident absurdity
 * does not fit it. These are about pattern across years.
 */
export const RETROSPECTIVE_ANGLES: string[] = [
  'name the habit you clearly cannot stop repeating on this date',
  'count the years and let the number carry the joke',
  'name the one year that broke the pattern',
  'treat the recurrence as a scheduled obligation nobody agreed to',
  'name what has changed while everything around it stayed identical',
  'describe the date itself as a recurring character with a personality',
  'name the thing you have now failed at on this date more than once',
  'contrast the earliest year with the latest in a single phrase',
];

/** Pick `count` distinct retrospective angles at random. */
export function pick_retrospective_angles(count: number, rand: () => number = Math.random): string[] {
  return sample_without_replacement(RETROSPECTIVE_ANGLES, count, rand);
}

/**
 * Worked examples for the title field, which previously had none while the
 * subtitle field had three. Each teaches a different mechanism, and each maps
 * onto a different entry in TITLE_ANGLES so the abstract angles have a
 * demonstration. Invented, not drawn from the archive.
 *
 * A test asserts every entry passes find_cliche_pattern and the word bound —
 * the shipped /api/generate prompt used to offer "October 12th Strikes Again"
 * as an example, which our own ban list rejects.
 */
export const TITLE_EXEMPLARS: Array<{ title: string; why: string }> = [
  { title: 'Defeated by a Hose Clamp', why: 'understatement: the smallest obstacle is named as the victor' },
  { title: 'Nine Dollars of Wasp Spray', why: 'an oddly precise quantity carries the whole joke' },
  { title: 'Form 1040, Trailside', why: 'bureaucratic register misapplied to something domestic' },
  { title: 'The Dog Filed a Complaint', why: 'an animal is the subject doing the acting' },
  { title: 'Everything Except the Ride', why: 'names what did not happen instead of what did' },
  { title: 'Structurally Sound, Emotionally Not', why: 'a flat self-assessment, borrowed from inspection language' },
];

/** Render the exemplars as a prompt block. */
export function build_exemplar_block(
  exemplars: Array<{ title: string; why: string }> = TITLE_EXEMPLARS
): string {
  if (exemplars.length === 0) return '';
  return [
    '**How good titles here actually work.** Each of these works for a different reason:',
    '',
    ...exemplars.map(e => `- "${e.title}" — ${e.why}`),
    '',
    'Do not use those examples. They show the mechanism only.',
  ].join('\n');
}

/** Words in a title, as a person would count them. */
export function title_word_count(title: string): number {
  const norm = normalize_title(title);
  return norm ? norm.split(' ').filter(Boolean).length : 0;
}

export const TITLE_MIN_WORDS = 2;
/** The prompt asks for 2-7; code allows 8 so a one-word quibble costs no round trip. */
export const TITLE_MAX_WORDS = 8;

export const EXPECTED_ALTERNATES = 6;

/**
 * Floor for "there is actually a story here". The prompt asks for 200-350
 * words, so this is far below a real post and only catches output that is
 * titles with no narrative.
 */
export const MIN_BODY_WORDS = 40;

function count_words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Structural completeness. Without this a truncated response is
 * indistinguishable from a perfect one: all_offered_pairs filters out entries
 * with empty titles, so a response missing its headline or its alternates
 * yields zero problems and ships as clean.
 */
export function find_structural_problems(
  parsed: ParsedSubstack,
  expected_alternates: number = EXPECTED_ALTERNATES,
  min_body_words: number = MIN_BODY_WORDS
): string[] {
  const problems: string[] = [];
  if (!parsed.title.trim()) problems.push('the headline title is missing');
  if (!parsed.subtitle.trim()) problems.push('the headline subtitle is missing');

  const body_words = count_words(parsed.body);
  if (body_words < min_body_words) {
    problems.push(
      `the story itself is ${body_words} ${body_words === 1 ? 'word' : 'words'} long, so it is missing or truncated`
    );
  }

  const complete = parsed.alternates.filter(a => a.title.trim() && a.subtitle.trim());
  if (complete.length < expected_alternates) {
    problems.push(
      `only ${complete.length} of ${expected_alternates} alternate title/subtitle pairs came back`
    );
  }
  return problems;
}

/**
 * Verbatim reuse of a subtitle we supplied as an example. Titles are covered by
 * the avoid list, but nothing checks subtitles, so without this the model can
 * lift one of the author's own subtitles word for word and nothing notices.
 */
export function find_subtitle_copies(
  parsed: ParsedSubstack,
  supplied_subtitles: string[]
): TitleProblem[] {
  const supplied = new Set(supplied_subtitles.map(normalize_title).filter(Boolean));
  if (supplied.size === 0) return [];

  const problems: TitleProblem[] = [];
  for (const pair of all_offered_pairs(parsed)) {
    if (supplied.has(normalize_title(pair.subtitle))) {
      problems.push({ title: pair.title, reason: 'reuses a supplied example subtitle verbatim' });
    }
  }
  return problems;
}

export interface ParsedSubstack {
  title: string;
  subtitle: string;
  /** The narrative between the headline pair and the captions/alternates. */
  body: string;
  alternates: TitlePair[];
}

const TITLE_LINE = /^\s*title\s*:\s*(.+)$/i;
const SUBTITLE_LINE = /^\s*sub\s*-?\s*title\s*:\s*(.+)$/i;
const ALTERNATES_HEADER = /^\s*(alternate|alternative)\s+titles?\s*:?\s*$/i;
const CAPTIONS_HEADER = /^\s*captions\s*:?\s*$/i;
/** e.g. "3. Title: Foo | Sub Title: Bar" */
const ALTERNATE_LINE = /^\s*(?:[-*]|\d+[.)])?\s*title\s*:\s*(.+?)\s*\|\s*sub\s*-?\s*title\s*:\s*(.+?)\s*$/i;

/**
 * Pull the headline pair, the narrative, and the alternate options out of the
 * model's output.
 *
 * The narrative is captured so a response that is all titles and no story can
 * be rejected. Previously it was discarded, which left nothing downstream able
 * to tell a complete post from a title list.
 */
export function parse_substack_output(text: string): ParsedSubstack {
  const lines = text.split('\n');
  let title = '';
  let subtitle = '';
  const alternates: TitlePair[] = [];
  const body_lines: string[] = [];
  let in_alternates = false;
  let body_done = false;

  for (const line of lines) {
    if (ALTERNATES_HEADER.test(line)) {
      in_alternates = true;
      body_done = true;
      continue;
    }

    if (in_alternates) {
      const alt = line.match(ALTERNATE_LINE);
      if (alt) alternates.push({ title: alt[1].trim(), subtitle: alt[2].trim() });
      continue;
    }

    if (CAPTIONS_HEADER.test(line)) {
      body_done = true;
      continue;
    }

    if (!title) {
      const t = line.match(TITLE_LINE);
      if (t) { title = t[1].trim(); continue; }
    }
    if (!subtitle) {
      const s = line.match(SUBTITLE_LINE);
      if (s) { subtitle = s[1].trim(); continue; }
    }

    // Everything between the headline and the captions/alternates header.
    if (!body_done && title) body_lines.push(line);
  }

  return { title, subtitle, body: body_lines.join('\n').trim(), alternates };
}

/** Every title the model offered in one generation (headline + alternates). */
export function all_offered_pairs(parsed: ParsedSubstack): TitlePair[] {
  const pairs: TitlePair[] = [];
  if (parsed.title) pairs.push({ title: parsed.title, subtitle: parsed.subtitle });
  for (const alt of parsed.alternates) {
    if (alt.title) pairs.push(alt);
  }
  return pairs;
}

export interface TitleProblem {
  title: string;
  reason: string;
}

/**
 * Check the headline and every alternate for repetition and length.
 *
 * Cliche templates are deliberately NOT checked here. They remain in the prompt
 * as guidance, but gating on them made the retry's accept test "fewer regex
 * hits", which rewarded blander rewrites and discarded funnier ones that tied.
 * Whether a title is good is not something this function can know; it only
 * enforces structure.
 */
export function find_title_problems(parsed: ParsedSubstack, previous: string[]): TitleProblem[] {
  const problems: TitleProblem[] = [];
  const seen_this_run: string[] = [];

  for (const pair of all_offered_pairs(parsed)) {
    const words = title_word_count(pair.title);

    if (is_duplicate_title(pair.title, previous)) {
      problems.push({ title: pair.title, reason: 'repeats a title already used on a previous post' });
    } else if (is_duplicate_title(pair.title, seen_this_run)) {
      problems.push({ title: pair.title, reason: 'is a reword of another option in this same batch' });
    } else if (words < TITLE_MIN_WORDS || words > TITLE_MAX_WORDS) {
      problems.push({
        title: pair.title,
        reason: `is ${words} ${words === 1 ? 'word' : 'words'}; needs ${TITLE_MIN_WORDS} to ${TITLE_MAX_WORDS}`,
      });
    }
    seen_this_run.push(pair.title);
  }

  return problems;
}
