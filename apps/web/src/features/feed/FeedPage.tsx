import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { listPolls } from '../../api/polls';
import { useSession } from '../../app/session-provider';
import { AsyncState } from '../../components/AsyncState';
import { PollCard } from '../../components/PollCard';

type FeedSort = 'newest' | 'popular';

export function FeedPage() {
  const [sort, setSort] = useState<FeedSort>('newest');
  const { status, user } = useSession();
  const pollsQuery = useQuery({
    queryKey: ['polls', sort],
    queryFn: () => sort === 'newest' ? listPolls() : listPolls({ sort }),
    enabled: status !== 'loading',
  });

  return (
    <main id="main-content">
      <h1>Feed</h1>
      <div aria-label="Feed order">
        <button type="button" aria-pressed={sort === 'newest'} onClick={() => setSort('newest')}>Newest</button>
        <button type="button" aria-pressed={sort === 'popular'} onClick={() => setSort('popular')}>Popular</button>
      </div>
      {pollsQuery.isPending ? <AsyncState state="loading" /> : null}
      {pollsQuery.isError ? <AsyncState state="error" error={pollsQuery.error} onRetry={() => void pollsQuery.refetch()} /> : null}
      {pollsQuery.data && pollsQuery.data.length === 0 ? <AsyncState state="empty" /> : null}
      {pollsQuery.data?.map((poll) => <PollCard key={poll.id} poll={poll} viewerId={user?.id} />)}
    </main>
  );
}
