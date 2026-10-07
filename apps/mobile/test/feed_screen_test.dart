import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/features/auth/auth_session.dart';
import 'package:yaskapp_mobile/src/features/feed/feed_screen.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_summary.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_card.dart';
import 'package:yaskapp_mobile/src/features/polls/polls_api_client.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_state_scope.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_state_store.dart';
import 'package:yaskapp_mobile/src/features/realtime/realtime_client.dart';
import 'package:yaskapp_mobile/src/features/search/search_api_client.dart';
import 'package:yaskapp_mobile/src/features/search/search_screen.dart';
import 'support/motion_scroll_fixture.dart';

void main() {
  testWidgets('M12 feed poll rows use stable poll IDs as keys', (tester) async {
    final poll = motionRacePoll();
    final api = _FakePollsApiClient(initialPolls: [poll]);
    final realtime = _FakeRealtimeClient();
    final store = _seedPollStore(poll);
    addTearDown(realtime.close);
    addTearDown(store.dispose);

    await tester.pumpWidget(_feedWithStore(api, realtime, store));
    await tester.pumpAndSettle();

    expect(find.byKey(ValueKey('poll-${poll.id}')), findsOneWidget);
  });

  testWidgets('M10 create prompt keeps its action readable at 200%', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final poll = motionRacePoll();
    final api = _FakePollsApiClient(initialPolls: [poll]);
    final realtime = _FakeRealtimeClient();
    final store = _seedPollStore(poll);
    addTearDown(realtime.close);
    addTearDown(store.dispose);

    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(2)),
        child: _feedWithStore(api, realtime, store,
            textScaler: const TextScaler.linear(2)),
      ),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    final label = tester.getRect(find.text('Create poll'));
    final button = tester.getRect(find.ancestor(
      of: find.text('Create poll'),
      matching: find.byType(FilledButton),
    ));
    expect(label.left, greaterThanOrEqualTo(button.left));
    expect(label.right, lessThanOrEqualTo(button.right));
    expect(label.top, greaterThanOrEqualTo(button.top));
    expect(label.bottom, lessThanOrEqualTo(button.bottom));
  });

  test('M02 profiling uses the shared seed and creates 100 unique IDs', () {
    final polls = motionProfilingPolls();
    expect(polls, hasLength(100));
    expect(polls.first.id, 'motion-profile-20261002-001');
    expect(polls.last.id, 'motion-profile-20261002-100');
    expect(polls.map((poll) => poll.id).toSet(), hasLength(100));
    expect(
        polls.expand((poll) => poll.options.map((option) => option.id)).toSet(),
        hasLength(200));
    expect(polls.first.options.first.votesCount, 50);
    expect(motionProfilingPolls(seed: 42).first.id, 'motion-profile-42-001');
  });

  for (final reverse in [false, true]) {
    testWidgets(
        'M06 race_preserves_independent_fields${reverse ? '_reverse' : ''}',
        (tester) async {
      final baseline = motionRacePoll();
      final vote = Completer<PollSummary>();
      final like = Completer<PollSummary>();
      final api = _FakePollsApiClient(
          initialPolls: [baseline],
          voteResponse: vote.future,
          likeResponse: like.future);
      final realtime = _FakeRealtimeClient();
      final store = _seedPollStore(baseline);
      addTearDown(realtime.close);
      addTearDown(store.dispose);
      await tester.pumpWidget(_feedWithStore(api, realtime, store));
      await tester.pumpAndSettle();
      try {
        if (reverse) {
          tester.widget<PollCard>(find.byType(PollCard)).onToggleLike!();
        } else {
          tester
              .widget<PollCard>(find.byType(PollCard))
              .onVote!(baseline.options.first);
        }
        await tester.pump();
        if (reverse) {
          tester
              .widget<PollCard>(find.byType(PollCard))
              .onVote!(baseline.options.first);
        } else {
          tester.widget<PollCard>(find.byType(PollCard)).onToggleLike!();
        }
        await tester.pump();
        expect(api.voteCalls, 1);
        expect(api.likeCalls, 1);
        (reverse ? vote : like)
            .complete(motionRacePoll(reverse ? 'vote' : 'like'));
        await tester.pump();
        await tester.pump();
        final intermediate =
            tester.widget<PollCard>(find.byType(PollCard)).poll;
        expect(reverse ? intermediate.votesCount : intermediate.likesCount, 10);
        (reverse ? like : vote)
            .complete(motionRacePoll(reverse ? 'like' : 'vote'));
        await tester.pumpAndSettle();
        final race = motionScrollFixture['race'] as Map<String, dynamic>;
        expect(
            api.responseOrder,
            (race['orders'] as Map<String, dynamic>)[reverse
                ? 'race_preserves_independent_fields_reverse'
                : 'race_preserves_independent_fields']);
        expect(
            _reactionFields(
                tester.widget<PollCard>(find.byType(PollCard)).poll),
            race['expected']);
      } finally {
        if (!vote.isCompleted) vote.complete(motionRacePoll('vote'));
        if (!like.isCompleted) like.complete(motionRacePoll('like'));
        await tester.pumpAndSettle();
      }
    });
  }

  testWidgets('M06 stale_refetch preserves completed vote and like',
      (tester) async {
    final refetch = Completer<List<PollSummary>>();
    final api = _FakePollsApiClient(
        initialPolls: [motionRacePoll()],
        refreshResponse: refetch.future,
        votedPoll: motionRacePoll('vote'),
        likedPoll: motionRacePoll('like'));
    final realtime = _FakeRealtimeClient();
    final store = _seedPollStore(motionRacePoll());
    addTearDown(realtime.close);
    addTearDown(store.dispose);
    await tester.pumpWidget(_feedWithStore(api, realtime, store));
    await tester.pumpAndSettle();
    final refresh = tester
        .widget<RefreshIndicator>(find.byType(RefreshIndicator))
        .onRefresh();
    try {
      await tester.pump();
      expect(api.listPollsCalls, 2);
      tester
          .widget<PollCard>(find.byType(PollCard))
          .onVote!(motionRacePoll().options.first);
      await tester.pumpAndSettle();
      tester.widget<PollCard>(find.byType(PollCard)).onToggleLike!();
      await tester.pumpAndSettle();
      final expected =
          (motionScrollFixture['race'] as Map<String, dynamic>)['expected'];
      expect(
          _reactionFields(tester.widget<PollCard>(find.byType(PollCard)).poll),
          expected);
      refetch.complete([motionRacePoll()]);
      await refresh;
      await tester.pumpAndSettle();
      expect(
          _reactionFields(tester.widget<PollCard>(find.byType(PollCard)).poll),
          expected);
    } finally {
      if (!refetch.isCompleted) refetch.complete([motionRacePoll()]);
      await refresh;
    }
  });

  testWidgets('keeps the loaded feed visible when refresh fails',
      (tester) async {
    final refetch = Completer<List<PollSummary>>();
    final poll = motionRacePoll();
    final api = _FakePollsApiClient(
      initialPolls: [poll],
      refreshResponse: refetch.future,
    );
    final realtime = _FakeRealtimeClient();
    final store = _seedPollStore(poll);
    addTearDown(realtime.close);
    addTearDown(store.dispose);

    await tester.pumpWidget(_feedWithStore(api, realtime, store));
    await tester.pumpAndSettle();
    final refresh = tester
        .widget<RefreshIndicator>(find.byType(RefreshIndicator))
        .onRefresh();
    await tester.pump();
    refetch.completeError(Exception('offline'));
    await refresh;
    await tester.pumpAndSettle();

    expect(find.byKey(ValueKey('poll-${poll.id}')), findsOneWidget);
    expect(find.text('Could not refresh the feed.'), findsOneWidget);
  });

  testWidgets(
      'M06 realtime_before_http preserves viewer fields and newer votes',
      (tester) async {
    final vote = Completer<PollSummary>();
    final api = _FakePollsApiClient(
        initialPolls: [motionRacePoll()],
        voteResponse: vote.future,
        likedPoll: motionRacePoll('like'));
    final realtime = _FakeRealtimeClient();
    final store = _seedPollStore(motionRacePoll());
    addTearDown(realtime.close);
    addTearDown(store.dispose);
    await tester.pumpWidget(_feedWithStore(api, realtime, store));
    await tester.pumpAndSettle();
    try {
      tester
          .widget<PollCard>(find.byType(PollCard))
          .onVote!(motionRacePoll().options.first);
      await tester.pump();
      tester.widget<PollCard>(find.byType(PollCard)).onToggleLike!();
      await tester.pump();
      await tester.pump();
      expect(tester.widget<PollCard>(find.byType(PollCard)).poll.viewerHasLiked,
          true);
      realtime.injectVote(motionRacePoll('realtime'));
      await tester.pump();
      expect(
          tester.widget<PollCard>(find.byType(PollCard)).poll.votesCount, 11);
      realtime.injectVote(motionRacePoll('realtime'));
      await tester.pump();
      expect(
          tester.widget<PollCard>(find.byType(PollCard)).poll.votesCount, 11);
      vote.complete(motionRacePoll('vote'));
      await tester.pumpAndSettle();
      expect(
          _reactionFields(tester.widget<PollCard>(find.byType(PollCard)).poll),
          {
            ...(motionScrollFixture['race'] as Map<String, dynamic>)['expected']
                as Map<String, dynamic>,
            'votesCount': 11,
            'optionVotes': [7, 4],
          });
    } finally {
      if (!vote.isCompleted) vote.complete(motionRacePoll('vote'));
      await tester.pumpAndSettle();
    }
  });

  testWidgets('M06 stale refresh cannot restore a tombstoned poll',
      (tester) async {
    final refreshResponse = Completer<List<PollSummary>>();
    final baseline = motionRacePoll();
    final api = _FakePollsApiClient(
      initialPolls: [baseline],
      refreshResponse: refreshResponse.future,
    );
    final realtime = _FakeRealtimeClient();
    final store = _seedPollStore(baseline);
    addTearDown(realtime.close);
    addTearDown(store.dispose);
    await tester.pumpWidget(_feedWithStore(api, realtime, store));
    await tester.pumpAndSettle();
    final refresh = tester
        .widget<RefreshIndicator>(find.byType(RefreshIndicator))
        .onRefresh();
    await tester.pump();
    store.markDeleted(
      baseline.id,
      PollIngress(
        origin: PollOrigin.realtime,
        sessionEpoch: store.sessionEpoch,
        viewerId: null,
        expectedPollId: baseline.id,
        requestId: 'deleted',
        startedGeneration: store.generationFor(baseline.id),
      ),
    );
    refreshResponse.complete([baseline]);
    await refresh;
    await tester.pumpAndSettle();
    store.clear(viewerId: 'user-1');
    await tester.pumpAndSettle();

    expect(find.byType(PollCard), findsNothing);
  });

  testWidgets('M06 realtime vote cannot restore a tombstoned poll',
      (tester) async {
    final baseline = motionRacePoll();
    final api = _FakePollsApiClient(initialPolls: [baseline]);
    final realtime = _FakeRealtimeClient();
    final store = _seedPollStore(baseline);
    addTearDown(realtime.close);
    addTearDown(store.dispose);
    await tester.pumpWidget(_feedWithStore(api, realtime, store));
    await tester.pumpAndSettle();
    store.markDeleted(
      baseline.id,
      PollIngress(
        origin: PollOrigin.realtime,
        sessionEpoch: store.sessionEpoch,
        viewerId: null,
        expectedPollId: baseline.id,
        requestId: 'deleted',
        startedGeneration: store.generationFor(baseline.id),
      ),
    );
    realtime.injectVote(motionRacePoll('realtime'));
    await tester.pump();
    store.clear(viewerId: 'user-1');
    await tester.pumpAndSettle();

    expect(find.byType(PollCard), findsNothing);
  });

  testWidgets('shows one feed without category tabs', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: FeedScreen(
          session: _session,
          pollsApiClient: _FakePollsApiClient(initialPolls: const []),
          realtimeClient: _FakeRealtimeClient(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('For you'), findsNothing);
    expect(find.text('Following'), findsNothing);
    expect(find.text('Trending'), findsNothing);
    expect(find.byTooltip('Search'), findsOneWidget);
    expect(find.byTooltip('Notifications'), findsNothing);
  });

  testWidgets(
      'records the shared T02 fixture and current long-question truncation',
      (tester) async {
    final fixture = _readT02Fixture();
    final polls = (fixture['cards'] as List<dynamic>)
        .map((card) => PollSummary.fromJson(card as Map<String, dynamic>))
        .toList();
    final api = _FakePollsApiClient(initialPolls: polls);

    expect(polls.map((poll) => poll.votesCount).toList(),
        [9, 10, 99, 100, 0, 999, 1000, 10]);
    expect(
        (fixture['cursorPages'] as List<dynamic>)
            .map((page) =>
                (page as Map<String, dynamic>)['pollIds'] as List<dynamic>)
            .map((ids) => ids.length)
            .toList(),
        [2, 3]);
    expect(polls.map((poll) => poll.imageUrl == null).toList(),
        [true, false, false, false, true, true, true, true]);

    await tester.pumpWidget(
      MaterialApp(
        home: FeedScreen(
          session: _session,
          pollsApiClient: api,
          realtimeClient: _FakeRealtimeClient(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text(polls.first.question), 240);

    final question = tester.widget<Text>(find.text(polls.first.question));
    expect(question.maxLines, 3);
    expect(question.overflow, TextOverflow.ellipsis);
    expect(api.listPollsCalls, 1);
  });

  testWidgets('opens SearchScreen with the current session', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: FeedScreen(
          session: _session,
          pollsApiClient: _FakePollsApiClient(initialPolls: const []),
          realtimeClient: _FakeRealtimeClient(),
          searchApiClient: _FakeSearchApiClient(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('Search'));
    await tester.pumpAndSettle();

    expect(find.byType(SearchScreen), findsOneWidget);
    expect(find.byType(TextField), findsOneWidget);
  });

  testWidgets('ties share medal colors and zero-vote options stay readable', (
    tester,
  ) async {
    const navy = Color(0xFF00104F);

    final poll = PollSummary(
      id: 'ranked-poll',
      author: const PollAuthorSummary(
        id: 'author-1',
        username: 'author',
        displayName: 'Author',
      ),
      question: 'Which option wins?',
      options: const [
        PollOptionSummary(
          id: 'option-1',
          text: 'First',
          position: 0,
          votesCount: 5,
        ),
        PollOptionSummary(
          id: 'option-2',
          text: 'Tied first',
          position: 1,
          votesCount: 5,
        ),
        PollOptionSummary(
          id: 'option-3',
          text: 'Second',
          position: 2,
          votesCount: 2,
        ),
        PollOptionSummary(
          id: 'option-4',
          text: 'No votes',
          position: 3,
          votesCount: 0,
        ),
      ],
      votesCount: 12,
      commentsCount: 0,
      likesCount: 0,
      viewerHasLiked: false,
      createdAt: DateTime(2026, 7, 17, 12),
    );

    await tester.pumpWidget(MaterialApp(home: PollCard(poll: poll)));
    await tester.pumpAndSettle();

    final progressValues = tester
        .widgetList<LinearProgressIndicator>(
          find.byType(LinearProgressIndicator),
        )
        .map((progress) => progress.value)
        .toList();

    expect(progressValues, containsAllInOrder([5 / 12, 5 / 12, 2 / 12, 0]));
    expect(
      tester.widget<Text>(find.text('No votes')).style?.color,
      const Color(0xFF566A9D),
    );
  });

  testWidgets('updates vote counts without reloading the feed', (tester) async {
    final poll = _poll(
      viewerHasLiked: false,
      likesCount: 3,
    );
    final votedPoll = _poll(
      viewerHasLiked: false,
      likesCount: 3,
      votesCount: 4,
      firstOptionVotes: 3,
      secondOptionVotes: 1,
      votedOptionIndex: 0,
    );
    final pollsApiClient = _FakePollsApiClient(
      initialPolls: [poll],
      votedPoll: votedPoll,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: FeedScreen(
          session: _session,
          pollsApiClient: pollsApiClient,
          realtimeClient: _FakeRealtimeClient(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('67%'), findsOneWidget);
    await tester.tap(find.text('Likes').first);
    await tester.pumpAndSettle();

    expect(pollsApiClient.voteCalls, 1);
    expect(pollsApiClient.listPollsCalls, 1);
    expect(find.text('4 votes'), findsOneWidget);
    expect(find.text('75%'), findsOneWidget);
  });

  testWidgets('does not allow selecting another option after voting',
      (tester) async {
    final poll = _poll(
      viewerHasLiked: false,
      likesCount: 3,
      votedOptionIndex: 0,
    );
    final pollsApiClient = _FakePollsApiClient(initialPolls: [poll]);

    await tester.pumpWidget(
      MaterialApp(
        home: FeedScreen(
          session: _session,
          pollsApiClient: pollsApiClient,
          realtimeClient: _FakeRealtimeClient(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Comments'));
    await tester.pumpAndSettle();

    expect(pollsApiClient.voteCalls, 0);
  });

  testWidgets('updates poll card after like response', (tester) async {
    final poll = _poll(viewerHasLiked: false, likesCount: 3);
    final updatedPoll = _poll(viewerHasLiked: true, likesCount: 4);
    final pollsApiClient = _FakePollsApiClient(
      initialPolls: [poll],
      likedPoll: updatedPoll,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: FeedScreen(
          session: _session,
          pollsApiClient: pollsApiClient,
          realtimeClient: _FakeRealtimeClient(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('3'), findsOneWidget);
    expect(find.byIcon(Icons.favorite_border), findsOneWidget);

    await tester.tap(find.byIcon(Icons.favorite_border));
    await tester.pumpAndSettle();

    expect(pollsApiClient.likeCalls, 1);
    expect(pollsApiClient.listPollsCalls, 1);
    expect(find.text('4'), findsOneWidget);
    expect(find.byIcon(Icons.favorite), findsOneWidget);
  });

  testWidgets('blocks repeated likes while the first request is pending',
      (tester) async {
    final poll = _poll(viewerHasLiked: false, likesCount: 3);
    final likeResponse = Completer<PollSummary>();
    final pollsApiClient = _FakePollsApiClient(
      initialPolls: [poll],
      likeResponse: likeResponse.future,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: FeedScreen(
          session: _session,
          pollsApiClient: pollsApiClient,
          realtimeClient: _FakeRealtimeClient(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final likeAction = find.byTooltip('Like');
    await tester.tap(likeAction);
    await tester.pump();
    expect(pollsApiClient.likeCalls, 1);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    // The pending state replaces the Like action with a progress indicator,
    // so there is no second actionable control to tap.
    expect(likeAction, findsNothing);
    expect(pollsApiClient.likeCalls, 1);

    likeResponse.complete(_poll(viewerHasLiked: true, likesCount: 4));
    await tester.pumpAndSettle();
  });
  testWidgets('shows an error when liking fails', (tester) async {
    final poll = _poll(viewerHasLiked: false, likesCount: 3);
    final pollsApiClient = _FakePollsApiClient(
      initialPolls: [poll],
      likeError: const PollsApiException('Could not like poll.'),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: FeedScreen(
          session: _session,
          pollsApiClient: pollsApiClient,
          realtimeClient: _FakeRealtimeClient(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.favorite_border));
    await tester.pump();

    expect(pollsApiClient.likeCalls, 1);
    expect(find.text('Could not like poll.'), findsOneWidget);
    expect(find.text('3'), findsOneWidget);
    expect(find.byIcon(Icons.favorite_border), findsOneWidget);
  });

  testWidgets('opens comments from poll card comment metric', (tester) async {
    final poll = _poll(
      viewerHasLiked: false,
      likesCount: 3,
      commentsCount: 1,
    );
    final pollsApiClient = _FakePollsApiClient(
      initialPolls: [poll],
      comments: [_comment()],
    );

    await tester.pumpWidget(
      MaterialApp(
        home: FeedScreen(
          session: _session,
          pollsApiClient: pollsApiClient,
          realtimeClient: _FakeRealtimeClient(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.mode_comment_outlined));
    await tester.pumpAndSettle();

    expect(find.text('Comments'), findsWidgets);
    expect(find.text('Which feature should we build next?'), findsOneWidget);
    expect(find.text('A useful comment.'), findsOneWidget);
    expect(find.text('Commenter'), findsOneWidget);
  });

  testWidgets('updates comments count after returning from comments', (
    tester,
  ) async {
    final poll = _poll(
      viewerHasLiked: false,
      likesCount: 3,
      commentsCount: 0,
    );
    final pollsApiClient = _FakePollsApiClient(
      initialPolls: [poll],
      comments: const [],
      createCommentResult: _createCommentResult,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: FeedScreen(
          session: _session,
          pollsApiClient: pollsApiClient,
          realtimeClient: _FakeRealtimeClient(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('0'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.mode_comment_outlined));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'A useful comment.');
    await tester.tap(find.byTooltip('Post comment'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Back'));
    await tester.pumpAndSettle();

    expect(find.text('1'), findsOneWidget);
  });
}

const _session = AuthSession(
  user: AuthUser(
    id: 'user-1',
    email: 'ada@example.com',
    username: 'ada',
    status: 'active',
    profile: AuthUserProfile(
      displayName: 'Ada',
      pollsCount: 1,
      followersCount: 0,
      followingCount: 0,
    ),
  ),
  accessToken: 'access-token',
  tokenType: 'Bearer',
  expiresIn: '15m',
);

PollStateStore _seedPollStore(PollSummary poll) {
  final store = PollStateStore(viewerId: _session.user.id);
  store.ingest(
    poll,
    PollIngress(
      origin: PollOrigin.http,
      sessionEpoch: store.sessionEpoch,
      viewerId: _session.user.id,
      expectedPollId: null,
      requestId: 'feed-test-initial',
      startedGeneration: store.generationFor(poll.id),
    ),
  );
  return store;
}

Widget _feedWithStore(
  PollsApiClient api,
  RealtimeClient realtime,
  PollStateStore store, {
  TextScaler? textScaler,
}) =>
    MaterialApp(
      builder: (context, child) => textScaler == null
          ? child!
          : MediaQuery(
              data: MediaQuery.of(context).copyWith(textScaler: textScaler),
              child: child!,
            ),
      home: PollStateScope(
        store: store,
        child: FeedScreen(
          session: _session,
          pollsApiClient: api,
          realtimeClient: realtime,
        ),
      ),
    );

Map<String, dynamic> _reactionFields(PollSummary poll) => {
      'votesCount': poll.votesCount,
      'optionVotes': poll.options.map((option) => option.votesCount).toList(),
      'viewerVoteOptionId': poll.viewerVoteOptionId,
      'likesCount': poll.likesCount,
      'viewerHasLiked': poll.viewerHasLiked,
    };

PollSummary _poll({
  required bool viewerHasLiked,
  required int likesCount,
  int commentsCount = 0,
  int votesCount = 3,
  int firstOptionVotes = 2,
  int secondOptionVotes = 1,
  int? votedOptionIndex,
}) {
  return PollSummary(
    id: 'poll-1',
    author: const PollAuthorSummary(
      id: 'author-1',
      username: 'author',
      displayName: 'Author',
    ),
    question: 'Which feature should we build next?',
    options: [
      PollOptionSummary(
        id: 'option-1',
        text: 'Likes',
        position: 0,
        votesCount: firstOptionVotes,
      ),
      PollOptionSummary(
        id: 'option-2',
        text: 'Comments',
        position: 1,
        votesCount: secondOptionVotes,
      ),
    ],
    votesCount: votesCount,
    commentsCount: commentsCount,
    likesCount: likesCount,
    viewerHasLiked: viewerHasLiked,
    createdAt: DateTime(2026, 7, 17, 12),
    votedOptionIndex: votedOptionIndex,
  );
}

PollCommentSummary _comment() {
  return PollCommentSummary(
    id: 'comment-1',
    pollId: 'poll-1',
    author: const PollAuthorSummary(
      id: 'commenter-1',
      username: 'commenter',
      displayName: 'Commenter',
    ),
    body: 'A useful comment.',
    likesCount: 0,
    createdAt: DateTime(2026, 7, 17, 12, 1),
    updatedAt: DateTime(2026, 7, 17, 12, 1),
  );
}

final _updatedPollWithComment = PollSummary(
  id: 'poll-1',
  author: const PollAuthorSummary(
    id: 'author-1',
    username: 'author',
    displayName: 'Author',
  ),
  question: 'Which feature should we build next?',
  options: const [
    PollOptionSummary(
      id: 'option-1',
      text: 'Likes',
      position: 0,
      votesCount: 2,
    ),
    PollOptionSummary(
      id: 'option-2',
      text: 'Comments',
      position: 1,
      votesCount: 1,
    ),
  ],
  votesCount: 3,
  commentsCount: 1,
  likesCount: 3,
  viewerHasLiked: false,
  createdAt: DateTime(2026, 7, 17, 12),
);

final _createCommentResult = CreatePollCommentResult(
  comment: _comment(),
  poll: _updatedPollWithComment,
);

Map<String, dynamic> _readT02Fixture() {
  return jsonDecode(
    File('../../test/fixtures/t02-motion-scroll-loading-polls.json')
        .readAsStringSync(),
  ) as Map<String, dynamic>;
}

class _FakePollsApiClient extends PollsApiClient {
  _FakePollsApiClient({
    required this.initialPolls,
    this.comments = const [],
    this.createCommentResult,
    this.likedPoll,
    this.votedPoll,
    this.likeError,
    this.likeResponse,
    this.voteResponse,
    this.refreshResponse,
  });

  final List<PollSummary> initialPolls;
  final List<PollCommentSummary> comments;
  final CreatePollCommentResult? createCommentResult;
  final PollSummary? likedPoll;
  final PollSummary? votedPoll;
  final PollsApiException? likeError;
  final Future<PollSummary>? likeResponse;
  final Future<PollSummary>? voteResponse;
  final Future<List<PollSummary>>? refreshResponse;
  final responseOrder = <String>[];
  int likeCalls = 0;
  int voteCalls = 0;
  int listPollsCalls = 0;

  @override
  Future<List<PollSummary>> listPolls({
    int limit = 20,
    String? accessToken,
    String sort = 'newest',
  }) async {
    listPollsCalls++;
    if (listPollsCalls > 1 && refreshResponse != null) return refreshResponse!;
    return initialPolls;
  }

  @override
  Future<PollSummary> vote({
    required String pollId,
    required String optionId,
    required String accessToken,
  }) async {
    voteCalls++;
    responseOrder.add('vote-start');
    final result = voteResponse == null ? votedPoll! : await voteResponse!;
    responseOrder.add('vote-finish');
    return result;
  }

  @override
  Future<PollSummary> likePoll({
    required String pollId,
    required String accessToken,
  }) async {
    likeCalls++;
    responseOrder.add('like-start');
    final likeError = this.likeError;

    if (likeError != null) {
      throw likeError;
    }

    final likeResponse = this.likeResponse;
    if (likeResponse != null) {
      final result = await likeResponse;
      responseOrder.add('like-finish');
      return result;
    }

    responseOrder.add('like-finish');
    return likedPoll!;
  }

  @override
  Future<List<PollCommentSummary>> listComments({
    required String pollId,
    int limit = 50,
    String? accessToken,
  }) async {
    return comments;
  }

  @override
  Future<CreatePollCommentResult> createComment({
    required String pollId,
    required String body,
    required String accessToken,
    String? parentCommentId,
  }) async {
    return createCommentResult!;
  }

  @override
  void close() {}
}

class _FakeSearchApiClient extends SearchApiClient {
  @override
  void close() {}
}

class _FakeRealtimeClient extends RealtimeClient {
  final _controller = StreamController<PollVoteRealtimeEvent>.broadcast();
  void injectVote(PollSummary poll) =>
      _controller.add(PollVoteRealtimeEvent(poll: poll));

  @override
  Stream<PollVoteRealtimeEvent> get pollVotes => _controller.stream;

  @override
  void connect() {}

  @override
  Future<void> close() async {
    await _controller.close();
  }
}
