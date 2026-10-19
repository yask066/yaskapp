import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '../../config/env.js';

export type PollCursorKind =
  | 'polls'
  | 'subscriptions'
  | 'comment-roots'
  | 'comment-replies';
export type PollCursorSort = 'newest' | 'popular';
export type PollCursorOrder = 'newest' | 'oldest';
export type PollCursorTuple = Readonly<{ createdAt: string; id: string }>;

type PollCursorChronologicalContext =
  | Readonly<{ kind: 'polls'; sort: 'newest'; owner?: string }>
  | Readonly<{ kind: 'subscriptions'; sort: 'newest'; owner: string }>
  | Readonly<{ kind: 'comment-roots'; order: PollCursorOrder; pollId: string; owner?: string }>
  | Readonly<{ kind: 'comment-replies'; order: 'oldest'; pollId: string; rootId: string; owner?: string }>;

type PollCursorPopularContext = Readonly<{ kind: 'polls'; sort: 'popular'; owner: string }>;

export type PollCursorContext = PollCursorChronologicalContext | PollCursorPopularContext;
type NormalizedPollCursorScope = Readonly<{
  kind: PollCursorKind;
  sort?: PollCursorSort;
  order?: PollCursorOrder;
  pollId?: string;
  rootId?: string;
  owner?: string;
}>;

type PollCursorChronologicalPayload = PollCursorChronologicalContext & Readonly<{
  boundary: PollCursorTuple;
  highWatermark: PollCursorTuple;
}>;

type PollCursorSnapshotPayload = PollCursorPopularContext & Readonly<{
  snapshotId: string;
  position: number;
}>;

export type PollCursorPayload = PollCursorChronologicalPayload | PollCursorSnapshotPayload;
export type PollCursorOwnerIdentity =
  | Readonly<{ type: 'user'; userId: string }>
  | Readonly<{ type: 'guest'; ip: string }>;

export class PollPaginationCursorError extends Error {
  readonly code = 'pagination_cursor_invalid';
  readonly statusCode = 400;

  constructor() {
    super('The pagination cursor is invalid.');
    this.name = 'PollPaginationCursorError';
  }
}

type CursorWirePayload = {
  v: 1;
  kind: PollCursorKind;
  sort: PollCursorSort | null;
  order: PollCursorOrder | null;
  pollId: string | null;
  rootId: string | null;
  owner: string | null;
  boundary: PollCursorTuple | null;
  highWatermark: PollCursorTuple | null;
  snapshotId: string | null;
  position: number | null;
};

const wirePayloadKeys = [
  'v', 'kind', 'sort', 'order', 'pollId', 'rootId', 'owner',
  'boundary', 'highWatermark', 'snapshotId', 'position'
] as const;
const cursorKinds = new Set<PollCursorKind>(['polls', 'subscriptions', 'comment-roots', 'comment-replies']);
const cursorSorts = new Set<PollCursorSort>(['newest', 'popular']);
const cursorOrders = new Set<PollCursorOrder>(['newest', 'oldest']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ownerKeyPattern = /^[A-Za-z0-9_-]{43}$/;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;
const timestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/;
const cursorPrefix = 'c1';
const maximumCursorLength = 2048;
const maximumPayloadLength = 1536;
const signatureLength = 32;

export function createPollCursorOwnerKey(identity: PollCursorOwnerIdentity): string {
  const identityValue = identity.type === 'user'
    ? `user:${identity.userId}`
    : identity.type === 'guest'
      ? `guest:${identity.ip}`
      : '';

  if (!identityValue || identityValue.endsWith(':') || identityValue.length > 512) {
    throw invalidCursor();
  }

  return createHmac('sha256', env.PAGINATION_CURSOR_SECRET)
    .update('yaskapp:poll-cursor-owner:v1\0', 'utf8')
    .update(identityValue, 'utf8')
    .digest('base64url');
}

export function encodePollCursor(payload: PollCursorPayload): string {
  try {
    const wirePayload = toWirePayload(payload);
    const encodedPayload = Buffer.from(JSON.stringify(wirePayload), 'utf8').toString('base64url');
    const unsignedCursor = `${cursorPrefix}.${encodedPayload}`;
    const signature = createHmac('sha256', env.PAGINATION_CURSOR_SECRET)
      .update(unsignedCursor, 'ascii')
      .digest('base64url');

    return `${unsignedCursor}.${signature}`;
  } catch (error) {
    if (error instanceof PollPaginationCursorError) throw error;
    throw invalidCursor();
  }
}

export function decodePollCursor(raw: string, expected: PollCursorContext): PollCursorPayload {
  try {
    if (typeof raw !== 'string' || raw.length > maximumCursorLength) throw invalidCursor();

    const parts = raw.split('.');
    if (parts.length !== 3 || parts[0] !== cursorPrefix) throw invalidCursor();

    const encodedPayload = parts[1]!;
    const encodedSignature = parts[2]!;
    const payloadBytes = decodeBase64Url(encodedPayload);
    const signatureBytes = decodeBase64Url(encodedSignature);

    if (payloadBytes.length === 0 || payloadBytes.length > maximumPayloadLength || signatureBytes.length !== signatureLength) {
      throw invalidCursor();
    }

    const unsignedCursor = `${cursorPrefix}.${encodedPayload}`;
    const expectedSignature = createHmac('sha256', env.PAGINATION_CURSOR_SECRET)
      .update(unsignedCursor, 'ascii')
      .digest();
    if (!timingSafeEqual(signatureBytes, expectedSignature)) throw invalidCursor();

    const payloadText = payloadBytes.toString('utf8');
    if (!Buffer.from(payloadText, 'utf8').equals(payloadBytes)) throw invalidCursor();

    const parsedPayload: unknown = JSON.parse(payloadText);
    const payload = fromWirePayload(parsedPayload);
    if (JSON.stringify(toWirePayload(payload)) !== payloadText) throw invalidCursor();

    const payloadScope = normalizeScope(payload);
    const expectedScope = normalizeScope(expected);
    if (!sameScope(payloadScope, expectedScope)) throw invalidCursor();

    return payload;
  } catch (error) {
    if (error instanceof PollPaginationCursorError) throw error;
    throw invalidCursor();
  }
}

function toWirePayload(payload: unknown): CursorWirePayload {
  if (!isRecord(payload)) throw invalidCursor();

  const allowedKeys = new Set([
    'kind', 'sort', 'order', 'pollId', 'rootId', 'owner',
    'boundary', 'highWatermark', 'snapshotId', 'position'
  ]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) throw invalidCursor();

  const scope = normalizeScope(payload);
  const hasBoundary = payload.boundary !== undefined;
  const hasHighWatermark = payload.highWatermark !== undefined;
  const hasSnapshotId = payload.snapshotId !== undefined;
  const hasPosition = payload.position !== undefined;

  if (hasBoundary !== hasHighWatermark || hasSnapshotId !== hasPosition || hasBoundary === hasSnapshotId) {
    throw invalidCursor();
  }

  const boundary = hasBoundary ? normalizeTuple(payload.boundary) : null;
  const highWatermark = hasHighWatermark ? normalizeTuple(payload.highWatermark) : null;
  const snapshotId = hasSnapshotId ? normalizeUuid(payload.snapshotId) : null;
  const position = hasPosition ? normalizePosition(payload.position) : null;

  if (snapshotId !== null && (scope.kind !== 'polls' || scope.sort !== 'popular' || scope.owner === undefined)) {
    throw invalidCursor();
  }
  if (scope.kind === 'polls' && scope.sort === 'popular' && snapshotId === null) throw invalidCursor();

  return {
    v: 1,
    kind: scope.kind,
    sort: scope.sort ?? null,
    order: scope.order ?? null,
    pollId: scope.pollId ?? null,
    rootId: scope.rootId ?? null,
    owner: scope.owner ?? null,
    boundary,
    highWatermark,
    snapshotId,
    position
  };
}

function fromWirePayload(value: unknown): PollCursorPayload {
  if (!isRecord(value) || Object.keys(value).length !== wirePayloadKeys.length) throw invalidCursor();
  if (wirePayloadKeys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) throw invalidCursor();
  if (value.v !== 1) throw invalidCursor();

  const scope = normalizeScope({
    kind: value.kind,
    sort: value.sort === null ? undefined : value.sort,
    order: value.order === null ? undefined : value.order,
    pollId: value.pollId === null ? undefined : value.pollId,
    rootId: value.rootId === null ? undefined : value.rootId,
    owner: value.owner === null ? undefined : value.owner
  });

  const hasBoundary = value.boundary !== null;
  const hasHighWatermark = value.highWatermark !== null;
  const hasSnapshotId = value.snapshotId !== null;
  const hasPosition = value.position !== null;
  if (hasBoundary !== hasHighWatermark || hasSnapshotId !== hasPosition || hasBoundary === hasSnapshotId) {
    throw invalidCursor();
  }

  if (hasBoundary) {
    const payload = {
      ...scope,
      boundary: normalizeTuple(value.boundary),
      highWatermark: normalizeTuple(value.highWatermark)
    } as PollCursorChronologicalPayload;
    return payload;
  }

  const payload = {
    ...scope,
    snapshotId: normalizeUuid(value.snapshotId),
    position: normalizePosition(value.position)
  } as PollCursorSnapshotPayload;
  if (payload.kind !== 'polls' || payload.sort !== 'popular' || payload.owner === undefined) throw invalidCursor();
  return payload;
}

function normalizeScope(value: unknown): NormalizedPollCursorScope {
  if (!isRecord(value) || !cursorKinds.has(value.kind as PollCursorKind)) throw invalidCursor();

  const sort = value.sort === undefined ? undefined : value.sort;
  const order = value.order === undefined ? undefined : value.order;
  const pollId = value.pollId === undefined ? undefined : normalizeUuid(value.pollId);
  const rootId = value.rootId === undefined ? undefined : normalizeUuid(value.rootId);
  const owner = value.owner === undefined ? undefined : normalizeOwnerKey(value.owner);

  if (sort !== undefined && !cursorSorts.has(sort as PollCursorSort)) throw invalidCursor();
  if (order !== undefined && !cursorOrders.has(order as PollCursorOrder)) throw invalidCursor();

  switch (value.kind as PollCursorKind) {
    case 'polls':
      if (order !== undefined || pollId !== undefined || rootId !== undefined) throw invalidCursor();
      if (sort === 'newest') return { kind: 'polls', sort, ...(owner === undefined ? {} : { owner }) };
      if (sort === 'popular' && owner !== undefined) return { kind: 'polls', sort, owner };
      throw invalidCursor();
    case 'subscriptions':
      if (sort !== 'newest' || order !== undefined || pollId !== undefined || rootId !== undefined || owner === undefined) {
        throw invalidCursor();
      }
      return { kind: 'subscriptions', sort, owner };
    case 'comment-roots':
      if (sort !== undefined || order === undefined || pollId === undefined || rootId !== undefined) throw invalidCursor();
      return { kind: 'comment-roots', order: order as PollCursorOrder, pollId, ...(owner === undefined ? {} : { owner }) };
    case 'comment-replies':
      if (sort !== undefined || order !== 'oldest' || pollId === undefined || rootId === undefined) throw invalidCursor();
      return { kind: 'comment-replies', order, pollId, rootId, ...(owner === undefined ? {} : { owner }) };
  }
}
function normalizeTuple(value: unknown): PollCursorTuple {
  if (!isRecord(value) || Object.keys(value).length !== 2 || !('createdAt' in value) || !('id' in value)) {
    throw invalidCursor();
  }

  if (typeof value.createdAt !== 'string' || !isPostgresTimestamp(value.createdAt)) throw invalidCursor();
  return { createdAt: value.createdAt, id: normalizeUuid(value.id) };
}

function normalizeUuid(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw invalidCursor();
  return value.toLowerCase();
}

function normalizeOwnerKey(value: unknown): string {
  if (typeof value !== 'string' || !ownerKeyPattern.test(value)) throw invalidCursor();
  return value;
}

function normalizePosition(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw invalidCursor();
  return value;
}

function isPostgresTimestamp(value: string): boolean {
  const match = timestampPattern.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const daysInMonth = month === 2
    ? (isLeapYear(year) ? 29 : 28)
    : [4, 6, 9, 11].includes(month) ? 30 : 31;

  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth &&
    hour <= 23 && minute <= 59 && second <= 59;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function decodeBase64Url(value: string): Buffer {
  if (!base64UrlPattern.test(value) || value.length % 4 === 1) throw invalidCursor();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) throw invalidCursor();
  return bytes;
}

function sameScope(payload: NormalizedPollCursorScope, expected: NormalizedPollCursorScope): boolean {
  return payload.kind === expected.kind &&
    (payload.sort ?? null) === (expected.sort ?? null) &&
    (payload.order ?? null) === (expected.order ?? null) &&
    (payload.pollId ?? null) === (expected.pollId ?? null) &&
    (payload.rootId ?? null) === (expected.rootId ?? null) &&
    (payload.owner ?? null) === (expected.owner ?? null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidCursor(): PollPaginationCursorError {
  return new PollPaginationCursorError();
}
