export class AdminCursorError extends Error {}

export type AdminCursor = {
  createdAt: string;
  id: string;
};

export function encodeAdminCursor(cursor: AdminCursor) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

export function decodeAdminCursor(value: string): AdminCursor {
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<AdminCursor>;
    if (!decoded || typeof decoded.createdAt !== 'string' || typeof decoded.id !== 'string' || !uuidPattern.test(decoded.id)) {
      throw new Error('Invalid cursor.');
    }
    if (!isoTimestampPattern.test(decoded.createdAt) || Number.isNaN(Date.parse(decoded.createdAt))) {
      throw new Error('Invalid cursor.');
    }
    return { createdAt: decoded.createdAt, id: decoded.id };
  } catch {
    throw new AdminCursorError('The pagination cursor is invalid.');
  }
}

export function pageWithCursor<T extends { createdAt: string; id: string }>(rows: T[], limit: number) {
  const hasNextPage = rows.length > limit;
  const items = hasNextPage ? rows.slice(0, limit) : rows;
  return {
    items,
    nextCursor: hasNextPage && items.length > 0
      ? encodeAdminCursor({ createdAt: items[items.length - 1].createdAt, id: items[items.length - 1].id })
      : null
  };
}
