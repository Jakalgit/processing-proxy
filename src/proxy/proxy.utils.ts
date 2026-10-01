export function resolveTargetUrl(targetHost: string | undefined): string {
  if (!targetHost?.trim()) {
    throw new Error('TARGET_HOST is not set');
  }

  const trimmed = targetHost.trim().replace(/\/+$/, '');

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function rewriteHostInText(
  value: string,
  fromHost: string,
  toHost: string,
): string {
  if (!fromHost || !value || fromHost.toLowerCase() === toHost.toLowerCase()) {
    return value;
  }

  const pattern = new RegExp(
    `(?<![A-Za-z0-9.-])${escapeRegExp(fromHost)}(?![A-Za-z0-9.-])`,
    'gi',
  );

  return value.replace(pattern, toHost);
}

export function rewriteHostInHeaderValue(
  value: string | number | string[] | undefined,
  fromHost: string,
  toHost: string,
): string | number | string[] | undefined {
  if (value === undefined || typeof value === 'number') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => rewriteHostInText(item, fromHost, toHost));
  }

  return rewriteHostInText(value, fromHost, toHost);
}

export function isRewritableContentType(
  contentType: string | undefined,
): boolean {
  if (!contentType) {
    return false;
  }

  const type = contentType.split(';')[0].trim().toLowerCase();

  return (
    type.startsWith('text/') ||
    type.endsWith('+json') ||
    type.endsWith('+xml') ||
    type === 'application/json' ||
    type === 'application/xml' ||
    type === 'application/javascript' ||
    type === 'application/x-www-form-urlencoded'
  );
}

export function isHtmlContentType(contentType: string | undefined): boolean {
  if (!contentType) {
    return false;
  }

  const type = contentType.split(';')[0].trim().toLowerCase();
  return type === 'text/html' || type === 'application/xhtml+xml';
}
