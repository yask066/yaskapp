import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { listPolls } from '../../api/polls';
import { useSession } from '../../app/session-provider';
import { AsyncState } from '../../components/AsyncState';
import { PollCard } from '../../components/PollCard';
import { MaterialIcon } from '../../components/MaterialIcon';
import { usePollMutations } from '../polls/usePollMutations';

type FeedSort = 'for-you' | 'following' | 'trending';
const trends = [
  { topic: '#Formula1', polls: '12.4K polls', mark: '🏎️' },
  { topic: '#Gaming', polls: '8.1K polls', mark: '🎮' },
  { topic: '#Football', polls: '6.9K polls', mark: '⚽' },
  { topic: '#Technology', polls: '5.2K polls', mark: '💻' },
  { topic: '#Movies', polls: '4.8K polls', mark: '🎬' },
];
const suggestedUsers = [
  { name: 'FormulaFan', handle: '@formula1fan', followers: '12.4K followers', mark: '🏎️' },
  { name: 'CodeMaster', handle: '@codemaster', followers: '8.7K followers', mark: '👤' },
  { name: 'PollKing', handle: '@pollking', followers: '5.1K followers', mark: '🐱' },
];

export function FeedPage() {
  const [sort, setSort] = useState<FeedSort>('for-you');
  const [trendsOpen, setTrendsOpen] = useState(true);
  const { status, user } = useSession();
  const mutations = usePollMutations();
  const pollsQuery = useQuery({ queryKey: ['polls', sort], queryFn: () => sort === 'trending' ? listPolls({ sort: 'popular' }) : listPolls(), enabled: status !== 'loading' });
  return <main id="main-content" className="feed-page">
    <section className="feed-main" aria-label="Poll feed"><section className="poll-composer" aria-label="Create a poll"><MaterialIcon className="composer-icon" name="add" /><p>What's on your mind today?</p><Link className="create-poll-link" to="/polls/new"><MaterialIcon name="add" /> Create poll</Link></section><div className="feed-tabs" aria-label="Feed order"><button type="button" aria-pressed={sort === 'for-you'} onClick={() => setSort('for-you')}>For you</button><button type="button" aria-pressed={sort === 'following'} onClick={() => setSort('following')}>Following</button><button type="button" aria-pressed={sort === 'trending'} onClick={() => setSort('trending')}>Trending</button></div>
      {pollsQuery.isPending ? <AsyncState state="loading" /> : null}{pollsQuery.isError ? <AsyncState state="error" error={pollsQuery.error} onRetry={() => void pollsQuery.refetch()} /> : null}{pollsQuery.data && pollsQuery.data.length === 0 ? <AsyncState state="empty" /> : null}{mutations.error ? <p aria-live="polite">{mutations.error}</p> : null}
      <div className="feed-list">{pollsQuery.data?.map((poll) => <PollCard key={poll.id} poll={poll} viewerId={user?.id} onVote={user ? (pollId, optionId) => mutations.vote({ pollId, optionId }) : undefined} onCancelVote={user ? mutations.cancelVote : undefined} onLike={user ? (pollId, viewerHasLiked) => mutations.toggleLike({ pollId, viewerHasLiked }) : undefined} onDelete={user ? mutations.deletePoll : undefined} />)}</div></section>
    <aside className="feed-sidebar" aria-label="Discover content"><section className="discovery-card trends-card"><header className="discovery-heading"><h2>↗ Trending topics</h2><a className="show-more" href="/search">View all</a></header><button className="trends-toggle" type="button" aria-expanded={trendsOpen} aria-controls="trends-list" onClick={() => setTrendsOpen((open) => !open)}>Toggle trending topics <span aria-hidden="true">›</span></button>{trendsOpen ? <ul id="trends-list">{trends.map((trend, index) => <li key={trend.topic}><a href={`/?topic=${trend.topic.slice(1)}`}><span>{index + 1}</span><div><strong>{trend.topic}</strong><small>{trend.polls}</small></div><b aria-hidden="true">{trend.mark}</b></a></li>)}</ul> : null}</section><section className="discovery-card discovery-cta"><div><span className="cta-icon" aria-hidden="true">👥</span><h2>Find interesting content</h2><p>Follow users, explore topics and participate in polls.</p><a className="create-poll-link" href="/search">Explore <span aria-hidden="true">›</span></a></div><span className="people-art" aria-hidden="true" /></section><section className="discovery-card suggested-users"><header className="discovery-heading"><h2>Who to follow</h2><a className="show-more" href="/search">View all</a></header><ul>{suggestedUsers.map((person) => <li key={person.handle}><span className="suggested-avatar" aria-hidden="true">{person.mark}</span><p><strong>{person.name}</strong><small>{person.handle}</small><small>{person.followers}</small></p><button type="button">Follow</button></li>)}</ul></section></aside>
  </main>;
}
