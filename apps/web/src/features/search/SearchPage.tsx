import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { search } from '../../api/search';
import { PollCard } from '../../components/PollCard';
import { Avatar } from '../../components/Avatar';
import { useSession } from '../../app/session-provider';
type SearchType = 'all' | 'polls' | 'users'; type SearchSort = 'relevance' | 'newest' | 'popular';
export function SearchPage() {
  const { user } = useSession();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<SearchType>('all');
  const [sort, setSort] = useState<SearchSort>('relevance');
  const searchMutation = useMutation({ mutationFn: () => search({ q: query.trim(), type, sort }) });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (query.trim().length >= 2) searchMutation.mutate();
  };

  return (
    <main id="main-content" className="search-page">
      <header className="page-heading"><div><p className="eyebrow">Explore</p><h1>Search</h1></div></header>
      <form className="search-panel" role="search" onSubmit={submit}>
        <label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} minLength={2} required /></label>
        <label>Result type<select value={type} onChange={(event) => setType(event.target.value as SearchType)}><option value="all">All</option><option value="polls">Polls</option><option value="users">Users</option></select></label>
        <label>Sort<select value={sort} onChange={(event) => setSort(event.target.value as SearchSort)}><option value="relevance">Relevance</option><option value="newest">Newest</option><option value="popular">Popular</option></select></label>
        <div className="search-actions"><button className="button button--primary" type="submit" disabled={searchMutation.isPending || query.trim().length < 2}>Search</button></div>
      </form>
      <div className="segmented-tabs" role="tablist" aria-label="Search result type">
        {(['all', 'polls', 'users'] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={type === value} aria-pressed={type === value} onClick={() => setType(value)}>{value === 'all' ? 'All' : value === 'polls' ? 'Polls' : 'Users'}</button>)}
      </div>
      {searchMutation.isError ? <p role="alert">{searchMutation.error instanceof Error ? searchMutation.error.message : 'Search failed.'}</p> : null}
      <div className="search-results">
        <section className="feed-list" aria-label="Poll results">
          {searchMutation.data?.items.filter((item) => item.type === 'poll').map((item) => <PollCard key={`poll-${item.poll.id}`} poll={item.poll} viewerId={user?.id} />)}
        </section>
        <section className="people-results" aria-label="User results">
          {searchMutation.data?.items.filter((item) => item.type === 'user').map((item) => <article className="profile-result" key={`user-${item.user.id}`}><Avatar name={item.user.profile.displayName || item.user.username} src={item.user.profile.avatarUrl} /><div><Link to={`/users/${item.user.id}`}>{item.user.profile.displayName || item.user.username}</Link><p>@{item.user.username}</p></div></article>)}
        </section>
      </div>
    </main>
  );
}
