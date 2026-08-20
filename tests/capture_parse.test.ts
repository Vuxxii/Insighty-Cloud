import { describe, expect, it } from 'vitest';
import { parseCaptureText } from '../src/text/captureParse';
import { resolveDirection } from '../src/text/direction';

describe('inline // link command', () => {
  it('parses a bare URL line with no title and empty text', () => {
    expect(parseCaptureText('// https://example.com')).toEqual({
      text: '',
      links: [{ href: 'https://example.com' }],
    });
  });

  it('everything after the URL becomes the title', () => {
    expect(parseCaptureText('// https://example.com Q3 doc')).toEqual({
      text: '',
      links: [{ href: 'https://example.com', title: 'Q3 doc' }],
    });
  });

  it('defaults a missing scheme to https://', () => {
    expect(parseCaptureText('// example.com').links).toEqual([
      { href: 'https://example.com' },
    ]);
    // existing schemes are left alone
    expect(parseCaptureText('// http://plain.example').links).toEqual([
      { href: 'http://plain.example' },
    ]);
  });

  it('mixed captures keep text lines (order and internal newlines) and collect links in order', () => {
    const raw = [
      'first thought',
      '// https://a.example first link',
      '',
      'second thought',
      '// b.example',
    ].join('\n');
    expect(parseCaptureText(raw)).toEqual({
      text: 'first thought\n\nsecond thought',
      links: [
        { href: 'https://a.example', title: 'first link' },
        { href: 'https://b.example' },
      ],
    });
  });

  it('only line-anchored // triggers — URLs and // inside prose stay text', () => {
    const prose = 'see https://a.b//c for details';
    expect(parseCaptureText(prose)).toEqual({ text: prose, links: [] });
    const midline = 'this // is not a command';
    expect(parseCaptureText(midline)).toEqual({ text: midline, links: [] });
  });

  it('an indented // line is still a command', () => {
    expect(parseCaptureText('  // https://x.example').links).toEqual([
      { href: 'https://x.example' },
    ]);
  });

  it('// with nothing after it is not a link and stays in the text block', () => {
    expect(parseCaptureText('//')).toEqual({ text: '//', links: [] });
    expect(parseCaptureText('// ')).toEqual({ text: '//', links: [] });
  });

  it('handles no-space form //url', () => {
    expect(parseCaptureText('//https://x.example').links).toEqual([
      { href: 'https://x.example' },
    ]);
  });

  it('parse results carry no source when no @token is present', () => {
    expect(parseCaptureText('plain insight')).toEqual({ text: 'plain insight', links: [] });
  });

  it('Arabic text plus a // link keeps the Arabic text driving direction', () => {
    const parsed = parseCaptureText('مرحبا بالعالم\n// https://x.example مصدر');
    expect(parsed.text).toBe('مرحبا بالعالم');
    expect(parsed.links).toEqual([{ href: 'https://x.example', title: 'مصدر' }]);
    expect(resolveDirection(parsed.text)).toBe('rtl');
  });
});

describe('inline @source command', () => {
  it('an @token sets the source and is stripped from the text', () => {
    expect(parseCaptureText('@Q3Report margins are compressing')).toEqual({
      text: 'margins are compressing',
      links: [],
      source: 'Q3Report',
    });
  });

  it('works mid-sentence and at the end', () => {
    expect(parseCaptureText('key stat from @AnnualReport today')).toEqual({
      text: 'key stat from today',
      links: [],
      source: 'AnnualReport',
    });
    expect(parseCaptureText('final point @Memo')).toEqual({
      text: 'final point',
      links: [],
      source: 'Memo',
    });
  });

  it('the LAST @token wins and all tokens are stripped', () => {
    expect(parseCaptureText('@Old note one\nnote two @New')).toEqual({
      text: 'note one\nnote two',
      links: [],
      source: 'New',
    });
  });

  it('emails are never treated as source tokens', () => {
    const prose = 'contact hakamipro@gmail.com about this';
    expect(parseCaptureText(prose)).toEqual({ text: prose, links: [] });
  });

  it('a bare @ is not a token', () => {
    expect(parseCaptureText('rating is A @ best')).toEqual({
      text: 'rating is A @ best',
      links: [],
    });
  });

  it('trailing sentence punctuation is not part of the source name', () => {
    expect(parseCaptureText('see @Q3Report.')).toEqual({
      text: 'see',
      links: [],
      source: 'Q3Report',
    });
  });

  it('supports Arabic source names', () => {
    expect(parseCaptureText('ملاحظة @تقرير_الربع')).toEqual({
      text: 'ملاحظة',
      links: [],
      source: 'تقرير_الربع',
    });
  });

  it('combines with // link lines', () => {
    expect(parseCaptureText('insight text @Src\n// example.com the doc')).toEqual({
      text: 'insight text',
      links: [{ href: 'https://example.com', title: 'the doc' }],
      source: 'Src',
    });
  });

  it('an @token-only capture yields empty text and just the source', () => {
    expect(parseCaptureText('@JustPinning')).toEqual({
      text: '',
      links: [],
      source: 'JustPinning',
    });
  });
});
