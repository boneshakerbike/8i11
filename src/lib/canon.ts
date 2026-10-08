/**
 * Canon: recurring people, places, gear, animals, rules and running jokes.
 *
 * This is what lets a title land a callback that a single paragraph of input
 * could never reach — the thing that makes a title read as "mine" to people who
 * know the author.
 *
 * ======================================================================
 * EVERY ENTRY BELOW IS A DRAFT (`confirmed: false`) AND IS NOT SENT TO THE
 * MODEL. Entries were inferred from past conversation and may be wrong.
 * Flip `confirmed: true` on the ones that are right, correct or delete the
 * rest, and add what is missing. Only confirmed entries reach a prompt, so a
 * bad guess can never put a false claim about your life into a title.
 * ======================================================================
 */

export type CanonKind = 'person' | 'place' | 'gear' | 'animal' | 'rule' | 'joke';

export interface CanonEntry {
  kind: CanonKind;
  name: string;
  /** One clause the model can actually use. Keep it concrete. */
  note: string;
  /** DRAFT until you set this to true. False entries never reach the model. */
  confirmed: boolean;
}

/**
 * Titles you personally vouch for. These are the strongest grounding available
 * — stronger than sampled archive titles, which include your weaker ones by
 * definition — so they are shown first.
 *
 * Add real titles of yours that you think genuinely landed. Leave empty and the
 * section is omitted.
 */
export const ENDORSED_TITLES: string[] = [
  // e.g. 'Outridden by Adulting',
];

export const CANON: CanonEntry[] = [
  { kind: 'person', name: 'Mo', note: 'partner; her bike is the one you refuse to leave broken', confirmed: false },
  { kind: 'place', name: 'Missoula, Montana', note: 'home; rides start and end here', confirmed: false },
  { kind: 'place', name: 'the high shoulders above town', note: 'the climb you can see for miles from, the one you keep meaning to get to', confirmed: false },
  { kind: 'gear', name: 'hydraulic brakes', note: 'recurring maintenance nemesis; brake fluid and back-ordered parts', confirmed: false },
  { kind: 'rule', name: 'fix what you broke first', note: "you don't ride until you've repaired what you wrecked on someone else's bike", confirmed: false },
  { kind: 'joke', name: 'renegotiating the property line', note: 'the ongoing wasp campaign in the back yard', confirmed: false },
  { kind: 'joke', name: 'reorganizing the garage', note: 'what you do instead of deciding something', confirmed: false },
];

/** Only entries you have confirmed. Drafts are filtered out here. */
export function confirmed_canon(entries: CanonEntry[] = CANON): CanonEntry[] {
  return entries.filter(e => e.confirmed && e.name.trim() && e.note.trim());
}

/**
 * Render confirmed canon as a prompt block, or '' when nothing is confirmed.
 *
 * The framing matters as much as the content: canon is reference, not a
 * checklist. A callback that has nothing to do with the story reads worse than
 * no callback.
 */
export function build_canon_block(entries: CanonEntry[] = CANON): string {
  const confirmed = confirmed_canon(entries);
  if (confirmed.length === 0) return '';

  return [
    '**Recurring cast and running jokes.** Reference material, not a checklist:',
    '',
    ...confirmed.map(e => `- ${e.name} (${e.kind}): ${e.note}`),
    '',
    'Use one of these only if the story actually touches it. A callback forced onto an unrelated story is worse than none.',
  ].join('\n');
}

/** Render endorsed titles as a prompt block, or '' when none are set. */
export function build_endorsed_block(titles: string[] = ENDORSED_TITLES): string {
  const clean = titles.map(t => t.trim()).filter(Boolean);
  if (clean.length === 0) return '';

  return [
    '**Titles the author considers his best.** These are the target to match for voice and wit:',
    '',
    ...clean.map(t => `- "${t}"`),
    '',
    'Do not reuse these. They show the bar, not the wording.',
  ].join('\n');
}
