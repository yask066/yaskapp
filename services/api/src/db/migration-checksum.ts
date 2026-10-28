import { createHash } from 'node:crypto';

function normalizeLineEndings(sql: string): string {
  return sql.replace(/\r\n?/g, '\n');
}

function sha256(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

export function calculateMigrationChecksum(sql: string): string {
  return sha256(normalizeLineEndings(sql));
}

export function matchesMigrationChecksum(sql: string, checksum: string): boolean {
  const normalizedSql = normalizeLineEndings(sql);
  const windowsSql = normalizedSql.replace(/\n/g, '\r\n');
  return new Set([sql, normalizedSql, windowsSql].map(sha256)).has(checksum);
}
