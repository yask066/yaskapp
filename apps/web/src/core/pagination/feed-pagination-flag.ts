export function isFeedPaginationEnabled(): boolean {
  return import.meta.env.VITE_FEED_PAGINATION === 'true';
}
