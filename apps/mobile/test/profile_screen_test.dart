import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:yaskapp_mobile/src/features/auth/auth_api_client.dart';
import 'package:yaskapp_mobile/src/features/auth/auth_session.dart';
import 'package:yaskapp_mobile/src/features/profile/profile_screen.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_summary.dart';
import 'package:yaskapp_mobile/src/features/polls/polls_api_client.dart';

void main() {
  testWidgets('profile opens a dedicated settings page',
      (tester) async {
    var loggedOut = false;

    await tester.pumpWidget(
      MaterialApp(
        home: ProfileScreen(
          user: _user,
          accessToken: 'access-token',
          authApiClient: AuthApiClient(httpClient: _NoopHttpClient()),
          onLogout: () => loggedOut = true,
          onUserUpdated: (_) {},
          pollsApiClient: _FakePollsApiClient(initialPolls: const []),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('Settings'));
    await tester.pumpAndSettle();

    expect(find.text('Settings'), findsOneWidget);
    expect(find.byType(PopupMenuItem), findsNothing);
    expect(find.text('Notifications'), findsOneWidget);
    expect(find.text('My reports'), findsOneWidget);
    expect(find.text('Logout'), findsOneWidget);
    final logoutText = tester.widget<Text>(find.text('Logout'));
    expect(logoutText.style?.color, Colors.red);

    await tester.tap(find.text('Logout'));
    await tester.pumpAndSettle();

    expect(loggedOut, isTrue);
    expect(find.text('Settings'), findsNothing);
  });

  testWidgets('refreshes my polls when requested after a new poll is created',
      (tester) async {
    final poll = _poll(commentsCount: 0, likesCount: 5, votesCount: 8);
    final newPoll = _poll(
      commentsCount: 0,
      likesCount: 1,
      votesCount: 2,
      question: 'A newly created poll',
    );
    final pollsApiClient = _FakePollsApiClient(initialPolls: [poll]);
    final profileKey = GlobalKey<ProfileScreenState>();

    await tester.pumpWidget(
      MaterialApp(
        home: ProfileScreen(
          key: profileKey,
          user: _user,
          accessToken: 'access-token',
          authApiClient: AuthApiClient(httpClient: _NoopHttpClient()),
          onLogout: () {},
          onUserUpdated: (_) {},
          pollsApiClient: pollsApiClient,
        ),
      ),
    );
    await tester.pumpAndSettle();

    pollsApiClient.initialPolls.add(newPoll);
    await profileKey.currentState!.refreshMyPolls();
    await tester.pumpAndSettle();

    expect(find.text('A newly created poll'), findsOneWidget);
  });

  testWidgets('updates my poll after like response', (tester) async {
    final poll = _poll(
      commentsCount: 0,
      likesCount: 5,
      votesCount: 8,
    );
    final likedPoll = _poll(
      commentsCount: 0,
      likesCount: 6,
      votesCount: 8,
    ).copyWith(viewerHasLiked: true);
    final pollsApiClient = _FakePollsApiClient(
      initialPolls: [poll],
      likedPoll: likedPoll,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: ProfileScreen(
          user: _user,
          accessToken: 'access-token',
          authApiClient: AuthApiClient(httpClient: _NoopHttpClient()),
          onLogout: () {},
          onUserUpdated: (_) {},
          pollsApiClient: pollsApiClient,
        ),
      ),
    );
    await tester.pump();
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.text('My polls'),
      300,
    );
    await tester.pumpAndSettle();

    expect(find.text('Which feature should we build next?'), findsOneWidget);
    expect(find.byIcon(Icons.favorite_border), findsOneWidget);

    await tester.tap(find.byTooltip('Like'));
    await tester.pumpAndSettle();

    expect(pollsApiClient.likeCalls, 1);
    expect(find.text('6'), findsOneWidget);
    expect(find.byIcon(Icons.favorite), findsOneWidget);
  });

  testWidgets(
    'updates my polls comments count after returning from comments',
    (tester) async {
      final poll = _poll(
        commentsCount: 0,
        likesCount: 5,
        votesCount: 8,
      );
      final updatedPoll = _poll(
        commentsCount: 1,
        likesCount: 5,
        votesCount: 8,
      );
      final pollsApiClient = _FakePollsApiClient(
        initialPolls: [poll],
        comments: const [],
        createCommentResult: _createCommentResult(updatedPoll),
      );

      await tester.pumpWidget(
        MaterialApp(
          home: ProfileScreen(
            user: _user,
            accessToken: 'access-token',
            authApiClient: AuthApiClient(httpClient: _NoopHttpClient()),
            onLogout: () {},
            onUserUpdated: (_) {},
            pollsApiClient: pollsApiClient,
          ),
        ),
      );
      await tester.pump();
      await tester.pumpAndSettle();

      await tester.scrollUntilVisible(
        find.text('My polls'),
        300,
      );
      await tester.pumpAndSettle();

      expect(find.text('Which feature should we build next?'), findsOneWidget);
      expect(find.text('0'), findsOneWidget);

      await tester.tap(find.byIcon(Icons.mode_comment_outlined));
      await tester.pumpAndSettle();

      expect(find.text('Comments'), findsWidgets);

      await tester.enterText(
        find.byType(TextField),
        'A useful comment.',
      );
      await tester.tap(find.byTooltip('Post comment'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Back'));
      await tester.pumpAndSettle();

      expect(find.text('1'), findsOneWidget);
    },
  );
}

const _user = AuthUser(
  id: 'user-1',
  email: 'ada@example.com',
  username: 'ada',
  status: 'active',
  profile: AuthUserProfile(
    displayName: 'Ada',
    pollsCount: 7,
    followersCount: 4,
    followingCount: 9,
  ),
);

PollSummary _poll({
  required int commentsCount,
  required int likesCount,
  required int votesCount,
  String question = 'Which feature should we build next?',
}) {
  return PollSummary(
    id: 'poll-1',
    author: const PollAuthorSummary(
      id: 'author-1',
      username: 'author',
      displayName: 'Author',
    ),
    question: question,
    options: const [
      PollOptionSummary(
        id: 'option-1',
        text: 'Likes',
        position: 0,
        votesCount: 3,
      ),
      PollOptionSummary(
        id: 'option-2',
        text: 'Comments',
        position: 1,
        votesCount: 5,
      ),
    ],
    votesCount: votesCount,
    commentsCount: commentsCount,
    likesCount: likesCount,
    viewerHasLiked: false,
    createdAt: DateTime(2026, 7, 17, 12),
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

CreatePollCommentResult _createCommentResult(PollSummary poll) {
  return CreatePollCommentResult(
    comment: _comment(),
    poll: poll,
  );
}

class _FakePollsApiClient extends PollsApiClient {
  _FakePollsApiClient({
    required this.initialPolls,
    this.comments = const [],
    this.createCommentResult,
    this.likedPoll,
  }) : super(httpClient: _NoopHttpClient());

  final List<PollSummary> initialPolls;
  final List<PollCommentSummary> comments;
  final CreatePollCommentResult? createCommentResult;
  final PollSummary? likedPoll;
  int likeCalls = 0;

  @override
  Future<List<PollSummary>> listMyPolls({
    required String accessToken,
    int limit = 20,
  }) async {
    return SynchronousFuture(initialPolls);
  }

  @override
  Future<List<PollCommentSummary>> listComments({
    required String pollId,
    int limit = 50,
  }) async {
    return SynchronousFuture(comments);
  }

  @override
  Future<PollSummary> likePoll({
    required String pollId,
    required String accessToken,
  }) async {
    likeCalls++;
    return SynchronousFuture(likedPoll!);
  }

  @override
  Future<PollSummary> unlikePoll({
    required String pollId,
    required String accessToken,
  }) async {
    likeCalls++;
    return SynchronousFuture(likedPoll!);
  }

  @override
  Future<CreatePollCommentResult> createComment({
    required String pollId,
    required String body,
    required String accessToken,
  }) async {
    return SynchronousFuture(createCommentResult!);
  }

  @override
  void close() {}
}

class _NoopHttpClient extends http.BaseClient {
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    throw UnsupportedError('HTTP is not expected in this test.');
  }

  @override
  void close() {}
}

extension on PollSummary {
  PollSummary copyWith({
    bool? viewerHasLiked,
    int? likesCount,
    int? commentsCount,
  }) {
    return PollSummary(
      id: id,
      author: author,
      question: question,
      options: options,
      votesCount: votesCount,
      commentsCount: commentsCount ?? this.commentsCount,
      likesCount: likesCount ?? this.likesCount,
      viewerHasLiked: viewerHasLiked ?? this.viewerHasLiked,
      createdAt: createdAt,
      votedOptionIndex: votedOptionIndex,
    );
  }
}
