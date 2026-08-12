import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/features/auth/auth_session.dart';
import 'package:yaskapp_mobile/src/features/feed/feed_screen.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_summary.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_card.dart';
import 'package:yaskapp_mobile/src/features/polls/polls_api_client.dart';
import 'package:yaskapp_mobile/src/features/realtime/realtime_client.dart';

void main() {
  testWidgets('ties share medal colors and zero-vote options stay readable', (
    tester,
  ) async {
    const navy = Color(0xFF00104F);
    const orange = Color(0xFFF47B16);
    const silver = Color(0xFFB9BEC7);

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

    final progressColors = tester
        .widgetList<ColoredBox>(find.byType(ColoredBox))
        .map((box) => box.color)
        .toList();

    expect(progressColors, containsAllInOrder([orange, orange, silver, navy]));
    expect(
      tester.widget<Text>(find.text('No votes')).style?.color,
      const Color(0xFF0A123F),
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

class _FakePollsApiClient extends PollsApiClient {
  _FakePollsApiClient({
    required this.initialPolls,
    this.comments = const [],
    this.createCommentResult,
    this.likedPoll,
    this.votedPoll,
    this.likeError,
  });

  final List<PollSummary> initialPolls;
  final List<PollCommentSummary> comments;
  final CreatePollCommentResult? createCommentResult;
  final PollSummary? likedPoll;
  final PollSummary? votedPoll;
  final PollsApiException? likeError;
  int likeCalls = 0;
  int voteCalls = 0;
  int listPollsCalls = 0;

  @override
  Future<List<PollSummary>> listPolls({
    int limit = 20,
    String? accessToken,
  }) async {
    listPollsCalls++;
    return initialPolls;
  }

  @override
  Future<PollSummary> vote({
    required String pollId,
    required String optionId,
    required String accessToken,
  }) async {
    voteCalls++;
    return votedPoll!;
  }

  @override
  Future<PollSummary> likePoll({
    required String pollId,
    required String accessToken,
  }) async {
    likeCalls++;
    final likeError = this.likeError;

    if (likeError != null) {
      throw likeError;
    }

    return likedPoll!;
  }

  @override
  Future<List<PollCommentSummary>> listComments({
    required String pollId,
    int limit = 50,
  }) async {
    return comments;
  }

  @override
  Future<CreatePollCommentResult> createComment({
    required String pollId,
    required String body,
    required String accessToken,
  }) async {
    return createCommentResult!;
  }

  @override
  void close() {}
}

class _FakeRealtimeClient extends RealtimeClient {
  final _controller = StreamController<PollVoteRealtimeEvent>.broadcast();

  @override
  Stream<PollVoteRealtimeEvent> get pollVotes => _controller.stream;

  @override
  void connect() {}

  @override
  Future<void> close() async {
    await _controller.close();
  }
}
