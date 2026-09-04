import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/core/analytics/search_analytics.dart';
import 'package:yaskapp_mobile/src/features/auth/auth_session.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_summary.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_card.dart';
import 'package:yaskapp_mobile/src/features/polls/polls_api_client.dart';
import 'package:yaskapp_mobile/src/features/profile/public_profile.dart';
import 'package:yaskapp_mobile/src/features/profile/profiles_api_client.dart';
import 'package:yaskapp_mobile/src/features/search/search_api_client.dart';
import 'package:yaskapp_mobile/src/features/search/search_history.dart';
import 'package:yaskapp_mobile/src/features/search/search_result.dart';
import 'package:yaskapp_mobile/src/features/search/search_screen.dart';

void main() {
  testWidgets('shows discovery sections before a query is entered',
      (tester) async {
    await tester.pumpWidget(_app(_FakeSearchApiClient(),
        pollsApiClient: _FakePollsApiClient(PollSummaryFixture.poll)));
    await tester.pump();

    expect(find.text('Recent searches'), findsOneWidget);
    expect(find.text('Explore popular searches'), findsOneWidget);
    expect(find.text('Top users'), findsOneWidget);
    expect(find.text('Top polls'), findsOneWidget);
    expect(find.text('Find something interesting'), findsOneWidget);
    expect(find.text('Formula 1'), findsOneWidget);
    expect(find.text('Which feature should be next?'), findsOneWidget);
  });

  testWidgets(
      'shows the latest successful searches in reverse chronological order',
      (tester) async {
    final history = MemorySearchHistoryStore();
    final client = _FakeSearchApiClient();
    await tester.pumpWidget(_app(client, searchHistory: history));

    await tester.enterText(find.byType(TextField), 'climate');
    await tester.pumpAndSettle(const Duration(milliseconds: 500));
    await tester.enterText(find.byType(TextField), 'movies');
    await tester.pumpAndSettle(const Duration(milliseconds: 500));
    await tester.enterText(find.byType(TextField), 'climate');
    await tester.pumpAndSettle(const Duration(milliseconds: 500));
    await tester.tap(find.byTooltip('Clear'));
    await tester.pump();

    final climate = tester.getTopLeft(find.text('climate'));
    final movies = tester.getTopLeft(find.text('movies'));
    expect(climate.dy, lessThan(movies.dy));
    expect(find.text('Programming'), findsNothing);
  });

  test('persists and clears recent searches', () async {
    final history = MemorySearchHistoryStore();

    await history.add('  climate   change ');
    await history.add('movies');
    await history.add('climate change');

    expect(await history.read(), ['climate change', 'movies']);
    await history.clear();
    expect(await history.read(), isEmpty);
  });

  testWidgets('clears the query from the search bar', (tester) async {
    await tester.pumpWidget(_app(_FakeSearchApiClient()));

    await tester.enterText(find.byType(TextField), 'climate');
    await tester.pump();
    await tester.tap(find.byTooltip('Clear'));
    await tester.pump();

    expect(find.byType(TextField), findsOneWidget);
    expect(find.text('Search polls and users'), findsOneWidget);
    expect(find.byTooltip('Clear'), findsNothing);
  });

  testWidgets('focuses search input and does not request for a short query',
      (tester) async {
    final client = _FakeSearchApiClient();
    await tester.pumpWidget(_app(client));

    expect(find.byType(TextField), findsOneWidget);
    expect(tester.binding.focusManager.primaryFocus, isNotNull);

    await tester.enterText(find.byType(TextField), 'a');
    await tester.pump(const Duration(milliseconds: 500));

    expect(client.calls, isEmpty);
    expect(find.text('Enter at least 2 characters to search.'), findsOneWidget);
  });

  testWidgets('debounces valid input and renders mixed results',
      (tester) async {
    final client = _FakeSearchApiClient(
      pages: [
        SearchPage(items: [_pollResult(), _userResult()], nextCursor: null),
      ],
    );
    await tester.pumpWidget(_app(client));

    await tester.enterText(find.byType(TextField), 'climate');
    await tester.pump(const Duration(milliseconds: 399));
    expect(client.calls, isEmpty);
    await tester.pump(const Duration(milliseconds: 1));
    await tester.pump();

    expect(client.calls.single.query, 'climate');
    expect(find.text('Climate?'), findsOneWidget);
    expect(find.text('@ada'), findsOneWidget);
  });

  testWidgets('does not run a second search after submitting debounced input',
      (tester) async {
    final client = _FakeSearchApiClient(
      pages: [
        const SearchPage(items: [], nextCursor: null),
        const SearchPage(items: [], nextCursor: null),
      ],
    );
    await tester.pumpWidget(_app(client));

    await tester.enterText(find.byType(TextField), 'climate');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(client.calls, hasLength(1));
  });

  testWidgets('records result click only after tapping a result',
      (tester) async {
    final analytics = _RecordingSearchAnalytics();
    final client = _FakeSearchApiClient(
      pages: [
        SearchPage(items: [_userResult()], nextCursor: null)
      ],
    );
    await tester.pumpWidget(_app(client, analytics: analytics));

    await tester.enterText(find.byType(TextField), 'climate');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump();

    expect(analytics.resultClicks, isEmpty);
    await tester.tap(find.text('@ada'));
    expect(analytics.resultClicks, [(resultType: 'user', position: 0)]);
  });

  testWidgets('wires poll voting actions from search results', (tester) async {
    final pollsClient = _FakePollsApiClient(PollSummaryFixture.poll);
    final client = _FakeSearchApiClient(
      pages: [
        SearchPage(items: [_pollResult()], nextCursor: null)
      ],
    );
    await tester.pumpWidget(
      _app(client, pollsApiClient: pollsClient),
    );

    await tester.enterText(find.byType(TextField), 'climate');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump();
    await tester.tap(find.text('Yes'));
    await tester.pump();

    expect(pollsClient.votedOptionId, 'option-1');
  });

  testWidgets('opens the full poll card in a modal when tapping a poll result',
      (tester) async {
    final client = _FakeSearchApiClient(
      pages: [
        SearchPage(items: [_pollResult()], nextCursor: null)
      ],
    );
    await tester.pumpWidget(_app(client));

    await tester.enterText(find.byType(TextField), 'climate');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump();

    await tester.tap(find.text('Climate?'));
    await tester.pumpAndSettle();

    expect(find.byType(Dialog), findsOneWidget);
    expect(find.byType(PollCard), findsNWidgets(2));
    expect(find.text('Poll details'), findsOneWidget);
  });

  testWidgets('allows voting from the poll preview modal', (tester) async {
    final pollsClient = _FakePollsApiClient(PollSummaryFixture.poll);
    final client = _FakeSearchApiClient(
      pages: [
        SearchPage(items: [_pollResult()], nextCursor: null)
      ],
    );
    await tester.pumpWidget(
      _app(client, pollsApiClient: pollsClient),
    );

    await tester.enterText(find.byType(TextField), 'climate');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump();
    await tester.tap(find.text('Climate?'));
    await tester.pumpAndSettle();

    await tester.tap(
      find.descendant(of: find.byType(Dialog), matching: find.text('Yes')),
    );
    await tester.pump();

    expect(pollsClient.votedOptionId, 'option-1');
  });

  testWidgets('opens the preview when tapping a top poll', (tester) async {
    await tester.pumpWidget(
      _app(
        _FakeSearchApiClient(),
        pollsApiClient: _FakePollsApiClient(PollSummaryFixture.poll),
      ),
    );
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Climate?'));
    await tester.tap(find.text('Climate?'));
    await tester.pumpAndSettle();

    expect(find.byType(Dialog), findsOneWidget);
    expect(find.text('Poll details'), findsOneWidget);
  });

  testWidgets('shows empty and retryable error states', (tester) async {
    final client = _FakeSearchApiClient(
      pages: [
        const SearchApiException('Network unavailable.'),
        const SearchPage(items: [], nextCursor: null),
      ],
    );
    await tester.pumpWidget(_app(client));

    await tester.enterText(find.byType(TextField), 'missing');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump();
    expect(find.text('Could not complete search.'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);

    await tester.tap(find.text('Retry'));
    await tester.pump();
    expect(find.text('No results found.'), findsOneWidget);
  });

  testWidgets('shows a useful API error message when search fails',
      (tester) async {
    final client = _FakeSearchApiClient(
      pages: [
        const SearchApiException('Search service is unavailable.'),
      ],
    );
    await tester.pumpWidget(_app(client));

    await tester.enterText(find.byType(TextField), 'missing');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump();

    expect(find.text('Search service is unavailable.'), findsOneWidget);
  });

  testWidgets('ignores an in-flight response after the query is cleared',
      (tester) async {
    final pending = Completer<SearchPage>();
    final client = _FakeSearchApiClient(pending: pending);
    await tester.pumpWidget(_app(client));

    await tester.enterText(find.byType(TextField), 'climate');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump();

    await tester.enterText(find.byType(TextField), 'a');
    await tester.pump();
    pending.complete(
      SearchPage(items: [_pollResult()], nextCursor: null),
    );
    await tester.pump();

    expect(find.text('Climate?'), findsNothing);
    expect(find.text('Enter at least 2 characters to search.'), findsOneWidget);
  });

  testWidgets('filter changes preserve query and reset pagination',
      (tester) async {
    final client = _FakeSearchApiClient(
      pages: [
        SearchPage(items: [_pollResult()], nextCursor: 'next'),
        const SearchPage(items: [], nextCursor: null),
      ],
    );
    await tester.pumpWidget(_app(client));

    await tester.enterText(find.byType(TextField), 'climate');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Polls'));
    await tester.pumpAndSettle();

    expect(client.calls.last.type, SearchType.polls);
    expect(client.calls.last.query, 'climate');
    expect(client.calls.last.cursor, isNull);
  });
}

Widget _app(
  SearchApiClient client, {
  SearchAnalytics? analytics,
  PollsApiClient? pollsApiClient,
  SearchHistoryStore? searchHistory,
}) {
  return MaterialApp(
    home: SearchScreen(
      session: _session(),
      searchApiClient: client,
      pollsApiClient: pollsApiClient,
      profilesApiClient: _FakeProfilesApiClient(),
      analytics: analytics,
      searchHistory: searchHistory,
    ),
  );
}

class _FakeProfilesApiClient extends ProfilesApiClient {
  @override
  Future<List<PublicProfile>> listPopularUsers({
    String? accessToken,
    int limit = 3,
  }) async {
    return const [PublicProfileFixture.profile];
  }
}

AuthSession _session() {
  return const AuthSession(
    user: AuthUser(
      id: 'current-user',
      email: 'user@example.com',
      username: 'current',
      status: 'active',
      profile: AuthUserProfile(
        displayName: 'Current User',
        pollsCount: 0,
        followersCount: 0,
        followingCount: 0,
      ),
    ),
    accessToken: 'token',
    tokenType: 'Bearer',
    expiresIn: '1h',
  );
}

PollSearchResult _pollResult() {
  return PollSearchResult(
    score: 0.9,
    poll: PollSummaryFixture.poll,
  );
}

UserSearchResult _userResult() {
  return const UserSearchResult(
    score: 0.8,
    user: PublicProfileFixture.profile,
  );
}

class _FakeSearchApiClient extends SearchApiClient {
  _FakeSearchApiClient({this.pages = const [], this.pending});

  final List<Object> pages;
  final Completer<SearchPage>? pending;
  final calls = <_SearchCall>[];
  var _index = 0;

  @override
  Future<SearchPage> search({
    required String accessToken,
    required String query,
    SearchType type = SearchType.all,
    SearchSort sort = SearchSort.relevance,
    String? cursor,
    int limit = 20,
  }) async {
    calls.add(_SearchCall(query: query, type: type, cursor: cursor));
    if (pending != null) return pending!.future;
    final page = pages.isEmpty
        ? const SearchPage(items: [], nextCursor: null)
        : pages[_index++ % pages.length];
    if (page is SearchApiException) throw page;
    return page as SearchPage;
  }
}

class _SearchCall {
  const _SearchCall(
      {required this.query, required this.type, required this.cursor});
  final String query;
  final SearchType type;
  final String? cursor;
}

class _RecordingSearchAnalytics extends SearchAnalytics {
  final resultClicks = <({String resultType, int position})>[];

  @override
  void resultClicked({required String resultType, required int position}) {
    resultClicks.add((resultType: resultType, position: position));
  }

  @override
  void searchOpened() {}

  @override
  void searchSubmitted({
    required int queryLength,
    required SearchType type,
    required SearchSort sort,
  }) {}

  @override
  void filterChanged({required SearchType type, required SearchSort sort}) {}

  @override
  void empty({
    required int queryLength,
    required SearchType type,
    required SearchSort sort,
  }) {}

  @override
  void error({
    required int queryLength,
    required SearchType type,
    required SearchSort sort,
  }) {}
}

class _FakePollsApiClient extends PollsApiClient {
  _FakePollsApiClient(this.poll) : super();

  final PollSummary poll;
  String? votedOptionId;

  @override
  Future<List<PollSummary>> listPolls({
    int limit = 20,
    String? accessToken,
    String sort = 'newest',
  }) async {
    return [poll];
  }

  @override
  Future<PollSummary> vote({
    required String pollId,
    required String optionId,
    required String accessToken,
  }) async {
    votedOptionId = optionId;
    return poll.copyWith(viewerVoteOptionId: optionId);
  }
}

class PollSummaryFixture {
  static final poll = PollSummary(
    id: 'poll-1',
    author: const PollAuthorSummary(
      id: 'user-1',
      username: 'ada',
      displayName: 'Ada Lovelace',
    ),
    question: 'Climate?',
    options: const [
      PollOptionSummary(
          id: 'option-1', text: 'Yes', position: 0, votesCount: 1),
    ],
    votesCount: 1,
    commentsCount: 0,
    likesCount: 0,
    viewerHasLiked: false,
    createdAt: DateTime(2026, 8, 30),
  );
}

class PublicProfileFixture {
  static const profile = PublicProfile(
    id: 'user-2',
    username: 'ada',
    status: 'active',
    displayName: 'Ada Lovelace',
    bio: null,
    countryCode: null,
    avatarObjectKey: null,
    pollsCount: 1,
    followersCount: 2,
    followingCount: 3,
    viewerIsFollowing: false,
  );
}
