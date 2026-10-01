import {
  isHtmlErrorResponse,
  isRewritableContentType,
  resolveTargetUrl,
  rewriteHostInHeaderValue,
  rewriteHostInText,
} from './proxy.utils';

describe('resolveTargetUrl', () => {
  it('prefixes https when only a host is provided', () => {
    expect(resolveTargetUrl('cash.com')).toBe('https://cash.com');
  });

  it('keeps an explicit http(s) URL', () => {
    expect(resolveTargetUrl('https://cash.com')).toBe('https://cash.com');
    expect(resolveTargetUrl('http://cash.com:8080')).toBe(
      'http://cash.com:8080',
    );
  });

  it('strips a trailing slash', () => {
    expect(resolveTargetUrl('https://cash.com/')).toBe('https://cash.com');
  });

  it('throws when TARGET_HOST is empty', () => {
    expect(() => resolveTargetUrl(undefined)).toThrow('TARGET_HOST is not set');
    expect(() => resolveTargetUrl('  ')).toThrow('TARGET_HOST is not set');
  });
});

describe('rewriteHostInText', () => {
  it('replaces the proxy host with the target host', () => {
    expect(
      rewriteHostInText(
        'https://proc.com/v1/deposit/rub',
        'proc.com',
        'cash.com',
      ),
    ).toBe('https://cash.com/v1/deposit/rub');
  });

  it('does not rewrite a longer hostname that only contains the same suffix', () => {
    expect(
      rewriteHostInText('https://notproc.com/callback', 'proc.com', 'cash.com'),
    ).toBe('https://notproc.com/callback');
  });

  it('is case-insensitive', () => {
    expect(
      rewriteHostInText('https://PROC.com/pay', 'proc.com', 'cash.com'),
    ).toBe('https://cash.com/pay');
  });
});

describe('rewriteHostInHeaderValue', () => {
  it('rewrites each value in a header array', () => {
    expect(
      rewriteHostInHeaderValue(
        ['https://proc.com/a', 'https://proc.com/b'],
        'proc.com',
        'cash.com',
      ),
    ).toEqual(['https://cash.com/a', 'https://cash.com/b']);
  });
});

describe('isRewritableContentType', () => {
  it('rewrites json and text responses', () => {
    expect(isRewritableContentType('application/json; charset=utf-8')).toBe(
      true,
    );
    expect(isRewritableContentType('text/html')).toBe(true);
  });

  it('leaves binary responses untouched', () => {
    expect(isRewritableContentType('application/octet-stream')).toBe(false);
    expect(isRewritableContentType('image/png')).toBe(false);
  });
});

describe('isHtmlErrorResponse', () => {
  it('detects html error pages', () => {
    expect(isHtmlErrorResponse(400, 'text/html; charset=utf-8')).toBe(true);
    expect(isHtmlErrorResponse(502, 'application/xhtml+xml')).toBe(true);
  });

  it('keeps successful html and non-html errors', () => {
    expect(isHtmlErrorResponse(200, 'text/html')).toBe(false);
    expect(isHtmlErrorResponse(400, 'application/json')).toBe(false);
    expect(isHtmlErrorResponse(500, undefined)).toBe(false);
  });
});
