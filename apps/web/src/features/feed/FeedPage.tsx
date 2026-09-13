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
  { topic: 'Programming', polls: '1.2K polls' },
  { topic: 'Lifestyle', polls: '980 polls' },
  { topic: 'Tech', polls: '784 polls' },
  { topic: 'Games', polls: '612 polls' },
  { topic: 'Education', polls: '590 polls' },
];
const suggestedUsers = [
  { name: 'alexdev', handle: '@alexdev' },
  { name: 'marina', handle: '@marina' },
  { name: 'pixelcat', handle: '@pixelcat' },
];

export function FeedPage() {
  const [sort, setSort] = useState<FeedSort>('for-you');
  const [trendsOpen, setTrendsOpen] = useState(true);
  const { status, user } = useSession();
  const mutations = usePollMutations();
  const pollsQuery = useQuery({ queryKey: ['polls', sort], queryFn: () => sort === 'trending' ? listPolls({ sort: 'popular' }) : listPolls(), enabled: status !== 'loading' });
  return <main id="main-content" className="feed-page">
    <section className="feed-main" aria-label="Poll feed"><section className="poll-composer" aria-label="Create a poll"><div className="composer-avatar">{user?.profile.displayName.slice(0, 1).toUpperCase() ?? 'Y'}</div><p>What's on your mind today?</p><Link className="create-poll-link" to="/polls/new"><MaterialIcon name="add" /> Post</Link><div className="composer-actions"><span><MaterialIcon name="image" /> Image</span><span><MaterialIcon name="poll" /> Poll</span><span><MaterialIcon name="gif" /> GIF</span></div></section><div className="feed-tabs" aria-label="Feed order"><button type="button" aria-pressed={sort === 'for-you'} onClick={() => setSort('for-you')}>For you</button><button type="button" aria-pressed={sort === 'following'} onClick={() => setSort('following')}>Following</button><button type="button" aria-pressed={sort === 'trending'} onClick={() => setSort('trending')}>Trending</button></div>
      {pollsQuery.isPending ? <AsyncState state="loading" /> : null}{pollsQuery.isError ? <AsyncState state="error" error={pollsQuery.error} onRetry={() => void pollsQuery.refetch()} /> : null}{pollsQuery.data && pollsQuery.data.length === 0 ? <AsyncState state="empty" /> : null}{mutations.error ? <p aria-live="polite">{mutations.error}</p> : null}
      <div className="feed-list">{pollsQuery.data?.map((poll) => <PollCard key={poll.id} poll={poll} viewerId={user?.id} isVoting={mutations.isPending} onVote={user ? (pollId, optionId) => mutations.vote({ pollId, optionId }) : undefined} onCancelVote={user ? mutations.cancelVote : undefined} onLike={user ? (pollId, viewerHasLiked) => mutations.toggleLike({ pollId, viewerHasLiked }) : undefined} onDelete={user ? mutations.deletePoll : undefined} />)}</div></section>
    <aside className="feed-sidebar" aria-label="Discover content"><section className="discovery-card trends-card"><header className="discovery-heading"><h2><MaterialIcon name="fire" /> Trending today</h2></header><button className="trends-toggle" type="button" aria-expanded={trendsOpen} aria-controls="trends-list" onClick={() => setTrendsOpen((open) => !open)}>Toggle trending topics</button>{trendsOpen ? <ul id="trends-list">{trends.map((trend, index) => <li key={trend.topic}><a href={`/?topic=${trend.topic}`}><span>{index + 1}</span><div><strong>{trend.topic}</strong><small>{trend.polls}</small></div></a></li>)}</ul> : null}</section><section className="discovery-card suggested-users"><header className="discovery-heading"><h2>Who to follow</h2><a className="show-more" href="/search">See all</a></header><ul>{suggestedUsers.map((person) => <li key={person.handle}><span className="suggested-avatar" aria-hidden="true">{person.name[0].toUpperCase()}</span><p><strong>{person.name}</strong><small>{person.handle}</small></p><button type="button">Follow</button></li>)}</ul></section><footer className="sidebar-links"><div><a href="/">About</a><a href="/">Help</a><a href="/">Privacy</a><a href="/">Terms</a></div><p>© {new Date().getFullYear()} Yask. All rights reserved.</p></footer></aside>
  </main>;
}
