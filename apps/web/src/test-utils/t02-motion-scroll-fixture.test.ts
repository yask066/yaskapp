import { expect, test } from 'vitest';
import { t02ProfilingPolls, t02RacePoll, t02MotionScrollPolls } from './t02-motion-scroll-fixture';

test('profiling produces repeatable unique IDs without mutating the shared layout inputs', () => {
  const polls = t02ProfilingPolls();
  expect(polls).toHaveLength(100);
  expect(polls[0].id).toBe('motion-profile-20261002-001');
  expect(polls[99].id).toBe('motion-profile-20261002-100');
  expect(new Set(polls.map((poll) => poll.id)).size).toBe(100);
  expect(new Set(polls.flatMap((poll) => poll.options.map((option) => option.id))).size).toBe(200);
  expect(polls).toEqual(t02ProfilingPolls());
  polls[0].options[0].votesCount = -1;
  expect(t02ProfilingPolls()[0].options[0].votesCount).toBe(50);
  expect(t02MotionScrollPolls[2].options[0].votesCount).toBe(50);
  expect(t02ProfilingPolls(42)[0].id).toBe('motion-profile-42-001');
});

test('race snapshots independently represent vote, like and anonymous realtime inputs', () => {
  expect(t02RacePoll('vote').votesCount).toBe(10);
  expect(t02RacePoll('vote').viewerHasLiked).toBe(false);
  expect(t02RacePoll('like').votesCount).toBe(9);
  expect(t02RacePoll('like').viewerHasLiked).toBe(true);
  expect(t02RacePoll('realtime').votesCount).toBe(11);
  expect(t02RacePoll('realtime').viewerVoteOptionId).toBeNull();
  const poll = t02RacePoll('vote');
  poll.options[0].votesCount = 100;
  expect(t02RacePoll('vote').options[0].votesCount).toBe(6);
});
