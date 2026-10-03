// M03 decision experiment only. Does not import or implement production stores.
// Revisions are annotations of unchanged M02 input, not observed server versions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(new URL('../../test/fixtures/t02-motion-scroll-loading-polls.json', import.meta.url), 'utf8'));
assert.equal(fixture.fixtureVersion, 2);
assert.equal(fixture.seed, 20261002);
const original = JSON.stringify(fixture);
const race = fixture.race;
const base = fixture.cards.find((poll) => poll.id === race.pollId);
const rev = (votes = '0', likes = '0', comments = '0') => ({ votes, likes, comments });
const snapshot = (kind, revisions = rev()) => structuredClone({ ...base, ...race.snapshots[kind], stateRevisions: revisions });
const baseline = snapshot(undefined);
const vote = snapshot('vote', rev('1'));
const like = snapshot('like', rev('0', '1'));
const realtime = snapshot('realtime', rev('2'));
const combined = { ...vote, ...race.snapshots.like, stateRevisions: rev('1', '1') };
const http = { origin: 'http', sessionEpoch: 1, viewerId: 'alice', startedGeneration: 0 };
const broadcast = { ...http, origin: 'realtime' };
const groups = ['votes', 'likes', 'comments'];
const invalid = Symbol('invalid');
const maxRevision = 9223372036854775807n;

function revision(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) return invalid;
  const parsed = BigInt(value);
  return parsed <= maxRevision ? parsed : invalid;
}

function value(poll, group) {
  if (group === 'votes') return { total: poll.votesCount, options: poll.options.map(({ id, votesCount }) => ({ id, votesCount })).sort((a, b) => a.id.localeCompare(b.id)) };
  return poll[`${group}Count`];
}

function validGroup(poll, group) {
  const count = poll[`${group}Count`];
  if (!Number.isSafeInteger(count) || count < 0) return false;
  if (group !== 'votes') return true;
  return Array.isArray(poll.options)
    && new Set(poll.options.map((o) => o.id)).size === poll.options.length
    && poll.options.every((o) => typeof o.id === 'string' && Number.isSafeInteger(o.votesCount) && o.votesCount >= 0)
    && poll.options.reduce((sum, o) => sum + o.votesCount, 0) === count;
}

function empty() {
  return { poll: structuredClone(base), revisions: {}, deleted: false, generation: 0, sessionEpoch: 1, viewerId: 'alice', pending: {}, unverified: false };
}

function merge(current, incoming, context = http) {
  const state = structuredClone(current);
  let needsReconcile = false;
  if (context.sessionEpoch !== state.sessionEpoch || context.viewerId !== state.viewerId || incoming.id !== state.poll.id || state.deleted) return { state, needsReconcile };
  function accept(group, incomingRevision, next, previous, write, bootstrap = false) {
    const known = state.revisions[group];
    if (incomingRevision === invalid || incomingRevision === null) {
      needsReconcile = true;
      if (incomingRevision === null && known === undefined && bootstrap && context.startedGeneration === current.generation) {
        write();
        state.unverified = true;
        state.generation++;
      }
      return;
    }
    if (known === undefined || incomingRevision > BigInt(known)) {
      write();
      state.revisions[group] = incomingRevision.toString();
      state.generation++;
    } else if (incomingRevision === BigInt(known) && JSON.stringify(next) !== JSON.stringify(previous)) {
      needsReconcile = true;
    }
  }
  for (const group of groups) {
    const r = revision(incoming.stateRevisions?.[group]);
    if (!validGroup(incoming, group)) { needsReconcile = true; continue; }
    accept(group, r, value(incoming, group), value(state.poll, group), () => {
      state.poll[`${group}Count`] = incoming[`${group}Count`];
      if (group === 'votes') {
        const counts = new Map(incoming.options.map((o) => [o.id, o.votesCount]));
        state.poll.options = state.poll.options.map((o) => ({ ...o, votesCount: counts.get(o.id) }));
      }
    }, context.origin !== 'realtime');
    const field = group === 'votes' ? 'viewerVoteOptionId' : group === 'likes' ? 'viewerHasLiked' : null;
    if (!field || context.origin === 'realtime' || context.viewerId === null || !Object.hasOwn(incoming, field)) continue;
    const personal = incoming[field];
    if (field === 'viewerHasLiked' ? typeof personal !== 'boolean' : personal !== null && !incoming.options.some((o) => o.id === personal)) { needsReconcile = true; continue; }
    accept(group === 'votes' ? 'viewerVote' : 'viewerLike', r, personal, state.poll[field], () => { state.poll[field] = personal; });
  }
  return { state, needsReconcile };
}

const initial = () => merge(empty(), baseline).state;
const apply = (state, poll, context) => merge(state, poll, context).state;
const fields = (state) => ({ votesCount: state.poll.votesCount, optionVotes: state.poll.options.map((o) => o.votesCount), viewerVoteOptionId: state.poll.viewerVoteOptionId, likesCount: state.poll.likesCount, viewerHasLiked: state.poll.viewerHasLiked });
function begin(state, action, operationId, pollId = race.pollId) {
  const key = `${pollId}:${action}`;
  if (state.deleted && pollId === race.pollId || state.pending[key]) return null;
  const token = { pollId, action, operationId, sessionEpoch: state.sessionEpoch, viewerId: state.viewerId };
  state.pending[key] = token;
  return token;
}
function finish(state, token) {
  if (!token || token.sessionEpoch !== state.sessionEpoch || token.viewerId !== state.viewerId) return;
  const key = `${token.pollId}:${token.action}`;
  if (state.pending[key]?.operationId === token.operationId) delete state.pending[key];
}
function remove(state, context = http) {
  if (context.sessionEpoch !== state.sessionEpoch || context.viewerId !== state.viewerId) return;
  state.deleted = true;
  for (const [key, token] of Object.entries(state.pending)) if (token.pollId === race.pollId) delete state.pending[key];
}

const checks = [];
function check(name, fn) { fn(); checks.push(name); console.log(`PASS ${name}`); }

for (const reverse of [false, true]) check(`M02 ${reverse ? 'reverse' : 'forward'} response order`, () => {
  const state = reverse ? apply(apply(initial(), vote), like) : apply(apply(initial(), like), vote);
  assert.deepEqual(fields(state), race.expected);
});
check('M02 stale refetch after both actions', () => {
  const state = apply(apply(apply(initial(), vote), combined), baseline);
  assert.deepEqual(fields(state), race.expected);
});
check('coherent second committed snapshot', () => {
  for (const first of [vote, like]) assert.deepEqual(fields(apply(apply(initial(), combined), first)), race.expected);
});
check('M02 duplicate realtime before late HTTP: independent viewer watermark', () => {
  let state = apply(initial(), like);
  state = apply(state, realtime, broadcast);
  const once = structuredClone(state);
  state = apply(state, realtime, broadcast);
  assert.deepEqual(state, once);
  state = apply(state, vote);
  assert.deepEqual(fields(state), { ...race.expected, votesCount: 11, optionVotes: [7, 4] });
  assert.equal(state.revisions.votes, '2');
  assert.equal(state.revisions.viewerVote, '1');
});
check('broadcast never changes either viewer field', () => {
  const state = apply(apply(initial(), combined), { ...realtime, viewerHasLiked: false, viewerVoteOptionId: null }, broadcast);
  assert.equal(state.poll.viewerHasLiked, true);
  assert.equal(state.poll.viewerVoteOptionId, race.optionId);
});
check('equal revision and identical payload are a full no-op', () => {
  const state = apply(initial(), combined);
  assert.deepEqual(merge(state, combined), { state, needsReconcile: false });
});
check('equal revision conflict preserves accepted payload and requests reconcile', () => {
  const state = apply(initial(), combined);
  const result = merge(state, { ...combined, likesCount: 500 });
  assert.equal(result.state.poll.likesCount, 10);
  assert.equal(result.needsReconcile, true);
});
check('comments group is independent from stale reaction groups', () => {
  const result = merge(apply(initial(), combined), { ...baseline, commentsCount: 12, stateRevisions: rev('0', '0', '1') });
  assert.deepEqual(fields(result.state), race.expected);
  assert.equal(result.state.poll.commentsCount, 12);
});
check('missing revision cannot replace known state', () => {
  const legacy = structuredClone(baseline); delete legacy.stateRevisions;
  const state = apply(initial(), combined);
  const result = merge(state, legacy);
  assert.deepEqual(result.state, state);
  assert.equal(result.needsReconcile, true);
});
check('legacy bootstrap remains unverified and has no known watermark', () => {
  const legacy = structuredClone(baseline); delete legacy.stateRevisions;
  const result = merge(empty(), legacy);
  assert.equal(result.state.unverified, true);
  assert.deepEqual(result.state.revisions, {});
  assert.equal(result.needsReconcile, true);
  const changed = empty(); changed.generation = 1;
  assert.deepEqual(merge(changed, legacy).state, changed);
});
check('absent authenticated viewer keys preserve known personal fields', () => {
  const poll = { ...realtime }; delete poll.viewerHasLiked; delete poll.viewerVoteOptionId;
  const state = apply(apply(initial(), combined), poll);
  assert.equal(state.poll.viewerHasLiked, true);
  assert.equal(state.poll.viewerVoteOptionId, race.optionId);
});
check('malformed revisions rejected; valid independent group accepted', () => {
  for (const malformed of [-1, 1, '-1', '01', '1.5', '9223372036854775808', null]) {
    const result = merge(initial(), { ...combined, stateRevisions: rev(malformed, '1') });
    assert.equal(result.state.poll.votesCount, 9);
    assert.equal(result.state.poll.likesCount, 10);
    assert.equal(result.needsReconcile, true);
  }
});
check('bigint ordering is exact above JS safe integer', () => {
  let state = apply(initial(), { ...baseline, stateRevisions: rev('0', '9007199254740992') });
  state = apply(state, { ...like, stateRevisions: rev('0', '9007199254740993') });
  assert.equal(state.poll.likesCount, 10);
  assert.equal(state.revisions.likes, '9007199254740993');
});
check('invalid vote sum rejected without suppressing fresh like', () => {
  const result = merge(initial(), { ...combined, votesCount: 999 });
  assert.equal(result.state.poll.votesCount, 9);
  assert.equal(result.state.poll.viewerVoteOptionId, null);
  assert.equal(result.state.poll.likesCount, 10);
  assert.equal(result.needsReconcile, true);
});
check('logout/login drops old epoch even for same principal', () => {
  for (const viewerId of ['bob', 'alice']) {
    const state = initial(); state.sessionEpoch = 2; state.viewerId = viewerId; state.pending = {};
    assert.deepEqual(merge(state, combined).state, state);
    assert.deepEqual(merge(state, realtime, broadcast).state, state);
  }
});
check('different principal or wrong poll ID rejected', () => {
  const state = initial();
  assert.deepEqual(merge(state, combined, { ...http, viewerId: 'bob' }).state, state);
  assert.deepEqual(merge(state, { ...combined, id: 'different' }).state, state);
});
check('deletion is absorbing across late HTTP/refetch/realtime', () => {
  const state = apply(initial(), combined); begin(state, 'vote', 'old'); remove(state);
  for (const poll of [baseline, vote, like, realtime]) {
    for (const context of [http, broadcast]) assert.deepEqual(merge(state, poll, context).state, state);
  }
  assert.deepEqual(state.pending, {});
  assert.equal(begin(state, 'like', 'retry'), null);
});
check('old epoch deletion cannot delete new session state', () => {
  const state = initial(); state.sessionEpoch = 2; const before = structuredClone(state);
  remove(state);
  assert.deepEqual(state, before);
});
check('10 taps per action admit one request; independent actions and polls allowed', () => {
  const state = initial();
  for (const action of ['vote', 'like']) {
    const tokens = Array.from({ length: 10 }, (_, i) => begin(state, action, `${action}-${i}`));
    assert.equal(tokens.filter(Boolean).length, 1);
  }
  assert.ok(begin(state, 'vote', 'other', 'poll-B'));
});
check('old completion cannot clear retry pending in same epoch', () => {
  const state = initial(); const first = begin(state, 'like', 'first'); finish(state, first);
  const second = begin(state, 'like', 'second'); finish(state, first);
  assert.deepEqual(state.pending[`${race.pollId}:like`], second);
});
check('old session completion cannot clear new session pending', () => {
  const state = initial(); const old = begin(state, 'vote', 'old');
  state.sessionEpoch++; state.pending = {}; const fresh = begin(state, 'vote', 'fresh'); finish(state, old);
  assert.deepEqual(state.pending[`${race.pollId}:vote`], fresh);
});
check('M02 source fixture unchanged', () => assert.equal(JSON.stringify(fixture), original));
console.log(`M03 decision model: ${checks.length}/${checks.length} passed; fixtureVersion=${fixture.fixtureVersion}; seed=${fixture.seed}`);
console.log('Not verified here: production reducer, DB isolation/atomicity, cache fan-out, transport, lifecycle or G0.');
