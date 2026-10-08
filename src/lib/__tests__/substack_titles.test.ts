import { describe, it, expect } from 'vitest';
import {
  all_offered_pairs,
  EXPECTED_ALTERNATES,
  find_cliche_pattern,
  find_structural_problems,
  find_subtitle_copies,
  find_title_problems,
  is_duplicate_title,
  normalize_title,
  parse_substack_output,
  pick_retrospective_angles,
  pick_title_angles,
  RETROSPECTIVE_ANGLES,
  TITLE_ANGLES,
  TITLE_EXEMPLARS,
  TITLE_MAX_WORDS,
  TITLE_MIN_WORDS,
  title_word_count,
} from '../substack_titles';

describe('normalize_title', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalize_title('  The Wind,   Again!  ')).toBe('the wind again');
  });

  it('normalizes curly quotes', () => {
    expect(normalize_title('Mo’s Brakes')).toBe("mo's brakes");
  });
});

describe('find_cliche_pattern', () => {
  const overdone = [
    'Into the Wind Again',
    'When Your Bike Has Other Ideas',
    'The Art of Doing Nothing',
    'A Love Letter to Missoula',
    'In Praise of Slow Mornings',
    'Notes From the Garage',
    'Confessions of a Weekend Mechanic',
    'Adventures in Wasp Control',
    'The Trouble With Brake Fluid',
    'Tales From the Trailhead',
    'Lessons From a Blood Draw',
    'A Brief History of My Excuses',
    'Chasing Daylight',
    'That Time I Skipped the Ride',
    'How I Learned to Wait',
    'On Wasps and Waiting',
    'Trail Day Gone Wrong',
    'The Missoula Chronicles',
    'Welcome to the Garage',
    'Everything I Know About Brakes',
    'Brake Fluid: A Love Story',
    'In Which Nothing Happens',
    'The Day I Stayed Home',
    'Anatomy of a Rest Day',
    'Ode to Hydraulic Fluid',
    'Wasp Control 101',
    'The Ride, Revisited',
    'Small Things That Count',
  ];

  it.each(overdone)('rejects %s', title => {
    expect(find_cliche_pattern(title)).not.toBeNull();
  });

  const fine = [
    'Outridden by Adulting',
    'Brake Fluid Before Bike Fluid',
    'My Biggest Ride Was to the Bike Shop',
    'Medic Earth vs the Property Line',
    'Two Garage Reorganizations, Zero Miles',
  ];

  it.each(fine)('accepts %s', title => {
    expect(find_cliche_pattern(title)).toBeNull();
  });

  it('returns null for an empty title', () => {
    expect(find_cliche_pattern('   ')).toBeNull();
  });
});

describe('is_duplicate_title', () => {
  const previous = ['Outridden by Adulting', 'Brake Fluid Before Bike Fluid'];

  it('catches an exact repeat regardless of case and punctuation', () => {
    expect(is_duplicate_title('outridden by adulting!', previous)).toBe(true);
  });

  it('catches a near reword', () => {
    expect(is_duplicate_title('Outridden by the Adulting', previous)).toBe(true);
  });

  it('allows a genuinely different title', () => {
    expect(is_duplicate_title('Two Garage Reorganizations, Zero Miles', previous)).toBe(false);
  });

  it('does not flag titles that only share stopwords', () => {
    expect(is_duplicate_title('A Yard of My Own', ['The Ride to the Shop'])).toBe(false);
  });

  it('handles an empty history', () => {
    expect(is_duplicate_title('Anything At All', [])).toBe(false);
  });
});

const SAMPLE = `Title: Outridden by Adulting
Sub Title: Blood draws, physical therapy, wasps, and one stubborn rule about other people's brakes

I didn't get in the rides I needed. Yesterday started reasonably enough.

captions

Image 1: The wasp situation, ongoing

alternate titles

1. Title: Brake Fluid Before Bike Fluid | Sub Title: Why the trail had to wait until my partner's bike was whole again
2. Title: Two Garage Reorganizations, Zero Miles | Sub Title: An accounting of everything that happened instead of riding
`;

describe('parse_substack_output', () => {
  it('pulls the headline pair and the alternates', () => {
    const parsed = parse_substack_output(SAMPLE);
    expect(parsed.title).toBe('Outridden by Adulting');
    expect(parsed.subtitle).toContain('Blood draws');
    expect(parsed.alternates).toHaveLength(2);
    expect(parsed.alternates[1].title).toBe('Two Garage Reorganizations, Zero Miles');
    expect(parsed.alternates[1].subtitle).toBe('An accounting of everything that happened instead of riding');
  });

  it('does not mistake narrative text for a title line', () => {
    const parsed = parse_substack_output('Title: Real One\nSub Title: Real deck\n\nTitle: not this one');
    expect(parsed.title).toBe('Real One');
    expect(parsed.alternates).toHaveLength(0);
  });

  it('tolerates "Subtitle" spelled without the space', () => {
    const parsed = parse_substack_output('Title: A\nSubtitle: B');
    expect(parsed.subtitle).toBe('B');
  });

  it('returns empties for unparseable output', () => {
    const parsed = parse_substack_output('just some prose');
    expect(parsed.title).toBe('');
    expect(parsed.alternates).toEqual([]);
  });

  it('collects every offered pair', () => {
    expect(all_offered_pairs(parse_substack_output(SAMPLE))).toHaveLength(3);
  });
});

describe('find_title_problems', () => {
  it('is clean when nothing is overdone or repeated', () => {
    expect(find_title_problems(parse_substack_output(SAMPLE), ['Something Else Entirely'])).toEqual([]);
  });

  it('no longer gates on cliche templates — they are prompt guidance only', () => {
    // Gating on these made the retry's accept test "fewer regex hits", which
    // rewarded blander rewrites. find_cliche_pattern still flags the shape for
    // the prompt's benefit; find_title_problems deliberately does not.
    const parsed = parse_substack_output('Title: Into the Wind Again\nSub Title: A deck');
    expect(find_cliche_pattern('Into the Wind Again')).not.toBeNull();
    expect(find_title_problems(parsed, [])).toEqual([]);
  });

  it('flags a title below the word bound', () => {
    const parsed = parse_substack_output('Title: Wasps\nSub Title: A deck');
    const problems = find_title_problems(parsed, []);
    expect(problems).toHaveLength(1);
    expect(problems[0].reason).toContain('needs 2 to 8');
  });

  it('flags a title above the word bound', () => {
    const parsed = parse_substack_output(
      'Title: Nine Separate Reasons The Ride Did Not Happen Yesterday\nSub Title: A deck'
    );
    const problems = find_title_problems(parsed, []);
    expect(problems).toHaveLength(1);
    expect(problems[0].reason).toContain('needs 2 to 8');
  });

  it('allows a title exactly at each bound', () => {
    expect(find_title_problems(parse_substack_output('Title: Wasp Spray\nSub Title: d'), [])).toEqual([]);
    expect(
      find_title_problems(
        parse_substack_output('Title: One Two Three Four Five Six Seven Eight\nSub Title: d'),
        []
      )
    ).toEqual([]);
  });

  it('flags a repeat of a previously used title', () => {
    const problems = find_title_problems(parse_substack_output(SAMPLE), ['Outridden by Adulting']);
    expect(problems).toHaveLength(1);
    expect(problems[0].title).toBe('Outridden by Adulting');
    expect(problems[0].reason).toContain('previous post');
  });

  it('flags an alternate that rewords the headline', () => {
    const parsed = parse_substack_output(
      'Title: Outridden by Adulting\nSub Title: A deck\n\nalternate titles\n\n1. Title: Outridden by the Adulting | Sub Title: Another deck'
    );
    const problems = find_title_problems(parsed, []);
    expect(problems).toHaveLength(1);
    expect(problems[0].reason).toContain('same batch');
  });
});

describe('pick_title_angles', () => {
  it('returns the requested count with no repeats', () => {
    const picked = pick_title_angles(3);
    expect(picked).toHaveLength(3);
    expect(new Set(picked).size).toBe(3);
    for (const angle of picked) expect(TITLE_ANGLES).toContain(angle);
  });

  it('caps at the pool size', () => {
    expect(pick_title_angles(999)).toHaveLength(TITLE_ANGLES.length);
  });
});

describe('title_word_count', () => {
  it('counts words the way a person would', () => {
    expect(title_word_count('Defeated by a Hose Clamp')).toBe(5);
    expect(title_word_count('Form 1040, Trailside')).toBe(3);
  });

  it('ignores punctuation and extra whitespace', () => {
    expect(title_word_count('  Wasps,   Again!  ')).toBe(2);
  });

  it('returns 0 for an empty title', () => {
    expect(title_word_count('   ')).toBe(0);
  });
});

describe('TITLE_EXEMPLARS', () => {
  // The shipped /api/generate prompt offered "October 12th Strikes Again" as an
  // example, which our own ban list rejects. This test encodes that lesson.
  it.each(TITLE_EXEMPLARS)('$title is not itself a tired shape', ({ title }) => {
    expect(find_cliche_pattern(title)).toBeNull();
  });

  it.each(TITLE_EXEMPLARS)('$title obeys the word bound', ({ title }) => {
    const words = title_word_count(title);
    expect(words).toBeGreaterThanOrEqual(TITLE_MIN_WORDS);
    expect(words).toBeLessThanOrEqual(TITLE_MAX_WORDS);
  });

  it('explains a distinct mechanism for each', () => {
    const reasons = TITLE_EXEMPLARS.map(e => e.why);
    expect(new Set(reasons).size).toBe(reasons.length);
  });
});

describe('find_structural_problems', () => {
  const full = (n: number) =>
    'Title: Headline Title Here\nSub Title: A real deck\n\nbody\n\nalternate titles\n\n' +
    Array.from({ length: n }, (_, i) => `${i + 1}. Title: Option ${i + 1} Here | Sub Title: deck ${i + 1}`).join('\n');

  it('passes a complete response', () => {
    expect(find_structural_problems(parse_substack_output(full(EXPECTED_ALTERNATES)))).toEqual([]);
  });

  it('catches a short batch that find_title_problems would call clean', () => {
    const parsed = parse_substack_output(full(2));
    expect(find_title_problems(parsed, [])).toEqual([]);
    const problems = find_structural_problems(parsed);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('only 2 of 6');
  });

  it('catches a missing headline title and subtitle', () => {
    const problems = find_structural_problems(parse_substack_output('just prose'));
    expect(problems.some(p => p.includes('headline title'))).toBe(true);
    expect(problems.some(p => p.includes('headline subtitle'))).toBe(true);
  });

  it('counts an alternate with no subtitle as incomplete', () => {
    const parsed = parse_substack_output(
      'Title: A Real Headline\nSub Title: deck\n\nalternate titles\n\n1. Title: Lonely Option Here | Sub Title: '
    );
    expect(find_structural_problems(parsed, 1)[0]).toContain('only 0 of 1');
  });
});

describe('find_subtitle_copies', () => {
  const parsed = parse_substack_output('Title: A Fine Headline\nSub Title: the exact supplied subtitle');

  it('flags a subtitle lifted verbatim from a supplied example', () => {
    const problems = find_subtitle_copies(parsed, ['The Exact Supplied Subtitle!']);
    expect(problems).toHaveLength(1);
    expect(problems[0].reason).toContain('supplied example subtitle');
  });

  it('allows a subtitle that merely shares the register', () => {
    expect(find_subtitle_copies(parsed, ['something else entirely here'])).toEqual([]);
  });

  it('is a no-op with nothing supplied', () => {
    expect(find_subtitle_copies(parsed, [])).toEqual([]);
  });
});

describe('pick_retrospective_angles', () => {
  it('draws distinct angles from the retrospective set', () => {
    const picked = pick_retrospective_angles(3);
    expect(picked).toHaveLength(3);
    expect(new Set(picked).size).toBe(3);
    for (const a of picked) expect(RETROSPECTIVE_ANGLES).toContain(a);
  });

  it('is a different set from the single-incident angles', () => {
    expect(RETROSPECTIVE_ANGLES.some(a => TITLE_ANGLES.includes(a))).toBe(false);
  });
});
