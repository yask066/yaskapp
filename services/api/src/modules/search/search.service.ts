import {
  decodeSearchCursor,
  encodeSearchCursor,
  searchPollRecords,
  searchUserRecords
} from './search.repository.js';
import type {
  SearchInput,
  SearchPage,
  SearchPollRecord,
  SearchResult,
  SearchSort,
  SearchType,
  SearchUserRecord
} from './search.types.js';

export class SearchValidationError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'SearchValidationError';
  }
}

export type SearchRepositories = {
  searchPollRecords: (input: SearchInput) => Promise<SearchPollRecord[]>;
  searchUserRecords: (input: SearchInput) => Promise<SearchUserRecord[]>;
};

const defaultRepositories: SearchRepositories = {
  searchPollRecords,
  searchUserRecords
};

export function normalizeSearchQuery(query: string) {
  const normalized = query.trim().replace(/\s+/g, ' ');

  if (normalized.length < 2 || normalized.length > 100) {
    throw new SearchValidationError('Search query must be between 2 and 100 characters.');
  }

  return normalized;
}

function sortResults(items: SearchResult[], sort: SearchSort) {
  return items.sort((left, right) => {
    if (sort !== 'newest' && right.score !== left.score) {
      return right.score - left.score;
    }

    const leftDate = left.type === 'poll' ? left.poll.createdAt : left.user.createdAt;
    const rightDate = right.type === 'poll' ? right.poll.createdAt : right.user.createdAt;
    const dateOrder = rightDate.localeCompare(leftDate);
    if (dateOrder !== 0) return dateOrder;

    const leftId = left.type === 'poll' ? left.poll.id : left.user.id;
    const rightId = right.type === 'poll' ? right.poll.id : right.user.id;
    return rightId.localeCompare(leftId);
  });
}

function toCursor(item: SearchResult, sort: SearchSort) {
  return {
    ...(sort === 'newest' ? {} : { score: item.score }),
    createdAt: item.type === 'poll' ? item.poll.createdAt : item.user.createdAt,
    id: item.type === 'poll' ? item.poll.id : item.user.id
  };
}

export async function searchWithRepositories(input: {
  viewerId: string;
  query: string;
  type?: SearchType;
  sort?: SearchSort;
  cursor?: string;
  limit?: number;
  repositories?: SearchRepositories;
}): Promise<SearchPage> {
  const query = normalizeSearchQuery(input.query);
  const type = input.type ?? 'all';
  const sort = input.sort ?? 'relevance';
  const limit = input.limit ?? 20;

  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new SearchValidationError('Search limit must be between 1 and 50.');
  }

  let cursor;
  if (input.cursor) {
    try {
      cursor = decodeSearchCursor(input.cursor);
    } catch {
      throw new SearchValidationError('Search cursor is invalid.');
    }
  }

  const repositoryInput: SearchInput = {
    viewerId: input.viewerId,
    query,
    type,
    sort,
    cursor,
    limit
  };
  const repository = input.repositories ?? defaultRepositories;
  const records: SearchResult[] = [];

  if (type === 'all' || type === 'polls') {
    const polls = await repository.searchPollRecords(repositoryInput);
    records.push(...polls.map((record) => ({ type: 'poll' as const, ...record })));
  }

  if (type === 'all' || type === 'users') {
    const users = await repository.searchUserRecords(repositoryInput);
    records.push(...users.map((record) => ({ type: 'user' as const, ...record })));
  }

  const sorted = sortResults(records, sort);
  const hasNextPage = sorted.length > limit;
  const items = sorted.slice(0, limit);

  return {
    items,
    nextCursor: hasNextPage && items[items.length - 1]
      ? encodeSearchCursor(toCursor(items[items.length - 1], sort))
      : null
  };
}

export function parseSearchCursor(value: string | undefined) {
  if (value === undefined) return undefined;

  try {
    return decodeSearchCursor(value);
  } catch {
    throw new SearchValidationError('Search cursor is invalid.');
  }
}

export async function search(input: Omit<Parameters<typeof searchWithRepositories>[0], 'repositories'>) {
  return searchWithRepositories(input);
}
