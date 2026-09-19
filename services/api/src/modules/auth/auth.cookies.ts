export const sessionCookieName = 'yaskapp_session';

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) return {};

  return Object.fromEntries(
    header.split(';').flatMap((part) => {
      const separator = part.indexOf('=');
      if (separator < 0) return [];

      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      if (!name) return [];

      try {
        return [[name, decodeURIComponent(value)]];
      } catch {
        return [[name, value]];
      }
    })
  );
}

export function serializeSessionCookie(value: string | null, secure: boolean): string {
  const encoded = value === null ? '' : encodeURIComponent(value);
  return [
    `${sessionCookieName}=${encoded}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + (value === null ? '0' : '604800'),
    ...(secure ? ['Secure'] : [])
  ].join('; ');
}

export function isTrustedOrigin(origin: string | undefined, configuredOrigins: string): boolean {
  if (!origin) return true;

  const origins = configuredOrigins.split(',').map((item) => item.trim()).filter(Boolean);
  if (origins.includes(origin)) return true;

  if (configuredOrigins === '*') {
    return origin === 'http://localhost:5173' || origin === 'http://127.0.0.1:5173';
  }

  return false;
}
