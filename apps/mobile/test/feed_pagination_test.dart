import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/core/pagination/cursor_page.dart';
import 'package:yaskapp_mobile/src/features/auth/auth_session.dart';
import 'package:yaskapp_mobile/src/features/feed/feed_screen.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_state_scope.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_state_store.dart';
import 'package:yaskapp_mobile/src/features/polls/polls_api_client.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_summary.dart';
import 'package:yaskapp_mobile/src/features/realtime/realtime_client.dart';
import 'package:yaskapp_mobile/src/features/subscriptions/subscriptions_screen.dart';

void main() {
  testWidgets('Feed requests a second page with its opaque cursor',
      (tester) async {
    final first = _poll(1);
    final second = _poll(2);
    final api = _PageApi(
      feedPages: [
        Future.value(CursorPage(
          items: [first],
          nextCursor: 'opaque-next',
        )),
        Future.value(CursorPage(items: [second], nextCursor: null)),
      ],
    );
    final realtime = _FakeRealtimeClient();
    addTearDown(realtime.close);

    await tester.pumpWidget(_feedApp(api, realtime));
    await tester.pumpAndSettle();

    expect(find.byKey(ValueKey('poll-${first.id}')), findsOneWidget);
    expect(find.byKey(ValueKey('poll-${second.id}')), findsOneWidget);
    expect(api.feedCursors, [null, 'opaque-next']);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a failed append keeps page one visible and retries its cursor',
      (tester) async {
    final failedAppend = Completer<CursorPage<PollSummary>>();
    final first = _poll(1);
    final second = _poll(2);
    final api = _PageApi(
      feedPages: [
        Future.value(CursorPage(items: [first], nextCursor: 'cursor-2')),
        failedAppend.future,
        Future.value(CursorPage(items: [second], nextCursor: null)),
      ],
    );
    final realtime = _FakeRealtimeClient();
    addTearDown(realtime.close);

    await tester.pumpWidget(_feedApp(api, realtime));
    await tester.pump();
    await tester.pump();
    failedAppend.completeError(StateError('offline'));
    await tester.pumpAndSettle();

    expect(find.byKey(ValueKey('poll-${first.id}')), findsOneWidget);
    expect(find.text('Could not load more.'), findsOneWidget);
    expect(api.feedCursors, [null, 'cursor-2']);

    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();

    expect(find.byKey(ValueKey('poll-${first.id}')), findsOneWidget);
    expect(find.byKey(ValueKey('poll-${second.id}')), findsOneWidget);
    expect(api.feedCursors, [null, 'cursor-2', 'cursor-2']);
  });

  testWidgets('empty feed and an exhausted non-empty feed have distinct states',
      (tester) async {
    final emptyApi = _PageApi(
      feedPages: [Future.value(const CursorPage(items: [], nextCursor: null))],
    );
    final emptyRealtime = _FakeRealtimeClient();
    addTearDown(emptyRealtime.close);

    await tester.pumpWidget(_feedApp(emptyApi, emptyRealtime));
    await tester.pumpAndSettle();

    expect(find.text('No polls yet'), findsOneWidget);
    expect(find.text("You're all caught up."), findsNothing);

    await tester.pumpWidget(const SizedBox.shrink());
    final poll = _poll(3);
    final endApi = _PageApi(
      feedPages: [
        Future.value(CursorPage(items: [poll], nextCursor: null))
      ],
    );
    final endRealtime = _FakeRealtimeClient();
    addTearDown(endRealtime.close);

    await tester.pumpWidget(_feedApp(endApi, endRealtime));
    await tester.pumpAndSettle();

    expect(find.byKey(ValueKey('poll-${poll.id}')), findsOneWidget);
    expect(find.text("You're all caught up."), findsOneWidget);
  });

  testWidgets('a short-page scroll storm starts only one append at a time',
      (tester) async {
    final append = Completer<CursorPage<PollSummary>>();
    final api = _PageApi(
      feedPages: [
        Future.value(CursorPage(
          items: List.generate(20, _poll),
          nextCursor: 'cursor-2',
        )),
        append.future,
        Future.value(const CursorPage(items: [], nextCursor: null)),
      ],
    );
    final realtime = _FakeRealtimeClient();
    addTearDown(realtime.close);

    await tester.pumpWidget(_feedApp(api, realtime));
    await tester.pumpAndSettle();
    final list = find.byType(CustomScrollView);
    await tester.fling(list, const Offset(0, -4000), 10000);
    await tester.pump(const Duration(milliseconds: 50));
    await tester.fling(list, const Offset(0, -4000), 10000);
    await tester.pump(const Duration(milliseconds: 50));
    await tester.drag(list, const Offset(0, -1000));
    await tester.pump();

    expect(
        api.feedCursors.where((cursor) => cursor == 'cursor-2'), hasLength(1));

    append.complete(const CursorPage(items: [], nextCursor: null));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('automatic loading stops after three pages until manual action',
      (tester) async {
    final api = _PageApi(
      feedPages: [
        Future.value(const CursorPage(items: [], nextCursor: 'cursor-2')),
        Future.value(const CursorPage(items: [], nextCursor: 'cursor-3')),
        Future.value(const CursorPage(items: [], nextCursor: 'cursor-4')),
        Future.value(const CursorPage(items: [], nextCursor: 'cursor-5')),
        Future.value(CursorPage(items: [_poll(5)], nextCursor: null)),
      ],
    );
    final realtime = _FakeRealtimeClient();
    addTearDown(realtime.close);

    await tester.pumpWidget(_feedApp(api, realtime));
    await tester.pumpAndSettle();

    expect(api.feedCursors, [null, 'cursor-2', 'cursor-3', 'cursor-4']);
    expect(find.text('Load more'), findsOneWidget);
    await tester.tap(find.text('Load more'));
    await tester.pumpAndSettle();

    expect(api.feedCursors,
        [null, 'cursor-2', 'cursor-3', 'cursor-4', 'cursor-5']);
    expect(find.byKey(const ValueKey('poll-poll-feed-5')), findsOneWidget);
  });

  testWidgets('Following invalidation refreshes only its own retained list',
      (tester) async {
    final followingOne = _poll(101);
    final followingTwo = _poll(102);
    final feedPoll = _poll(1);
    final api = _PageApi(
      feedPages: [
        Future.value(CursorPage(items: [feedPoll], nextCursor: null))
      ],
      subscriptionPages: [
        Future.value(CursorPage(items: [followingOne], nextCursor: null)),
        Future.value(CursorPage(items: [followingTwo], nextCursor: null)),
        Future.value(CursorPage(items: [_poll(103)], nextCursor: null)),
      ],
    );
    final realtime = _FakeRealtimeClient();
    final store = PollStateStore(viewerId: _session.user.id);
    final selectedTab = ValueNotifier<int>(0);
    addTearDown(realtime.close);
    addTearDown(store.dispose);
    addTearDown(selectedTab.dispose);

    await tester.pumpWidget(MaterialApp(
      home: PollStateScope(
        store: store,
        child: Scaffold(
          body: ValueListenableBuilder<int>(
            valueListenable: selectedTab,
            builder: (context, active, _) => IndexedStack(
              index: active,
              children: [
                FeedScreen(
                  key: const ValueKey('feed'),
                  session: _session,
                  pollsApiClient: api,
                  realtimeClient: realtime,
                  isActive: active == 0,
                ),
                SubscriptionsScreen(
                  key: const ValueKey('following'),
                  session: _session,
                  pollsApiClient: api,
                  realtimeClient: realtime,
                  isActive: active == 1,
                ),
              ],
            ),
          ),
        ),
      ),
    ));
    await tester.pumpAndSettle();

    selectedTab.value = 1;
    await tester.pumpAndSettle();
    expect(api.feedCursors, [null]);
    expect(api.subscriptionCursors, [null]);
    expect(find.byKey(ValueKey('poll-${followingOne.id}')), findsOneWidget);

    store.markFollowingMembershipChanged();
    await tester.pumpAndSettle();

    expect(api.feedCursors, [null]);
    expect(api.subscriptionCursors, [null, null]);
    expect(find.byKey(ValueKey('poll-${followingTwo.id}')), findsOneWidget);

    selectedTab.value = 0;
    await tester.pumpAndSettle();
    expect(api.feedCursors, [null]);
    expect(find.byKey(ValueKey('poll-${feedPoll.id}')), findsOneWidget);

    store.markFollowingMembershipChanged();
    await tester.pumpAndSettle();
    expect(api.subscriptionCursors, [null, null]);
    expect(api.feedCursors, [null]);

    selectedTab.value = 1;
    await tester.pumpAndSettle();
    expect(api.subscriptionCursors, [null, null, null]);
    expect(find.byKey(const ValueKey('poll-poll-feed-103')), findsOneWidget);
  });

  testWidgets(
      'queues a second Following refresh if membership changes in flight',
      (tester) async {
    final pendingRefresh = Completer<CursorPage<PollSummary>>();
    final api = _PageApi(
      subscriptionPages: [
        Future.value(CursorPage(items: [_poll(201)], nextCursor: null)),
        pendingRefresh.future,
        Future.value(CursorPage(items: [_poll(203)], nextCursor: null)),
      ],
    );
    final realtime = _FakeRealtimeClient();
    final store = PollStateStore(viewerId: _session.user.id);
    addTearDown(realtime.close);
    addTearDown(store.dispose);

    await tester.pumpWidget(MaterialApp(
      home: PollStateScope(
        store: store,
        child: SubscriptionsScreen(
          session: _session,
          pollsApiClient: api,
          realtimeClient: realtime,
        ),
      ),
    ));
    await tester.pumpAndSettle();

    store.markFollowingMembershipChanged();
    await tester.pump();
    store.markFollowingMembershipChanged();
    await tester.pump();
    expect(api.subscriptionCursors, [null, null]);

    pendingRefresh.complete(CursorPage(items: [_poll(202)], nextCursor: null));
    await tester.pumpAndSettle();

    expect(api.subscriptionCursors, [null, null, null]);
    expect(find.byKey(ValueKey('poll-${_poll(203).id}')), findsOneWidget);
  });
}

Widget _feedApp(_PageApi api, RealtimeClient realtime) => MaterialApp(
      home: FeedScreen(
        session: _session,
        pollsApiClient: api,
        realtimeClient: realtime,
      ),
    );

PollSummary _poll(int id) => PollSummary(
      id: 'poll-feed-$id',
      author: const PollAuthorSummary(
        id: 'author-1',
        username: 'ada',
        displayName: 'Ada',
      ),
      question: 'Pagination poll $id',
      options: const [
        PollOptionSummary(
          id: 'option-1',
          text: 'First option',
          position: 0,
          votesCount: 0,
        ),
        PollOptionSummary(
          id: 'option-2',
          text: 'Second option',
          position: 1,
          votesCount: 0,
        ),
      ],
      votesCount: 0,
      commentsCount: 0,
      likesCount: 0,
      viewerHasLiked: false,
      createdAt: DateTime(2026, 10, 19),
    );

class _PageApi extends PollsApiClient {
  _PageApi({
    this.feedPages = const [],
    this.subscriptionPages = const [],
  });

  final List<Future<CursorPage<PollSummary>>> feedPages;
  final List<Future<CursorPage<PollSummary>>> subscriptionPages;
  final List<String?> feedCursors = [];
  final List<String?> subscriptionCursors = [];

  @override
  Future<CursorPage<PollSummary>> listPollsPage({
    int limit = 20,
    String sort = 'newest',
    String? cursor,
    String? accessToken,
  }) {
    feedCursors.add(cursor);
    return feedPages[feedCursors.length - 1];
  }

  @override
  Future<CursorPage<PollSummary>> listSubscriptionsPage({
    required String accessToken,
    int limit = 20,
    String? cursor,
  }) {
    subscriptionCursors.add(cursor);
    return subscriptionPages[subscriptionCursors.length - 1];
  }

  @override
  void close() {}
}

class _FakeRealtimeClient extends RealtimeClient {
  @override
  Stream<PollVoteRealtimeEvent> get pollVotes => const Stream.empty();

  @override
  Stream<PollDeletedRealtimeEvent> get pollDeletions => const Stream.empty();

  @override
  void connect() {}

  @override
  Future<void> close() async {}
}

const _session = AuthSession(
  user: AuthUser(
    id: 'viewer-1',
    email: 'viewer@example.com',
    username: 'viewer',
    status: 'active',
    profile: AuthUserProfile(
      displayName: 'Viewer',
      pollsCount: 0,
      followersCount: 0,
      followingCount: 1,
    ),
  ),
  accessToken: 'access-token',
  tokenType: 'Bearer',
  expiresIn: 'test',
);
