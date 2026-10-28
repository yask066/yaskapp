import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Poll } from '../api/models';

type MotionScrollFixture = {
  seed: number;
  profiling: { count: number; idPrefix: string };
  network: { delayMs: number; timeoutMs: number; reorderVoteMs: number; reorderLikeMs: number; slowMediaMs: number };
  race: {
    pollId: string;
    optionId: string;
    snapshots: Record<'vote' | 'like' | 'realtime', Partial<Poll>>;
    expected: { votesCount: number; optionVotes: number[]; viewerVoteOptionId: string; likesCount: number; viewerHasLiked: boolean };
    orders: Record<string, string[]>;
  };
  cursorPages: Array<{ cursor: string | null; pollIds: string[] }>;
  cards: Poll[];
};

const fixture = JSON.parse(
  readFileSync(
    resolve(process.cwd(), '../../test/fixtures/t02-motion-scroll-loading-polls.json'),
    'utf8',
  ),
) as MotionScrollFixture;

export const t02MotionScrollPolls = fixture.cards;
export const t02MotionScrollCursorPages = fixture.cursorPages;
export const t02MotionScrollSeed = fixture.seed;
export const t02MotionScrollNetwork = fixture.network;
export const t02MotionScrollRace = fixture.race;

export function t02RacePoll(kind?: keyof typeof fixture.race.snapshots): Poll {
  const baseline = fixture.cards.find((poll) => poll.id === fixture.race.pollId)!;
  return structuredClone({ ...baseline, ...(kind ? fixture.race.snapshots[kind] : {}) });
}

export function t02ProfilingPolls(seed = fixture.seed): Poll[] {
  return Array.from({ length: fixture.profiling.count }, (_, index) => {
    const poll = structuredClone(fixture.cards[(seed + index) % fixture.cards.length]);
    poll.id = `${fixture.profiling.idPrefix}-${seed}-${String(index + 1).padStart(3, '0')}`;
    poll.options = poll.options.map((option, optionIndex) => ({ ...option, id: `${poll.id}-option-${optionIndex}` }));
    return poll;
  });
}

// Gates control arrival, not elapsed wall-clock time. Each test owns its gates.
export function t02ResponseGate<T>() {
  let release!: (value: T) => void;
  const response = new Promise<T>((resolve) => { release = resolve; });
  return { response, release };
}
