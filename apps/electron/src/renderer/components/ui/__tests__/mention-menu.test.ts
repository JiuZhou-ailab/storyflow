/**
 * Tests for mention menu @ trigger detection
 *
 * The isValidMentionTrigger function determines when typing @ should open
 * the mention menu vs when it's part of an email address or other text.
 */

import { describe, it, expect, mock, beforeAll } from 'bun:test';

// mention-menu.tsx transitively imports pdfjs-dist via renderer component chain.
// Vite's ?url suffix isn't supported by bun — mock before dynamic import.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }));
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }));

let isValidMentionTrigger: (text: string, position: number) => boolean;
let parseInlineMentionQuery: typeof import('../mention-menu').parseInlineMentionQuery;
let filterMentionFileReferences: typeof import('../mention-menu').filterMentionFileReferences;
let getMentionInsertionText: typeof import('../mention-menu').getMentionInsertionText;

beforeAll(async () => {
  const mod = await import('../mention-menu');
  isValidMentionTrigger = mod.isValidMentionTrigger;
  parseInlineMentionQuery = mod.parseInlineMentionQuery;
  filterMentionFileReferences = mod.filterMentionFileReferences;
  getMentionInsertionText = mod.getMentionInsertionText;
});

describe('isValidMentionTrigger', () => {
  describe('valid triggers (should open menu)', () => {
    it('returns true when @ is at the start of input', () => {
      expect(isValidMentionTrigger('@', 0)).toBe(true);
      expect(isValidMentionTrigger('@skill', 0)).toBe(true);
    });

    it('returns true when @ is preceded by a space', () => {
      expect(isValidMentionTrigger('hello @', 6)).toBe(true);
      expect(isValidMentionTrigger('hello @skill', 6)).toBe(true);
      expect(isValidMentionTrigger('use @mention here', 4)).toBe(true);
    });

    it('returns true when @ is preceded by a tab', () => {
      expect(isValidMentionTrigger('hello\t@', 6)).toBe(true);
      expect(isValidMentionTrigger('\t@skill', 1)).toBe(true);
    });

    it('returns true when @ is preceded by a newline', () => {
      expect(isValidMentionTrigger('hello\n@', 6)).toBe(true);
      expect(isValidMentionTrigger('line1\nline2\n@skill', 12)).toBe(true);
    });

    it('returns true when @ is preceded by carriage return', () => {
      expect(isValidMentionTrigger('hello\r@', 6)).toBe(true);
      expect(isValidMentionTrigger('hello\r\n@', 7)).toBe(true);
    });

    it('returns true when @ is preceded by multiple whitespace chars', () => {
      expect(isValidMentionTrigger('hello   @', 8)).toBe(true);
      expect(isValidMentionTrigger('hello\n\n@', 7)).toBe(true);
    });

    it('returns true when @ is preceded by opening parenthesis', () => {
      expect(isValidMentionTrigger('(@', 1)).toBe(true);
      expect(isValidMentionTrigger('use (@skill)', 5)).toBe(true);
      expect(isValidMentionTrigger('call(@mention', 5)).toBe(true);
    });

    it('returns true when @ is preceded by double quote', () => {
      expect(isValidMentionTrigger('"@', 1)).toBe(true);
      expect(isValidMentionTrigger('say "@skill"', 5)).toBe(true);
    });

    it('returns true when @ is preceded by single quote', () => {
      expect(isValidMentionTrigger("'@", 1)).toBe(true);
      expect(isValidMentionTrigger("use '@skill'", 5)).toBe(true);
    });
  });

  describe('invalid triggers (should NOT open menu)', () => {
    it('returns false for email addresses', () => {
      // test@example.com - @ at position 4
      expect(isValidMentionTrigger('test@', 4)).toBe(false);
      expect(isValidMentionTrigger('test@example', 4)).toBe(false);
      expect(isValidMentionTrigger('user@domain.com', 4)).toBe(false);
    });

    it('returns false when @ is preceded by letters', () => {
      expect(isValidMentionTrigger('hello@', 5)).toBe(false);
      expect(isValidMentionTrigger('contact@support', 7)).toBe(false);
    });

    it('returns false when @ is preceded by numbers', () => {
      expect(isValidMentionTrigger('user123@', 7)).toBe(false);
      expect(isValidMentionTrigger('99@bottles', 2)).toBe(false);
    });

    it('returns false when @ is preceded by other punctuation (not quotes/parens)', () => {
      expect(isValidMentionTrigger('hello.@', 6)).toBe(false);
      expect(isValidMentionTrigger('test-@user', 5)).toBe(false);
      expect(isValidMentionTrigger('foo_@bar', 4)).toBe(false);
      expect(isValidMentionTrigger('end)@start', 4)).toBe(false); // closing paren is not allowed
    });

    it('returns false for negative position', () => {
      expect(isValidMentionTrigger('test', -1)).toBe(false);
      expect(isValidMentionTrigger('@test', -1)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles empty string', () => {
      expect(isValidMentionTrigger('', 0)).toBe(true); // @ would be at start
      expect(isValidMentionTrigger('', -1)).toBe(false);
    });

    it('handles unicode whitespace', () => {
      // Non-breaking space (U+00A0) - treated as whitespace by \s
      expect(isValidMentionTrigger('hello\u00A0@', 6)).toBe(true);
    });

    it('handles position at end of string', () => {
      const text = 'hello ';
      expect(isValidMentionTrigger(text, text.length)).toBe(true); // space before
    });

    it('handles multiple @ symbols - checks specific position', () => {
      // "user@test @skill" - first @ is invalid (after 'r'), second is valid (after space)
      expect(isValidMentionTrigger('user@test @', 4)).toBe(false);  // first @
      expect(isValidMentionTrigger('user@test @', 10)).toBe(true); // second @
    });
  });
});

describe('parseInlineMentionQuery', () => {
  it('keeps Chinese query text after @ so chapter titles can be suggested', () => {
    expect(parseInlineMentionQuery('@第')).toEqual({ start: 0, filter: '第' })
    expect(parseInlineMentionQuery('改写 @第4章')).toEqual({ start: 3, filter: '第4章' })
  })

  it('still rejects email-like @ usage', () => {
    expect(parseInlineMentionQuery('user@test')).toBeNull()
  })
})

describe('writing file mention references', () => {
  it('matches files by display label while preserving the relative path as mention payload', () => {
    const [item] = filterMentionFileReferences([
      {
        path: '/novel/正文/第4章-零点一秒的生死线.md',
        relativePath: '正文/第4章-零点一秒的生死线.md',
        label: '第4章 零点一秒的生死线',
        type: 'file',
      },
    ], '零点')

    expect(item?.label).toBe('第4章 零点一秒的生死线')
    expect(item?.file?.relativePath).toBe('正文/第4章-零点一秒的生死线.md')
    expect(getMentionInsertionText(item!)).toBe('[file:' + '正文/第4章-零点一秒的生死线.md' + '] ')
  })
})
