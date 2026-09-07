import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { listPolls } from '../../api/polls';
import { useSession } from '../../app/session-provider';
import { AsyncState } from '../../components/AsyncState';
import { PollCard } from '../../components/PollCard';
import { usePollMutations } from '../polls/usePollMutations';

type FeedSort = 'newest' | 'popular';
const trends = ['#Formula1', '#Programming', '#Football', '#Technology', '#Travel'];

export function FeedPage() {
  const [sort, setSort] = useState<FeedSort>('newest');
  const { status, user } = useSession();
  const mutations = usePollMutations();
  const pollsQuery = useQuery({ queryKey: ['polls', sort], queryFn: () => sort === 'newest' ? listPolls() : listPolls({ sort }), enabled: status !== 'loading' });
  return <main id="main-content" className="feed-page">
    <section className="feed-main" aria-label="Poll feed"><h1>Feed</h1><div className="feed-tabs" aria-label="Feed order"><button type="button" aria-pressed={sort === 'newest'} onClick={() => setSort('newest')}>Newest</button><button type="button" aria-pressed={sort === 'popular'} onClick={() => setSort('popular')}>Popular</button></div>
      {pollsQuery.isPending ? <AsyncState state="loading" /> : null}{pollsQuery.isError ? <AsyncState state="error" error={pollsQuery.error} onRetry={() => void pollsQuery.refetch()} /> : null}{pollsQuery.data && pollsQuery.data.length === 0 ? <AsyncState state="empty" /> : null}{mutations.error ? <p aria-live="polite">{mutations.error}</p> : null}
      <div className="feed-list">{pollsQuery.data?.map((poll) => <PollCard key={poll.id} poll={poll} viewerId={user?.id} onVote={user ? (pollId, optionId) => mutations.vote({ pollId, optionId }) : undefined} onCancelVote={user ? mutations.cancelVote : undefined} onLike={user ? (pollId, viewerHasLiked) => mutations.toggleLike({ pollId, viewerHasLiked }) : undefined} onDelete={user ? mutations.deletePoll : undefined} />)}</div></section>
    <aside className="feed-sidebar" aria-label="Discover content"><section className="discovery-card"><h2>↗ Trends</h2><ul>{trends.map((trend, index) => <li key={trend}><a href={`/?topic=${trend.slice(1)}`}><span>#</span><div><strong>{trend}</strong><small>{`${(12 - index * 1.6).toFixed(1)}K polls`}</small></div></a></li>)}</ul><a className="show-more" href="/search">Show more</a></section><section className="discovery-card discovery-cta"><h2>Find interesting content</h2><p>Follow users, explore topics and participate in polls.</p><a className="create-poll-link" href="/search">Explore</a></section></aside>
  </main>;
}
