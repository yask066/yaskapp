import { apiClient } from './client';
import { decodeSearchPage, type SearchPage } from './models';

export function search(input: { q: string; type: 'all' | 'polls' | 'users'; sort: 'relevance' | 'newest' | 'popular' }): Promise<SearchPage> {
  const params = new URLSearchParams({ ...input, limit: '20' });
  return apiClient.get(`/search?${params}`, decodeSearchPage);
}
