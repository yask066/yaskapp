import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigationType, useSearchParams } from 'react-router-dom';
import { search } from '../../api/search';
import { PollCard } from '../../components/PollCard';
import { Avatar } from '../../components/Avatar';
import { AsyncState } from '../../components/AsyncState';
import { useSession } from '../../app/session-provider';
import { fetchPollQuery } from '../polls/poll-state';
import { useListScrollState } from '../../core/scroll/useListScrollState';
type SearchType = 'all' | 'polls' | 'users'; type SearchSort = 'relevance' | 'newest' | 'popular';
export function SearchPage() {
  const { user, status, sessionEpoch } = useSession();
  const navigationType = useNavigationType();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '');
  const [type, setType] = useState<SearchType>(() => searchParams.get('type') === 'polls' || searchParams.get('type') === 'users' ? searchParams.get('type') as SearchType : 'all');
  const [sort, setSort] = useState<SearchSort>(() => searchParams.get('sort') === 'newest' || searchParams.get('sort') === 'popular' ? searchParams.get('sort') as SearchSort : 'relevance');
  const submittedQ = searchParams.get('q')?.trim() || '';
  const submittedType = searchParams.get('type') === 'polls' || searchParams.get('type') === 'users' ? searchParams.get('type') as SearchType : 'all';
  const submittedSort = searchParams.get('sort') === 'newest' || searchParams.get('sort') === 'popular' ? searchParams.get('sort') as SearchSort : 'relevance';
  const submitted = submittedQ.length >= 2 ? { q: submittedQ, type: submittedType, sort: submittedSort } : null;
  const searchQuery = useQuery({
    queryKey: ['search', sessionEpoch, submitted],
    queryFn: ({ signal }) => fetchPollQuery(queryClient, user?.id ?? null, () => search(submitted!, signal), false, signal),
    enabled: submitted !== null && status !== 'loading',
    retry: false,
  });
  const resultIds = searchQuery.data?.items.map((item) => item.type === 'poll' ? `poll:${item.poll.id}` : `user:${item.user.id}`) ?? [];
  const searchScroll = useListScrollState(
    { userId: user?.id ?? null, route: '/search', list: 'search-results', query: submitted?.q ?? '', filter: submitted?.type ?? type, sort: submitted?.sort ?? sort },
    { itemIds: resultIds, restoreFocusOnPop: navigationType === 'POP' },
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (query.trim().length < 2) return;
    if (submitted?.q === query.trim() && submitted.type === type && submitted.sort === sort) void searchQuery.refetch();
    else setSearchParams({ q: query.trim(), type, sort }, { replace: true });
  };

  return (
    <main id="main-content" className="search-page">
      <header className="page-heading"><div><p className="eyebrow">Explore</p><h1>Search</h1></div></header>
      <form className="search-panel" role="search" onSubmit={submit}>
        <label>Search<input value={query} onChange={(event) => { setQuery(event.target.value); if (submitted) setSearchParams({}, { replace: true }); }} minLength={2} required /></label>
        <label>Result type<select value={type} onChange={(event) => { setType(event.target.value as SearchType); if (submitted) setSearchParams({}, { replace: true }); }}><option value="all">All</option><option value="polls">Polls</option><option value="users">Users</option></select></label>
        <label>Sort<select value={sort} onChange={(event) => { setSort(event.target.value as SearchSort); if (submitted) setSearchParams({}, { replace: true }); }}><option value="relevance">Relevance</option><option value="newest">Newest</option><option value="popular">Popular</option></select></label>
        <div className="search-actions"><button className="button button--primary" type="submit" disabled={searchQuery.isFetching || query.trim().length < 2 || status === 'loading'}>Search</button></div>
      </form>
      <div className="segmented-tabs" role="tablist" aria-label="Search result type">
        {(['all', 'polls', 'users'] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={type === value} aria-pressed={type === value} onClick={() => { if (value !== type) { setType(value); if (submitted) setSearchParams({}, { replace: true }); } }}>{value === 'all' ? 'All' : value === 'polls' ? 'Polls' : 'Users'}</button>)}
      </div>
      {searchQuery.isFetching && !searchQuery.data ? <AsyncState state="loading" kind={submittedType === 'users' ? 'user' : 'poll'} rows={2} /> : null}
      {searchQuery.isError && !searchQuery.data ? <AsyncState state="error" error={searchQuery.error} onRetry={() => void searchQuery.refetch()} /> : null}
      {searchQuery.data && searchQuery.data.items.length === 0 ? <AsyncState state="empty" emptyMessage="No matching results. Try a different search." /> : null}
      <div className="search-results" ref={searchScroll.listRef} aria-busy={searchQuery.isFetching}>
        <section className="feed-list" aria-label="Poll results">
          {searchQuery.data?.items.filter((item) => item.type === 'poll').map((item) => <PollCard key={`poll-${item.poll.id}`} poll={item.poll} viewerId={user?.id} />)}
        </section>
        <section className="people-results" aria-label="User results">
          {searchQuery.data?.items.filter((item) => item.type === 'user').map((item) => <article className="profile-result" data-list-item-id={`user:${item.user.id}`} key={`user-${item.user.id}`} tabIndex={-1}><Avatar name={item.user.profile.displayName || item.user.username} src={item.user.profile.avatarUrl} /><div><Link to={`/users/${item.user.id}`}>{item.user.profile.displayName || item.user.username}</Link><p>@{item.user.username}</p></div></article>)}
        </section>
      </div>
      {searchQuery.isError && searchQuery.data ? <AsyncState state="error" error={searchQuery.error} onRetry={() => void searchQuery.refetch()} /> : null}{searchQuery.isFetching && searchQuery.data ? <AsyncState state="refreshing" kind={submittedType === 'users' ? 'user' : 'poll'} /> : null}
    </main>
  );
}
