import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_comments_screen.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_summary.dart';
import 'package:yaskapp_mobile/src/features/polls/polls_api_client.dart';

void main() {
  testWidgets('shows comments loading state', (tester) async {
    final commentsCompleter = Completer<List<PollCommentSummary>>();

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          pollsApiClient: _FakePollsApiClient(
            commentsFuture: commentsCompleter.future,
          ),
        ),
      ),
    );

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('shows comments empty state', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          pollsApiClient: _FakePollsApiClient(
            commentsFuture: Future.value([]),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('No comments yet'), findsOneWidget);
    expect(find.text('Be the first to join the discussion.'), findsOneWidget);
  });

  testWidgets('shows authenticated comment composer', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          pollsApiClient: _FakePollsApiClient(
            commentsFuture: Future.value([]),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(TextField), findsOneWidget);
    expect(find.text('Add a comment...'), findsOneWidget);
    expect(find.byTooltip('Post comment'), findsOneWidget);
  });

  testWidgets('keeps comment composer above the keyboard', (tester) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    tester.view.viewInsets = const FakeViewPadding(bottom: 300);
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          pollsApiClient: _FakePollsApiClient(
            commentsFuture: Future.value([]),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final composerRect = tester.getRect(find.byType(TextField));
    expect(composerRect.bottom, lessThanOrEqualTo(500));
  });

  testWidgets('disables repeated comment submissions while in flight', (
    tester,
  ) async {
    final createCommentCompleter = Completer<CreatePollCommentResult>();
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([]),
      createCommentFuture: createCommentCompleter.future,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          pollsApiClient: pollsApiClient,
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'A useful comment.');
    await tester.tap(find.byTooltip('Post comment'));
    await tester.pump();
    await tester.tap(find.byTooltip('Post comment'));
    await tester.pump();

    expect(pollsApiClient.createCommentCalls, 1);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    createCommentCompleter.complete(_createCommentResult);
    await tester.pumpAndSettle();

    expect(find.byType(CircularProgressIndicator), findsNothing);
  });

  testWidgets('appends created comment to the visible list', (tester) async {
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([]),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          pollsApiClient: pollsApiClient,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('No comments yet'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'A useful comment.');
    await tester.tap(find.byTooltip('Post comment'));
    await tester.pumpAndSettle();

    expect(pollsApiClient.createCommentCalls, 1);
    expect(find.text('No comments yet'), findsNothing);
    expect(find.text('A useful comment.'), findsOneWidget);
    expect(find.text('Author'), findsWidgets);
    expect(find.text('1'), findsOneWidget);
  });

  testWidgets('tracks the latest updated poll summary after comment creation', (
    tester,
  ) async {
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([]),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          pollsApiClient: pollsApiClient,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('1'), findsNothing);

    await tester.enterText(find.byType(TextField), 'A useful comment.');
    await tester.tap(find.byTooltip('Post comment'));
    await tester.pumpAndSettle();

    expect(find.text('1'), findsOneWidget);
  });

  testWidgets('returns the latest updated poll summary when leaving', (
    tester,
  ) async {
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([]),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: _CommentsScreenHost(pollsApiClient: pollsApiClient),
      ),
    );

    await tester.tap(find.text('Open comments'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'A useful comment.');
    await tester.tap(find.byTooltip('Post comment'));
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('Back'));
    await tester.pumpAndSettle();

    expect(find.text('Returned commentsCount: 1'), findsOneWidget);
  });

  testWidgets('shows an error when posting a comment fails', (tester) async {
    final createCommentCompleter = Completer<CreatePollCommentResult>();
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([]),
      createCommentFuture: createCommentCompleter.future,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          pollsApiClient: pollsApiClient,
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'A useful comment.');
    await tester.tap(find.byTooltip('Post comment'));
    await tester.pump();
    createCommentCompleter.completeError(
      const PollsApiException('Could not post comment.'),
    );
    await tester.pump();

    expect(pollsApiClient.createCommentCalls, 1);
    expect(find.text('Could not post comment.'), findsOneWidget);
    expect(find.text('No comments yet'), findsOneWidget);
    expect(find.widgetWithText(TextField, 'A useful comment.'), findsOneWidget);
    expect(find.byTooltip('Post comment'), findsOneWidget);
  });

  testWidgets('shows comments error state', (tester) async {
    final commentsCompleter = Completer<List<PollCommentSummary>>();

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          pollsApiClient: _FakePollsApiClient(
            commentsFuture: commentsCompleter.future,
          ),
        ),
      ),
    );
    commentsCompleter.completeError(
      const PollsApiException('Could not load comments.'),
    );
    await tester.pump();

    expect(find.text('Could not load comments'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
  });

  testWidgets('likes a comment and updates its count', (tester) async {
    tester.view.physicalSize = const Size(400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([_comment]),
      likeCommentFuture: Future.value(_likedComment),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          pollsApiClient: pollsApiClient,
        ),
      ),
    );
    await tester.pumpAndSettle();

    final likeButton = find.byKey(const ValueKey('like-comment-comment-1'));
    await tester.scrollUntilVisible(
      likeButton,
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(likeButton);
    await tester.pumpAndSettle();

    expect(pollsApiClient.likeCommentCalls, 1);
    expect(find.text('1'), findsOneWidget);
    expect(find.byTooltip('Unlike comment'), findsOneWidget);
  });

  testWidgets('updates a comment like without reloading the comments screen', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final likeCommentCompleter = Completer<PollCommentSummary>();
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([_comment]),
      likeCommentFuture: likeCommentCompleter.future,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          pollsApiClient: pollsApiClient,
        ),
      ),
    );
    await tester.pumpAndSettle();

    final likeButton = find.byKey(const ValueKey('like-comment-comment-1'));
    await tester.scrollUntilVisible(
      likeButton,
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(likeButton);
    await tester.pump();

    likeCommentCompleter.complete(_likedComment);
    await tester.pump();

    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.text('1'), findsOneWidget);
  });

  testWidgets('places comment like count half as close to the heart', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          pollsApiClient: _FakePollsApiClient(
            commentsFuture: Future.value([_comment]),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final likeButton = find.byKey(const ValueKey('like-comment-comment-1'));
    await tester.scrollUntilVisible(
      likeButton,
      300,
      scrollable: find.byType(Scrollable).first,
    );

    final iconRect = tester.getRect(
      find.descendant(
        of: likeButton,
        matching: find.byIcon(Icons.favorite_border),
      ),
    );
    final countRect = tester.getRect(find.text('0').last);
    expect(countRect.left - iconRect.right, closeTo(1, 0.01));
  });

  testWidgets('aligns comment actions to the left edge of the comment body', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          pollsApiClient: _FakePollsApiClient(
            commentsFuture: Future.value([_comment]),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final likeButton = find.byKey(const ValueKey('like-comment-comment-1'));
    await tester.scrollUntilVisible(
      likeButton,
      300,
      scrollable: find.byType(Scrollable).first,
    );

    final bodyRect = tester.getRect(find.text('A useful comment.'));
    final iconRect = tester.getRect(
      find.descendant(
        of: likeButton,
        matching: find.byIcon(Icons.favorite_border),
      ),
    );
    final replyRect = tester.getRect(find.text('Reply'));

    expect(iconRect.left, closeTo(bodyRect.left, 0.01));
    expect(replyRect.left, closeTo(bodyRect.left + 45, 0.5));
  });

  testWidgets('shows delete in the poll-style menu for the current user comment',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          currentUserId: 'author-1',
          pollsApiClient: _FakePollsApiClient(
            commentsFuture: Future.value([_comment]),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('More').last);
    await tester.pumpAndSettle();

    expect(find.text('Delete comment'), findsOneWidget);
    expect(find.text('Report'), findsNothing);
    expect(find.byIcon(Icons.delete_outline), findsOneWidget);
  });

  testWidgets('shows report in the poll-style menu for another user comment',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          currentUserId: 'viewer-1',
          pollsApiClient: _FakePollsApiClient(
            commentsFuture: Future.value([_comment]),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('More').last);
    await tester.pumpAndSettle();

    expect(find.text('Report'), findsOneWidget);
    expect(find.text('Delete comment'), findsNothing);
    expect(find.byIcon(Icons.flag_outlined), findsOneWidget);
  });

  testWidgets('opens the report dialog from another user comment menu',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          currentUserId: 'viewer-1',
          pollsApiClient: _FakePollsApiClient(
            commentsFuture: Future.value([_comment]),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('More').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Report'));
    await tester.pumpAndSettle();

    expect(find.text('Report content'), findsOneWidget);
  });

  testWidgets('confirms and removes the current user comment', (tester) async {
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([_comment]),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _pollWithComment,
          accessToken: 'access-token',
          currentUserId: 'author-1',
          pollsApiClient: pollsApiClient,
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('More').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete comment'));
    await tester.pumpAndSettle();

    expect(find.text('Delete comment?'), findsOneWidget);
    expect(find.text('This comment will be removed permanently.'), findsOneWidget);

    await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
    await tester.pumpAndSettle();

    expect(pollsApiClient.deleteCommentCalls, 1);
    expect(find.text('A useful comment.'), findsNothing);
    expect(find.text('No comments yet'), findsOneWidget);
    expect(find.text('0 comments'), findsOneWidget);
  });
}

final _poll = PollSummary(
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
      text: 'Comments',
      position: 0,
      votesCount: 0,
    ),
    PollOptionSummary(
      id: 'option-2',
      text: 'Likes',
      position: 1,
      votesCount: 0,
    ),
  ],
  votesCount: 0,
  commentsCount: 0,
  likesCount: 0,
  viewerHasLiked: false,
  createdAt: DateTime(2026, 7, 17, 12),
);

final _pollWithComment = PollSummary(
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
      text: 'Comments',
      position: 0,
      votesCount: 0,
    ),
    PollOptionSummary(
      id: 'option-2',
      text: 'Likes',
      position: 1,
      votesCount: 0,
    ),
  ],
  votesCount: 0,
  commentsCount: 1,
  likesCount: 0,
  viewerHasLiked: false,
  createdAt: DateTime(2026, 7, 17, 12),
);

final _comment = PollCommentSummary(
  id: 'comment-1',
  pollId: 'poll-1',
  author: const PollAuthorSummary(
    id: 'author-1',
    username: 'author',
    displayName: 'Author',
  ),
  body: 'A useful comment.',
  likesCount: 0,
  createdAt: DateTime(2026, 7, 17, 12, 1),
  updatedAt: DateTime(2026, 7, 17, 12, 1),
);

final _likedComment = PollCommentSummary(
  id: 'comment-1',
  pollId: 'poll-1',
  author: const PollAuthorSummary(
    id: 'author-1',
    username: 'author',
    displayName: 'Author',
  ),
  body: 'A useful comment.',
  likesCount: 1,
  viewerHasLiked: true,
  createdAt: DateTime(2026, 7, 17, 12, 1),
  updatedAt: DateTime(2026, 7, 17, 12, 1),
);

final _createCommentResult = CreatePollCommentResult(
  comment: _comment,
  poll: _pollWithComment,
);

class _FakePollsApiClient extends PollsApiClient {
  _FakePollsApiClient({
    required this.commentsFuture,
    Future<CreatePollCommentResult>? createCommentFuture,
    Future<PollCommentSummary>? likeCommentFuture,
    Future<void>? deleteCommentFuture,
  }) : createCommentFuture =
            createCommentFuture ?? Future.value(_createCommentResult),
       likeCommentFuture = likeCommentFuture ?? Future.value(_likedComment),
       deleteCommentFuture = deleteCommentFuture ?? Future.value();

  final Future<List<PollCommentSummary>> commentsFuture;
  final Future<CreatePollCommentResult> createCommentFuture;
  final Future<PollCommentSummary> likeCommentFuture;
  final Future<void> deleteCommentFuture;
  int createCommentCalls = 0;
  int likeCommentCalls = 0;
  int deleteCommentCalls = 0;

  @override
  Future<List<PollCommentSummary>> listComments({
    required String pollId,
    int limit = 50,
    String? accessToken,
  }) {
    return commentsFuture;
  }

  @override
  Future<CreatePollCommentResult> createComment({
    required String pollId,
    required String body,
    required String accessToken,
  }) {
    createCommentCalls++;

    return createCommentFuture;
  }

  @override
  Future<PollCommentSummary> likeComment({
    required String pollId,
    required String commentId,
    required String accessToken,
  }) {
    likeCommentCalls++;
    return likeCommentFuture;
  }

  @override
  Future<void> deleteComment({
    required String pollId,
    required String commentId,
    required String accessToken,
  }) {
    deleteCommentCalls++;
    return deleteCommentFuture;
  }

  @override
  void close() {}
}

class _CommentsScreenHost extends StatefulWidget {
  const _CommentsScreenHost({required this.pollsApiClient});

  final PollsApiClient pollsApiClient;

  @override
  State<_CommentsScreenHost> createState() => _CommentsScreenHostState();
}

class _CommentsScreenHostState extends State<_CommentsScreenHost> {
  PollSummary? _returnedPoll;

  Future<void> _openComments() async {
    final returnedPoll = await Navigator.of(context).push<PollSummary>(
      MaterialPageRoute(
        builder: (context) => PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          pollsApiClient: widget.pollsApiClient,
        ),
      ),
    );

    setState(() {
      _returnedPoll = returnedPoll;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            FilledButton(
              onPressed: _openComments,
              child: const Text('Open comments'),
            ),
            if (_returnedPoll != null)
              Text('Returned commentsCount: ${_returnedPoll!.commentsCount}'),
          ],
        ),
      ),
    );
  }
}
