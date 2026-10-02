import { describe, it, expect } from 'vitest';
import {
  context_file_name,
  is_context_file,
  parse_headings,
  insert_at_heading,
  strip_session_log,
  is_valid_dated_name,
  today_local,
  to_descriptor,
  drive_query_literal,
  drive_fulltext_value,
  validate_edit,
  DriveFileMeta,
  ValidationContext,
} from '../drive_knowledge';

const HOME = `# HOME

## Description

The house and the things in it.

## Map (Where to Look)

- [grill/](/Life/Home/grill/GRILL.md) — the grill.
- [drinkware/](/Life/Home/drinkware/DRINKWARE.md) — pint glasses.

## Related

- [Bill](/Life/People/Bill/BILL.md)
`;

describe('context_file_name', () => {
  it('upper-cases and hyphenates the folder name', () => {
    expect(context_file_name('Montana State University')).toBe('MONTANA-STATE-UNIVERSITY.md');
    expect(context_file_name('Home')).toBe('HOME.md');
    expect(context_file_name('_archive')).toBe('_ARCHIVE.md');
  });

  it('matches only the exact context file', () => {
    expect(is_context_file('HOME.md', 'Home')).toBe(true);
    expect(is_context_file('home.md', 'Home')).toBe(false);
    expect(is_context_file('2026-07-28-note.md', 'Home')).toBe(false);
  });
});

describe('parse_headings', () => {
  it('numbers headings in order with their levels', () => {
    expect(parse_headings(HOME).map(h => [h.index, h.level, h.text])).toEqual([
      [0, 1, 'HOME'],
      [1, 2, 'Description'],
      [2, 2, 'Map (Where to Look)'],
      [3, 2, 'Related'],
    ]);
  });

  it('ignores # lines inside fenced code', () => {
    const md = '# Title\n\n```bash\n# not a heading\n```\n\n## Real';
    expect(parse_headings(md).map(h => h.text)).toEqual(['Title', 'Real']);
  });

  it('ignores a leading BOM and CRLF', () => {
    expect(parse_headings('﻿# A\r\n\r\n## B\r\n').map(h => h.text)).toEqual(['A', 'B']);
  });
});

describe('insert_at_heading', () => {
  it('joins a list item onto the end of the section list', () => {
    const out = insert_at_heading(HOME, 2, '- [lawn/](/Life/Home/lawn/LAWN.md) — the lawn.');
    expect(out).toContain('pint glasses.\n- [lawn/](/Life/Home/lawn/LAWN.md) — the lawn.\n\n## Related');
  });

  it('adds a paragraph after the section content with a blank line', () => {
    const out = insert_at_heading(HOME, 1, 'Bought in 2019.');
    expect(out).toContain('The house and the things in it.\n\nBought in 2019.\n\n## Map');
  });

  it('inserts into the last section and keeps the trailing newline', () => {
    const out = insert_at_heading(HOME, 3, '- [For-Sale](/Life/For-Sale/FOR-SALE.md)');
    expect(out.endsWith('- [Bill](/Life/People/Bill/BILL.md)\n- [For-Sale](/Life/For-Sale/FOR-SALE.md)\n')).toBe(true);
  });

  it('stops at a subsection rather than appending after it', () => {
    const md = '## Bikes\n\nIntro.\n\n### Trek\n\nTrek facts.\n';
    const out = insert_at_heading(md, 0, 'More intro.');
    expect(out).toBe('## Bikes\n\nIntro.\n\nMore intro.\n\n### Trek\n\nTrek facts.\n');
  });

  it('fills an empty section', () => {
    const md = '# A\n## Empty\n## Next\n';
    expect(insert_at_heading(md, 1, 'Now filled.')).toBe('# A\n## Empty\n\nNow filled.\n\n## Next\n');
  });

  it('joins a table row onto an existing table', () => {
    const md = '## Files\n\n| File | What |\n|---|---|\n| a.pdf | receipt |\n\n## Next\n';
    const out = insert_at_heading(md, 0, '| b.pdf | warranty |');
    expect(out).toContain('| a.pdf | receipt |\n| b.pdf | warranty |\n\n## Next');
  });

  it('appends a new section at the end for null', () => {
    const out = insert_at_heading(HOME, null, '## Lawn\n\nMowed weekly.');
    expect(out.endsWith('- [Bill](/Life/People/Bill/BILL.md)\n\n## Lawn\n\nMowed weekly.\n')).toBe(true);
  });

  it('preserves CRLF line endings', () => {
    const md = '# A\r\n\r\n## B\r\n\r\nText.\r\n';
    expect(insert_at_heading(md, 1, 'More.')).toBe('# A\r\n\r\n## B\r\n\r\nText.\r\n\r\nMore.\r\n');
  });

  it('preserves a leading BOM', () => {
    const out = insert_at_heading('﻿# A\n\nText.\n', 0, 'More.');
    expect(out).toBe('﻿# A\n\nText.\n\nMore.\n');
  });

  it('leaves everything outside the insertion untouched', () => {
    const out = insert_at_heading(HOME, 2, '- new item');
    expect(out.replace('- new item\n', '')).toBe(HOME);
  });

  it('throws for a heading that does not exist', () => {
    expect(() => insert_at_heading(HOME, 9, 'x')).toThrow();
  });
});

describe('strip_session_log', () => {
  it('drops everything from the Session Log heading on', () => {
    const md = '# My Drive\n\n## Rules\n\nBe brief.\n\n## Session Log\n\n### 2026-05-27\n- stuff';
    expect(strip_session_log(md)).toBe('# My Drive\n\n## Rules\n\nBe brief.');
  });

  it('matches the heading case-insensitively', () => {
    expect(strip_session_log('Keep\n## session log\nDrop')).toBe('Keep');
  });

  it('falls back to the first 8,000 characters', () => {
    const md = 'x'.repeat(9000);
    expect(strip_session_log(md)).toHaveLength(8000);
  });
});

describe('dated names', () => {
  it('accepts YYYY-MM-DD-kebab.md', () => {
    expect(is_valid_dated_name('2026-07-28-tub-faucet-drip-heat-note.md')).toBe(true);
  });

  it('rejects other shapes', () => {
    expect(is_valid_dated_name('HOME.md')).toBe(false);
    expect(is_valid_dated_name('2026-07-28-Tub-Faucet.md')).toBe(false);
    expect(is_valid_dated_name('2026-07-28-tub faucet.md')).toBe(false);
    expect(is_valid_dated_name('2026-07-28-.md')).toBe(false);
    expect(is_valid_dated_name('../2026-07-28-x.md')).toBe(false);
  });

  it('uses the Montana date, not UTC', () => {
    // 03:00 UTC on Oct 2 is still Oct 1 in Montana.
    expect(today_local(new Date('2026-10-02T03:00:00Z'))).toBe('2026-10-01');
  });

  it('slugs a subject into a descriptor', () => {
    expect(to_descriptor("Bill's Tub Faucet: Drip & Heat!")).toBe('bills-tub-faucet-drip-heat');
  });
});

describe('Drive query quoting', () => {
  it('escapes quotes and backslashes in literals', () => {
    expect(drive_query_literal("O'Brien")).toBe("'O\\'Brien'");
    expect(drive_query_literal('a\\b')).toBe("'a\\\\b'");
  });

  it('keeps multi-word literals as-is (for name = ...)', () => {
    expect(drive_query_literal('My Bikes.md')).toBe("'My Bikes.md'");
  });

  it('turns multi-word full-text terms into a phrase', () => {
    expect(drive_fulltext_value('830 Cleveland')).toBe(`'"830 Cleveland"'`);
    expect(drive_fulltext_value("Bill's")).toBe("'Bill\\'s'");
  });
});

describe('validate_edit', () => {
  const home: DriveFileMeta = {
    id: 'home', name: 'HOME.md', mime_type: 'text/markdown', parent_id: 'home_dir',
    owned_by_me: true, trashed: false, shared: false, path: '/Life/Home/HOME.md',
  };
  const ctx = (overrides: Partial<DriveFileMeta> = {}): ValidationContext => ({
    files: new Map([['home', { ...home, ...overrides }]]),
    context_file_by_folder: new Map([['home_dir', 'home']]),
    names_in_folder: new Map([['home_dir', new Set(['HOME.md', '2026-07-28-note.md'])]]),
    contents: new Map([['home', HOME]]),
  });

  it('allows a plain insert into an owned context file', () => {
    expect(validate_edit({ kind: 'insert', file_id: 'home', heading_index: 2, text: '- item' }, ctx())).toBeNull();
  });

  it('rejects files that are not candidates', () => {
    expect(validate_edit({ kind: 'insert', file_id: 'other', heading_index: 0, text: 'x' }, ctx())).toMatch(/candidates/);
  });

  it('rejects files Bill does not own, trashed files and non-markdown', () => {
    const edit = { kind: 'insert' as const, file_id: 'home', heading_index: 1, text: 'x' };
    expect(validate_edit(edit, ctx({ owned_by_me: false }))).toMatch(/own/);
    expect(validate_edit(edit, ctx({ trashed: true }))).toMatch(/own/);
    expect(validate_edit(edit, ctx({ name: 'HOME.gdoc', mime_type: 'application/vnd.google-apps.document' }))).toMatch(/own/);
  });

  it('rejects a heading index that does not exist', () => {
    expect(validate_edit({ kind: 'insert', file_id: 'home', heading_index: 7, text: 'x' }, ctx())).toMatch(/does not exist/);
  });

  it('rejects added headings that would break the section', () => {
    expect(validate_edit({ kind: 'insert', file_id: 'home', heading_index: 2, text: '## Sneaky\n\nx' }, ctx())).toMatch(/structure/);
    expect(validate_edit({ kind: 'insert', file_id: 'home', heading_index: 2, text: '### Grill notes\n\nx' }, ctx())).toBeNull();
  });

  it('requires a new section to bring its own heading', () => {
    expect(validate_edit({ kind: 'insert', file_id: 'home', heading_index: null, text: 'no heading' }, ctx())).toMatch(/heading/);
    expect(validate_edit({ kind: 'insert', file_id: 'home', heading_index: null, text: '## Lawn\n\nx' }, ctx())).toBeNull();
  });

  it('allows creating a dated file beside a context file', () => {
    expect(validate_edit({ kind: 'create', folder_id: 'home_dir', name: '2026-10-01-lawn.md', content: '# Lawn' }, ctx())).toBeNull();
  });

  it('refuses new folders, bad names and duplicates', () => {
    expect(validate_edit({ kind: 'create', folder_id: 'nowhere', name: '2026-10-01-lawn.md', content: 'x' }, ctx())).toMatch(/context file/);
    expect(validate_edit({ kind: 'create', folder_id: 'home_dir', name: 'LAWN.md', content: 'x' }, ctx())).toMatch(/YYYY/);
    expect(validate_edit({ kind: 'create', folder_id: 'home_dir', name: '2026-07-28-note.md', content: 'x' }, ctx())).toMatch(/already exists/);
  });
});
