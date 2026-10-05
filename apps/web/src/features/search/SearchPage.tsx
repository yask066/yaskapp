import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { search } from '../../api/search';
import { PollCard } from '../../components/PollCard';
import { Avatar } from '../../components/Avatar';
import { AsyncState } from '../../components/AsyncState';
import { useSession } from '../../app/session-provider';
import { fetchPollQuery } from '../polls/poll-state';
type SearchType = 'all' | 'polls' | 'users'; type SearchSort = 'relevance' | 'newest' | 'popular';
export function SearchPage() {
  const { user, status, sessionEpoch } = useSession();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<SearchType>('all');
  const [sort, setSort] = useState<SearchSort>('relevance');
  const [submitted, setSubmitted] = useState<{ q: string; type: SearchType; sort: SearchSort; epoch: number } | null>(null);
  const searchQuery = useQuery({
    queryKey: ['search', sessionEpoch, submitted],
    queryFn: ({ signal }) => fetchPollQuery(queryClient, user?.id ?? null, () => search({ q: submitted!.q, type: submitted!.type, sort: submitted!.sort }, signal), false, signal),
    enabled: submitted !== null && submitted.epoch === sessionEpoch && status !== 'loading',
    retry: false,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (query.trim().length < 2) return;
    if (submitted?.q === query.trim() && submitted.type === type && submitted.sort === sort && submitted.epoch === sessionEpoch) void searchQuery.refetch();
    else setSubmitted({ q: query.trim(), type, sort, epoch: sessionEpoch });
  };

  return (
    <main id="main-content" className="search-page">
      <header className="page-heading"><div><p className="eyebrow">Explore</p><h1>Search</h1></div></header>
      <form className="search-panel" role="search" onSubmit={submit}>
        <label>Search<input value={query} onChange={(event) => { setQuery(event.target.value); setSubmitted(null); }} minLength={2} required /></label>
        <label>Result type<select value={type} onChange={(event) => { setType(event.target.value as SearchType); setSubmitted(null); }}><option value="all">All</option><option value="polls">Polls</option><option value="users">Users</option></select></label>
        <label>Sort<select value={sort} onChange={(event) => { setSort(event.target.value as SearchSort); setSubmitted(null); }}><option value="relevance">Relevance</option><option value="newest">Newest</option><option value="popular">Popular</option></select></label>
        <div className="search-actions"><button className="button button--primary" type="submit" disabled={searchQuery.isFetching || query.trim().length < 2 || status === 'loading'}>Search</button></div>
      </form>
      <div className="segmented-tabs" role="tablist" aria-label="Search result type">
        {(['all', 'polls', 'users'] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={type === value} aria-pressed={type === value} onClick={() => { if (value !== type) { setType(value); setSubmitted(null); } }}>{value === 'all' ? 'All' : value === 'polls' ? 'Polls' : 'Users'}</button>)}
      </div>
      {searchQuery.isError ? <AsyncState state="error" error={searchQuery.error} onRetry={() => void searchQuery.refetch()} /> : null}
      <div className="search-results">
        <section className="feed-list" aria-label="Poll results">
          {searchQuery.data?.items.filter((item) => item.type === 'poll').map((item) => <PollCard key={`poll-${item.poll.id}`} poll={item.poll} viewerId={user?.id} />)}
        </section>
        <section className="people-results" aria-label="User results">
          {searchQuery.data?.items.filter((item) => item.type === 'user').map((item) => <article className="profile-result" key={`user-${item.user.id}`}><Avatar name={item.user.profile.displayName || item.user.username} src={item.user.profile.avatarUrl} /><div><Link to={`/users/${item.user.id}`}>{item.user.profile.displayName || item.user.username}</Link><p>@{item.user.username}</p></div></article>)}
        </section>
      </div>
    </main>
  );
}
