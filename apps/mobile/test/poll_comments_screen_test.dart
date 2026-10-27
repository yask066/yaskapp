import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/core/pagination/cursor_page.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_comments_screen.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_summary.dart';
import 'package:yaskapp_mobile/src/features/polls/polls_api_client.dart';

void main() {
  testWidgets('builds root comments lazily as they enter the viewport', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final comments = [
      for (var index = 1; index <= 80; index++)
        _rootComment(id: 'root-$index', body: 'Root comment $index.'),
    ];

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          pollsApiClient: _FakePollsApiClient(
            commentsFuture: Future.value(comments),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Root comment 1.'), findsOneWidget);
    expect(find.text('Root comment 80.'), findsNothing);

    await tester.scrollUntilVisible(
      find.text('Root comment 80.'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Root comment 80.'), findsOneWidget);
  });

  testWidgets('loads newest root pages and manually continues after auto pages',
      (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final comments = [
      for (var index = 1; index <= 81; index++)
        _rootComment(id: 'root-$index', body: 'Root comment $index.'),
    ];
    final cursors = <String?>[];
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([]),
      commentsPageLoader: ({
        required pollId,
        required limit,
        required order,
        cursor,
      }) async {
        cursors.add(cursor);
        final pageIndex = switch (cursor) {
          null => 0,
          'roots-2' => 1,
          'roots-3' => 2,
          'roots-4' => 3,
          'roots-5' => 4,
          _ => throw StateError('Unexpected root cursor: $cursor'),
        };
        final start = pageIndex * 20;
        final end = (start + 20).clamp(0, comments.length);
        return CursorPage(
          items: comments.sublist(start, end),
          nextCursor: pageIndex == 4 ? null : 'roots-${pageIndex + 2}',
        );
      },
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

    expect(cursors, [null]);
    expect(find.text('Root comment 1.'), findsOneWidget);
    expect(find.text('Root comment 81.'), findsNothing);

    final scrollable = find.byType(Scrollable).first;
    await tester.scrollUntilVisible(
      find.text('Root comment 80.'),
      400,
      scrollable: scrollable,
    );
    expect(find.text('Root comment 80.'), findsOneWidget);
    expect(cursors, [null, 'roots-2', 'roots-3', 'roots-4']);

    await tester.drag(scrollable, const Offset(0, -300));
    await tester.pumpAndSettle();
    await tester.drag(
      find.byType(CustomScrollView).first,
      const Offset(0, -500),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(OutlinedButton, 'Load more'));
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.text('Root comment 81.'),
      300,
      scrollable: scrollable,
    );
    expect(find.text('Root comment 81.'), findsOneWidget);
    expect(cursors, [null, 'roots-2', 'roots-3', 'roots-4', 'roots-5']);
    await tester.drag(scrollable, const Offset(0, -250));
    await tester.pumpAndSettle();
    expect(find.text("You're all caught up."), findsOneWidget);
  });

  testWidgets(
      'keeps loaded roots visible after an append error and retries cursor', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final cursors = <String?>[];
    var appendAttempts = 0;
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([]),
      commentsPageLoader: ({
        required pollId,
        required limit,
        required order,
        cursor,
      }) async {
        cursors.add(cursor);
        if (cursor == null) {
          return CursorPage(
            items: [_rootComment(body: 'Loaded root remains visible.')],
            nextCursor: 'append-cursor',
          );
        }
        appendAttempts++;
        if (appendAttempts == 1) {
          throw const PollsApiException('Append failed.');
        }
        return CursorPage(
          items: [
            _rootComment(id: 'root-2', body: 'Retried root loaded.'),
          ],
          nextCursor: null,
        );
      },
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

    expect(find.text('Could not load more.'), findsOneWidget);
    expect(find.text('Loaded root remains visible.'), findsOneWidget);
    expect(find.text('Could not load comments'), findsNothing);

    final scrollable = find.byType(Scrollable).first;
    await tester.drag(scrollable, const Offset(0, -300));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(OutlinedButton, 'Retry'));
    await tester.pumpAndSettle();

    expect(cursors, [null, 'append-cursor', 'append-cursor']);
    expect(find.text('Loaded root remains visible.'), findsOneWidget);
    expect(find.text('Retried root loaded.'), findsOneWidget);
    await tester.drag(scrollable, const Offset(0, -250));
    await tester.pumpAndSettle();
    expect(find.text("You're all caught up."), findsOneWidget);
  });

  testWidgets('refresh failure retains the current root page and cursor', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final comments = [
      for (var index = 1; index <= 20; index++)
        _rootComment(id: 'root-$index', body: 'Refresh root $index.'),
    ];
    final cursors = <String?>[];
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([]),
      commentsPageLoader: ({
        required pollId,
        required limit,
        required order,
        cursor,
      }) async {
        cursors.add(cursor);
        if (cursors.length == 1) {
          return CursorPage(items: comments, nextCursor: 'still-usable');
        }
        if (cursor == null) {
          throw const PollsApiException('Could not refresh comments.');
        }
        return CursorPage(
          items: [
            _rootComment(id: 'after-refresh', body: 'Cursor still usable.')
          ],
          nextCursor: null,
        );
      },
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

    final scrollable = find.byType(Scrollable).first;
    tester.state<ScrollableState>(scrollable).position.jumpTo(0);
    await tester.pumpAndSettle();
    await tester.drag(scrollable, const Offset(0, 350));
    await tester.pumpAndSettle();

    expect(find.text('Refresh root 1.'), findsOneWidget);
    expect(find.text('Could not refresh comments.'), findsOneWidget);
    expect(find.text('Could not load comments'), findsNothing);

    await tester.drag(scrollable, const Offset(0, -2000));
    await tester.pumpAndSettle();
    expect(find.text('Refresh root 20.'), findsOneWidget);

    expect(cursors, [null, null, 'still-usable']);
    expect(find.text('Refresh root 20.'), findsOneWidget);
  });

  testWidgets('keeps an expanded reply branch when a new root is prepended', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([
        _rootComment(id: 'root-a'),
        _rootComment(id: 'root-b', repliesCount: 1),
      ]),
      replyPageLoader: ({required rootCommentId, cursor, limit = 20}) async =>
          PollCommentRepliesPage(
        items: [_replyFor('reply-b1', 'root-b', 'First reply B.')],
        nextCursor: 'b-more',
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          currentUserId: 'viewer-1',
          pollsApiClient: pollsApiClient,
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('toggle-replies-root-b')));
    await tester.pumpAndSettle();
    expect(find.text('First reply B.'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'A useful comment.');
    await tester.tap(find.byTooltip('Post comment'));
    await tester.pumpAndSettle();

    expect(find.text('A useful comment.'), findsOneWidget);
    expect(find.text('First reply B.'), findsOneWidget);
    expect(find.text('Load more replies'), findsOneWidget);
    expect(find.byKey(const ValueKey('toggle-replies-root-b')), findsOneWidget);
    expect(find.text('Hide replies (1)'), findsOneWidget);
  });

  testWidgets('keeps retry after refresh also fails before the first page', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    var attempts = 0;
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([]),
      commentsPageLoader: ({
        required pollId,
        required limit,
        required order,
        cursor,
      }) async {
        attempts++;
        if (attempts < 3) {
          throw const PollsApiException('Comments are unavailable.');
        }
        return CursorPage(
          items: [_rootComment(body: 'Comments recovered.')],
          nextCursor: null,
        );
      },
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
    expect(attempts, 1);
    expect(find.text('Could not load comments'), findsOneWidget);

    final scrollable = find.byType(Scrollable).first;
    tester.state<ScrollableState>(scrollable).position.jumpTo(0);
    await tester.pumpAndSettle();
    await tester.drag(scrollable, const Offset(0, 350));
    await tester.pumpAndSettle();

    expect(attempts, 2);
    expect(find.text('Could not load comments'), findsOneWidget);
    expect(find.text('No comments yet'), findsNothing);
    expect(find.text('Retry'), findsOneWidget);

    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();

    expect(attempts, 3);
    expect(find.text('Comments recovered.'), findsOneWidget);
  });

  testWidgets(
      'keeps cursor, pending and error state independent per reply branch', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final firstReplyA = Completer<PollCommentRepliesPage>();
    final firstReplyB = Completer<PollCommentRepliesPage>();
    final nextReplyA = Completer<PollCommentRepliesPage>();
    final nextReplyB = Completer<PollCommentRepliesPage>();
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([
        _rootComment(id: 'root-a', repliesCount: 1),
        _rootComment(id: 'root-b', repliesCount: 1),
      ]),
      commentsPageLoader: ({
        required pollId,
        required limit,
        required order,
        cursor,
      }) async =>
          CursorPage(
        items: [
          _rootComment(id: 'root-a', repliesCount: 1),
          _rootComment(id: 'root-b', repliesCount: 1),
        ],
        nextCursor: null,
      ),
      replyPageLoader: ({required rootCommentId, cursor, limit = 20}) {
        if (rootCommentId == 'root-a' && cursor == null) {
          return firstReplyA.future;
        }
        if (rootCommentId == 'root-b' && cursor == null) {
          return firstReplyB.future;
        }
        if (rootCommentId == 'root-a' && cursor == 'a-more') {
          return nextReplyA.future;
        }
        if (rootCommentId == 'root-b' && cursor == 'b-more') {
          return nextReplyB.future;
        }
        return Future.error(
            StateError('Unexpected reply cursor: $rootCommentId/$cursor'));
      },
    );

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          currentUserId: 'viewer-1',
          pollsApiClient: pollsApiClient,
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(pollsApiClient.commentsPageRequests, hasLength(1));
    expect(pollsApiClient.commentsPageRequests.first['order'], 'newest');

    final expandButtons = find.text('Show replies (1)');
    expect(expandButtons, findsNWidgets(2));
    await tester.tap(expandButtons.first);
    await tester.pump();
    await tester.tap(find.text('Show replies (1)').last);
    await tester.pump();

    firstReplyA.complete(PollCommentRepliesPage(
      items: [_replyFor('reply-a1', 'root-a', 'First reply A.')],
      nextCursor: 'a-more',
    ));
    firstReplyB.complete(PollCommentRepliesPage(
      items: [_replyFor('reply-b1', 'root-b', 'First reply B.')],
      nextCursor: 'b-more',
    ));
    await tester.pump();
    await tester.pump();

    expect(find.text('First reply A.'), findsOneWidget);
    expect(find.text('First reply B.'), findsOneWidget);
    expect(find.text('Load more replies'), findsNWidgets(2));

    await tester.tap(find.text('Load more replies').first);
    await tester.pump();
    await tester.tap(find.text('Load more replies').last);
    await tester.pump();

    nextReplyA.completeError(const PollsApiException('A branch failed.'));
    await tester.pump();
    await tester.pump();
    expect(find.text('A branch failed.'), findsOneWidget);
    expect(find.text('Loading replies…'), findsOneWidget);

    nextReplyB.complete(PollCommentRepliesPage(
      items: [_replyFor('reply-b2', 'root-b', 'Second reply B.')],
      nextCursor: null,
    ));
    await tester.pump();
    await tester.pump();

    expect(find.text('A branch failed.'), findsOneWidget);
    expect(find.text('Second reply B.'), findsOneWidget);
    expect(find.text('Loading replies…'), findsNothing);
  });

  testWidgets('reply completion after collapse and root deletion is harmless', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 1100);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final firstReply = Completer<PollCommentRepliesPage>();
    final nextReply = Completer<PollCommentRepliesPage>();
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([_rootComment(repliesCount: 2)]),
      commentsPageLoader: ({
        required pollId,
        required limit,
        required order,
        cursor,
      }) async =>
          CursorPage(
        items: [_rootComment(repliesCount: 2)],
        nextCursor: null,
      ),
      replyPageLoader: ({required rootCommentId, cursor, limit = 20}) =>
          cursor == null ? firstReply.future : nextReply.future,
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

    expect(pollsApiClient.commentsPageRequests, hasLength(1));

    await tester.tap(find.text('Show replies (2)'));
    await tester.pump();
    await tester.tap(find.text('Hide replies (2)'));
    await tester.pump();
    firstReply.complete(PollCommentRepliesPage(
      items: [
        _replyFor('reply-one', 'root-1', 'Reply loaded while collapsed.')
      ],
      nextCursor: 'reply-more',
    ));
    await tester.pump();

    await tester.tap(find.text('Show replies (2)'));
    await tester.pump();
    expect(find.text('Reply loaded while collapsed.'), findsOneWidget);

    await tester.tap(find.text('Load more replies'));
    await tester.pump();
    await tester.tap(find.byTooltip('More').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete comment'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
    await tester.pumpAndSettle();

    nextReply.complete(PollCommentRepliesPage(
      items: [_replyFor('reply-two', 'root-1', 'Reply after root deletion.')],
      nextCursor: null,
    ));
    await tester.pumpAndSettle();

    expect(find.text('Root comment.'), findsNothing);
    expect(find.text('Reply after root deletion.'), findsNothing);
    expect(find.text('No comments yet'), findsOneWidget);
  });

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

    await tester.pump(const Duration(milliseconds: 150));
    expect(find.bySemanticsLabel('Loading comments'), findsOneWidget);
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

  testWidgets('does not infer pagination state from a legacy root response', (
    tester,
  ) async {
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([
        _rootComment(id: 'legacy-root', body: 'Legacy comment.'),
      ]),
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

    expect(find.text('Legacy comment.'), findsOneWidget);
    expect(find.text('No comments yet'), findsNothing);
    expect(find.text("You're all caught up."), findsNothing);
    expect(find.text('Load more'), findsNothing);
    expect(pollsApiClient.commentsPageRequests.single['limit'], 20);
    expect(pollsApiClient.commentsPageRequests.single['order'], 'newest');
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

  testWidgets('keeps a created root above server pages without moving cursor',
      (tester) async {
    tester.view.physicalSize = const Size(400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final requests = <String?>[];
    final roots = [
      for (var index = 1; index <= 20; index++)
        _rootComment(id: 'root-$index', body: 'Root comment $index.'),
    ];
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([]),
      commentsPageLoader: (
          {required pollId, required limit, required order, cursor}) async {
        requests.add(cursor);
        if (cursor == null) {
          return CursorPage(items: roots, nextCursor: 'opaque-roots-cursor');
        }
        return CursorPage(
          items: [_comment, _rootComment(id: 'root-21')],
          nextCursor: null,
        );
      },
    );

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          currentUserId: 'viewer-1',
          pollsApiClient: pollsApiClient,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(requests, [null]);

    await tester.enterText(find.byType(TextField), 'A useful comment.');
    await tester.tap(find.byTooltip('Post comment'));
    await tester.pumpAndSettle();

    expect(find.text('A useful comment.'), findsOneWidget);
    expect(
      tester.getTopLeft(find.text('A useful comment.')).dy,
      lessThan(tester.getTopLeft(find.text('Root comment 1.')).dy),
    );

    await tester.scrollUntilVisible(
      find.text('Root comment 20.'),
      500,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    expect(requests, [null, 'opaque-roots-cursor']);
    expect(find.text('A useful comment.'), findsOneWidget);
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

  testWidgets('shows, retries, paginates and collapses a reply thread', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    var firstPageAttempts = 0;
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([_rootComment(repliesCount: 2)]),
      replyPageLoader: ({required rootCommentId, cursor, limit = 20}) async {
        if (cursor == null) {
          firstPageAttempts++;
          if (firstPageAttempts == 1) {
            throw const PollsApiException('Could not load replies.');
          }
          return PollCommentRepliesPage(
            items: [_reply],
            nextCursor: 'reply-cursor',
          );
        }
        return PollCommentRepliesPage(
          items: [_secondReply],
          nextCursor: null,
        );
      },
    );

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          currentUserId: 'viewer-1',
          pollsApiClient: pollsApiClient,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Show replies (2)'), findsOneWidget);
    await tester.tap(find.text('Show replies (2)'));
    await tester.pumpAndSettle();
    expect(find.text('Could not load replies.'), findsOneWidget);

    await tester.tap(find.text('Retry replies'));
    await tester.pumpAndSettle();
    expect(find.text('First reply.'), findsOneWidget);
    expect(find.text('Load more replies'), findsOneWidget);

    await tester.tap(find.text('Load more replies'));
    await tester.pumpAndSettle();
    expect(find.text('Second reply.'), findsOneWidget);

    await tester.tap(find.text('Hide replies (2)'));
    await tester.pumpAndSettle();
    expect(find.text('First reply.'), findsNothing);
  });

  testWidgets('cancels and submits a reply to the root, updating both counts', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([_rootComment()]),
      createCommentFuture: Future.value(_createReplyResult),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _pollWithComment,
          accessToken: 'access-token',
          currentUserId: 'viewer-1',
          pollsApiClient: pollsApiClient,
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('reply-comment-root-1')));
    await tester.pumpAndSettle();
    expect(find.text('Replying to Author'), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('reply-composer-root-1')),
        'discard this reply');
    await tester.tap(find.text('Cancel reply'));
    await tester.pumpAndSettle();
    expect(find.text('Replying to Author'), findsNothing);

    await tester.tap(find.byKey(const ValueKey('reply-comment-root-1')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('reply-composer-root-1')),
        'A reply to the root.');
    await tester.tap(find.byTooltip('Post reply'));
    await tester.pumpAndSettle();

    expect(pollsApiClient.createCommentCalls, 1);
    expect(pollsApiClient.createdParentCommentIds, ['root-1']);
    expect(pollsApiClient.createdCommentBodies, ['A reply to the root.']);
    expect(find.text('A reply to the root.'), findsOneWidget);
    expect(find.text('2 comments'), findsOneWidget);
    expect(find.text('Hide replies (1)'), findsOneWidget);
  });

  testWidgets('reply failure keeps draft and does not retry the POST', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final createReply = Completer<CreatePollCommentResult>();
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([_rootComment()]),
      createCommentFuture: createReply.future,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _pollWithComment,
          accessToken: 'access-token',
          currentUserId: 'viewer-1',
          pollsApiClient: pollsApiClient,
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('reply-comment-root-1')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('reply-composer-root-1')),
      'Keep this reply draft.',
    );
    await tester.tap(find.byTooltip('Post reply'));
    await tester.pump();
    createReply.completeError(const PollsApiException('Could not post reply.'));
    await tester.pumpAndSettle();

    expect(pollsApiClient.createCommentCalls, 1);
    expect(find.text('Could not post reply.'), findsOneWidget);
    expect(find.text('Keep this reply draft.'), findsOneWidget);
    await tester.pump(const Duration(seconds: 1));
    expect(pollsApiClient.createCommentCalls, 1);
  });

  testWidgets('marks a new reply gap until its page arrives, then deduplicates',
      (tester) async {
    tester.view.physicalSize = const Size(400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([_rootComment(repliesCount: 1)]),
      createCommentFuture: Future.value(_createReplyResult),
      replyPageLoader: ({required rootCommentId, cursor, limit = 20}) async {
        if (cursor == null) {
          return PollCommentRepliesPage(
            items: [_reply],
            nextCursor: 'page-with-own-reply',
          );
        }
        return PollCommentRepliesPage(
          items: [_reply, _createdReply],
          nextCursor: null,
        );
      },
    );

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _pollWithComment,
          accessToken: 'access-token',
          currentUserId: 'viewer-1',
          pollsApiClient: pollsApiClient,
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Show replies (1)'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('reply-comment-root-1')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('reply-composer-root-1')),
      'A reply to the root.',
    );
    await tester.tap(find.byTooltip('Post reply'));
    await tester.pumpAndSettle();

    expect(find.text('Your reply'), findsOneWidget);
    expect(find.text('Newer replies are not loaded.'), findsOneWidget);
    expect(find.text('A reply to the root.'), findsOneWidget);

    await tester.tap(find.text('Load more replies'));
    await tester.pumpAndSettle();

    expect(find.text('Your reply'), findsNothing);
    expect(find.text('Newer replies are not loaded.'), findsNothing);
    expect(find.text('A reply to the root.'), findsOneWidget);
    expect(pollsApiClient.replyPageCalls, 2);
  });

  testWidgets('allows anonymous visitors to read replies but not compose one', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([_rootComment(repliesCount: 1)]),
      replyPageLoader: ({required rootCommentId, cursor, limit = 20}) async =>
          PollCommentRepliesPage(items: [_reply], nextCursor: null),
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

    await tester.tap(find.text('Show replies (1)'));
    await tester.pumpAndSettle();

    expect(find.text('First reply.'), findsOneWidget);
    expect(
        tester
            .widget<TextButton>(find.byKey(
              const ValueKey('reply-comment-root-1'),
            ))
            .onPressed,
        isNull);
    expect(find.text('Replying to Author'), findsNothing);
  });

  testWidgets('resolves a reply target without paging through replies', (
    tester,
  ) async {
    final target = _replyFor(
      'reply-target',
      'root-context',
      'Reply linked from a notification.',
    );
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([]),
      commentLoader: ({required commentId, required pollId}) async =>
          commentId == target.id ? target : _rootComment(id: 'root-context'),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          pollsApiClient: pollsApiClient,
          initialCommentId: target.id,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Comment context'), findsOneWidget);
    expect(find.text('Root comment.'), findsOneWidget);
    expect(find.text('Reply linked from a notification.'), findsOneWidget);
    expect(pollsApiClient.getCommentCalls, 2);
    expect(pollsApiClient.replyPageCalls, 0);
    expect(pollsApiClient.commentsPageRequests, hasLength(1));
  });

  testWidgets('retries a timed out target without reloading root comments', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    var targetAttempts = 0;
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([]),
      commentLoader: ({required commentId, required pollId}) async {
        targetAttempts++;
        if (targetAttempts == 1) throw TimeoutException('target timed out');
        return _rootComment(id: commentId, body: 'Target arrived after retry.');
      },
    );

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          pollsApiClient: pollsApiClient,
          initialCommentId: 'target-after-timeout',
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.text('Could not open this comment. Please try again.'),
      findsOneWidget,
    );
    final retryTarget = find.byKey(const ValueKey('retry-comment-target'));
    await tester.scrollUntilVisible(
      retryTarget,
      100,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(retryTarget);
    await tester.pumpAndSettle();

    final targetComment = find.text('Target arrived after retry.');
    await tester.scrollUntilVisible(
      targetComment,
      100,
      scrollable: find.byType(Scrollable).first,
    );
    expect(targetComment, findsOneWidget);
    expect(targetAttempts, 2);
    expect(pollsApiClient.commentsPageRequests, hasLength(1));
  });

  testWidgets('merges a linked reply when manual pagination reaches its id', (
    tester,
  ) async {
    final root = _rootComment(id: 'root-context', repliesCount: 2);
    final target = _replyFor(
      'reply-target',
      root.id,
      'The linked reply appears once.',
    );
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([]),
      commentLoader: ({required commentId, required pollId}) async =>
          commentId == target.id ? target : root,
      replyPageLoader: (
          {required rootCommentId, required limit, cursor}) async {
        if (cursor == null) {
          return PollCommentRepliesPage(
            items: [_replyFor('earlier-reply', root.id, 'An earlier reply.')],
            nextCursor: 'reply-page-2',
          );
        }
        return PollCommentRepliesPage(items: [target], nextCursor: null);
      },
    );

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          pollsApiClient: pollsApiClient,
          initialCommentId: target.id,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(pollsApiClient.replyPageCalls, 0);
    expect(find.text('Comment context'), findsOneWidget);
    expect(find.text('Root comment.'), findsOneWidget);
    expect(find.text('The linked reply appears once.'), findsOneWidget);
    expect(find.byKey(const ValueKey('load-target-replies-root-context')),
        findsOneWidget);

    await tester
        .tap(find.byKey(const ValueKey('load-target-replies-root-context')));
    await tester.pumpAndSettle();
    expect(pollsApiClient.replyPageCalls, 1);
    expect(find.text('The linked reply appears once.'), findsOneWidget);

    await tester.tap(find.text('Load more replies'));
    await tester.pumpAndSettle();

    expect(pollsApiClient.replyPageCalls, 2);
    expect(find.text('The linked reply appears once.'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('notification-target-comment-reply-target')),
      findsOneWidget,
    );
  });

  testWidgets(
      'replaces a linked reply preview when main thread pagination reaches it',
      (tester) async {
    tester.view.physicalSize = const Size(400, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final root = _rootComment(id: 'main-thread-root', repliesCount: 2);
    final target = _replyFor(
      'main-thread-target',
      root.id,
      'The target moves into the main thread once.',
    );
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([root]),
      commentLoader: ({required commentId, required pollId}) async => target,
      replyPageLoader: (
          {required rootCommentId, required limit, cursor}) async {
        if (cursor == null) {
          return PollCommentRepliesPage(
            items: [
              _replyFor('main-thread-earlier', root.id, 'Earlier reply.'),
            ],
            nextCursor: 'main-thread-page-2',
          );
        }
        return PollCommentRepliesPage(items: [target], nextCursor: null);
      },
    );

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          pollsApiClient: pollsApiClient,
          initialCommentId: target.id,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Comment context'), findsOneWidget);
    expect(find.text('The target moves into the main thread once.'),
        findsOneWidget);

    final scrollable = find.byType(CustomScrollView).first;
    await tester.drag(scrollable, const Offset(0, -500));
    await tester.pumpAndSettle();
    final toggleReplies = find.byKey(
      const ValueKey('toggle-replies-main-thread-root'),
    );
    await tester.scrollUntilVisible(
      toggleReplies,
      150,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(toggleReplies);
    await tester.pumpAndSettle();
    expect(pollsApiClient.replyPageCalls, 1);
    expect(find.text('Comment context'), findsOneWidget);
    expect(find.text('The target moves into the main thread once.'),
        findsOneWidget);

    final loadMoreReplies = find.text('Load more replies');
    await tester.scrollUntilVisible(
      loadMoreReplies,
      120,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.drag(scrollable, const Offset(0, -300));
    await tester.pumpAndSettle();
    await tester.tap(loadMoreReplies);
    await tester.pumpAndSettle();

    expect(pollsApiClient.replyPageCalls, 2);
    expect(find.text('Comment context'), findsNothing);
    await tester.scrollUntilVisible(
      toggleReplies,
      150,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(find.text('The target moves into the main thread once.'),
        findsOneWidget);
    expect(find.text('Hide replies (2)'), findsOneWidget);
  });

  testWidgets('merges a linked root when the unchanged main cursor reaches it',
      (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final requests = <String?>[];
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([]),
      commentsPageLoader: (
          {required limit, required order, required pollId, cursor}) async {
        requests.add(cursor);
        if (cursor == null) {
          return CursorPage(
            items: [
              for (var index = 0; index < 20; index++)
                _rootComment(
                  id: 'first-page-root-$index',
                  body: 'First page comment $index. ${'Long text. ' * 8}',
                ),
            ],
            nextCursor: 'server-cursor',
          );
        }
        return CursorPage(
          items: [
            _rootComment(id: 'target-root', body: 'Target from the next page.'),
          ],
          nextCursor: null,
        );
      },
      commentLoader: ({required commentId, required pollId}) async =>
          _rootComment(id: commentId, body: 'Target from the next page.'),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          pollsApiClient: pollsApiClient,
          initialCommentId: 'target-root',
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(pollsApiClient.getCommentCalls, 1);
    expect(requests, [null]);
    expect(find.text('Comment context'), findsOneWidget);
    expect(find.text('Target from the next page.'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.textContaining('First page comment 19.'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    expect(requests, [null, 'server-cursor']);
    expect(find.text('Comment context'), findsNothing);
    expect(find.text('Target from the next page.'), findsOneWidget);
    expect(
      find.byKey(
        const ValueKey('notification-target-comment-target-root'),
      ),
      findsOneWidget,
    );
  });

  testWidgets('focuses a target root already loaded outside the viewport', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final comments = [
      for (var index = 0; index < 19; index++)
        _rootComment(
          id: 'loaded-root-$index',
          body: 'Loaded root $index.',
        ),
      _rootComment(
        id: 'loaded-target',
        body: 'Target already in the loaded page.',
      ),
    ];
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value(comments),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          pollsApiClient: pollsApiClient,
          initialCommentId: 'loaded-target',
        ),
      ),
    );
    await tester.pumpAndSettle();

    final target = find.byKey(
      const ValueKey('notification-target-comment-loaded-target'),
    );
    expect(target, findsOneWidget);
    expect(tester.getTopLeft(target).dy, greaterThanOrEqualTo(0));
    expect(
      tester.getBottomRight(target).dy,
      lessThan(tester.view.physicalSize.height),
    );
    expect(pollsApiClient.getCommentCalls, 0);
  });

  testWidgets('user scroll wins while target lookup is pending',
      (tester) async {
    tester.view.physicalSize = const Size(400, 600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final target = Completer<PollCommentSummary>();
    final comments = [
      for (var index = 1; index <= 40; index++)
        _rootComment(
          id: index == 1 ? 'deep-root' : 'scroll-root-$index',
          body: index == 1
              ? 'Deep root. ${'Long linked root text. ' * 300}'
              : 'Scroll root $index. ${'Long comment text. ' * 8}',
        ),
    ];
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value(comments),
      commentLoader: ({required commentId, required pollId}) =>
          commentId == 'deep-target'
              ? target.future
              : Future.value(
                  _rootComment(
                    id: 'deep-root',
                    body: 'Deep root. ${'Long linked root text. ' * 300}',
                  ),
                ),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          pollsApiClient: pollsApiClient,
          initialCommentId: 'deep-target',
        ),
      ),
    );
    await tester.pumpAndSettle();
    final scrollable = tester.widget<CustomScrollView>(
      find.byType(CustomScrollView).first,
    );
    await tester.drag(
        find.byType(CustomScrollView).first, const Offset(0, -700));
    await tester.pumpAndSettle();
    final anchor = find.textContaining('Scroll root 20.');
    await tester.scrollUntilVisible(
      anchor,
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.drag(anchor, const Offset(0, -30));
    await tester.pumpAndSettle();
    final anchorTopBefore = tester.getTopLeft(anchor).dy;

    target.complete(
      _replyFor(
        'deep-target',
        'deep-root',
        'Deep target. ${'Long linked reply text. ' * 300}',
      ),
    );
    await tester.pumpAndSettle();

    expect(scrollable.controller!.position.pixels, greaterThan(0));
    expect(pollsApiClient.getCommentCalls, 1);
    expect(anchorTopBefore, greaterThanOrEqualTo(0));
    expect(
      tester.getTopLeft(anchor).dy,
      closeTo(anchorTopBefore, 0.1),
    );
    scrollable.controller!.jumpTo(0);
    await tester.pumpAndSettle();
    expect(find.text('Reply to Author'), findsOneWidget);
    final targetBody = find.textContaining('Deep target.');
    expect(tester.getSize(targetBody).height, greaterThan(1000));
    expect(targetBody, findsOneWidget);
  });

  testWidgets('does not move a viewport before the target context insertion',
      (tester) async {
    tester.view.physicalSize = const Size(400, 360);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final target = Completer<PollCommentSummary>();
    final pollWithTallCard = PollSummary(
      id: _poll.id,
      author: _poll.author,
      question: _poll.question,
      options: _poll.options,
      votesCount: _poll.votesCount,
      commentsCount: _poll.commentsCount,
      likesCount: _poll.likesCount,
      viewerHasLiked: _poll.viewerHasLiked,
      createdAt: _poll.createdAt,
    );
    final comments = [
      for (var index = 0; index < 20; index++)
        _rootComment(
          id: 'below-viewport-root-$index',
          body: 'Below viewport root $index.',
        ),
    ];
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value(comments),
      commentLoader: ({required commentId, required pollId}) => target.future,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: pollWithTallCard,
          accessToken: 'access-token',
          pollsApiClient: pollsApiClient,
          initialCommentId: 'below-viewport-target',
        ),
      ),
    );
    await tester.pumpAndSettle();

    final scrollable = find.byType(Scrollable).first;
    await tester.drag(scrollable, const Offset(0, -30));
    await tester.pumpAndSettle();
    final position = tester.state<ScrollableState>(scrollable).position;
    final offsetBefore = position.pixels;
    final question = find.text(_poll.question);
    final questionTopBefore = tester.getTopLeft(question).dy;

    target.complete(
      _rootComment(
        id: 'below-viewport-target',
        body: 'Long target. ${'Context below the visible poll card. ' * 300}',
      ),
    );
    await tester.pumpAndSettle();

    expect(position.pixels, closeTo(offsetBefore, 0.1));
    expect(tester.getTopLeft(question).dy, closeTo(questionTopBefore, 0.1));
  });

  testWidgets(
      'does not use a stale root anchor after returning to the poll card',
      (tester) async {
    tester.view.physicalSize = const Size(400, 360);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final target = Completer<PollCommentSummary>();
    final root = _rootComment(
      id: 'stale-anchor-root',
      body: 'Stale anchor root.',
      repliesCount: 1,
    );
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([
        root,
        for (var index = 1; index < 20; index++)
          _rootComment(id: 'stale-anchor-$index', body: 'Comment $index.'),
      ]),
      commentLoader: ({required commentId, required pollId}) => target.future,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          pollsApiClient: pollsApiClient,
          currentUserId: 'stale-anchor-user',
          initialCommentId: 'stale-anchor-reply',
        ),
      ),
    );
    await tester.pumpAndSettle();

    final scrollable = find.byType(CustomScrollView).first;
    final rootBody = find.textContaining('Stale anchor root.');
    await tester.scrollUntilVisible(
      rootBody,
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(tester.getTopLeft(rootBody).dy, lessThan(360));

    final position = tester
        .state<ScrollableState>(
          find.byType(Scrollable).first,
        )
        .position;
    await tester.drag(scrollable, const Offset(0, 5000));
    await tester.pumpAndSettle();
    expect(position.pixels, 0);

    final question = find.text(_poll.question);
    final questionTopBefore = tester.getTopLeft(question).dy;
    target.complete(
      _replyFor(
        'stale-anchor-reply',
        root.id,
        'Linked reply. ${'Long reply text. ' * 4}',
      ),
    );
    await tester.pumpAndSettle();

    expect(position.pixels, 0);
    expect(tester.getTopLeft(question).dy, closeTo(questionTopBefore, 0.1));
  });

  testWidgets('keeps linked context after a failed root refresh',
      (tester) async {
    tester.view.physicalSize = const Size(400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final cursors = <String?>[];
    final targetGets = <String>[];
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([]),
      commentsPageLoader: ({
        required pollId,
        required limit,
        required order,
        cursor,
      }) async {
        cursors.add(cursor);
        if (cursors.length == 1) {
          return CursorPage(
            items: [
              for (var index = 0; index < 20; index++)
                _rootComment(
                  id: 'refresh-root-$index',
                  body: 'Refresh root $index. ${'Long comment text. ' * 8}',
                ),
            ],
            nextCursor: 'root-cursor',
          );
        }
        throw const PollsApiException('Could not refresh comments.');
      },
      commentLoader: ({required commentId, required pollId}) async {
        targetGets.add(commentId);
        return _rootComment(
          id: commentId,
          body: 'Linked context survives refresh failure.',
        );
      },
    );

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          pollsApiClient: pollsApiClient,
          initialCommentId: 'external-target',
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(
        find.text('Linked context survives refresh failure.'), findsOneWidget);
    expect(find.text('Comment context'), findsOneWidget);

    final scrollable = find.byType(Scrollable).first;
    tester.state<ScrollableState>(scrollable).position.jumpTo(0);
    await tester.pumpAndSettle();
    await tester.drag(scrollable, const Offset(0, 350));
    await tester.pumpAndSettle();

    expect(find.text('Could not refresh comments.'), findsOneWidget);
    expect(
        find.text('Linked context survives refresh failure.'), findsOneWidget);
    expect(find.text('Comment context'), findsOneWidget);
    expect(cursors, [null, null]);
    expect(targetGets, ['external-target']);
  });

  testWidgets('does not jump when refresh resolves the same linked context',
      (tester) async {
    tester.view.physicalSize = const Size(400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final targetGets = <String>[];
    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([]),
      commentsPageLoader: ({
        required pollId,
        required limit,
        required order,
        cursor,
      }) async =>
          CursorPage(
        items: [
          for (var index = 0; index < 20; index++)
            _rootComment(
              id: 'refresh-stable-root-$index',
              body: 'Refresh root $index. ${'Long comment text. ' * 8}',
            ),
        ],
        nextCursor: 'root-cursor',
      ),
      commentLoader: ({required commentId, required pollId}) async {
        targetGets.add(commentId);
        return _rootComment(
          id: commentId,
          body: 'Stable linked context. ${'Long target text. ' * 200}',
        );
      },
    );

    await tester.pumpWidget(
      MaterialApp(
        home: PollCommentsScreen(
          poll: _poll,
          accessToken: 'access-token',
          pollsApiClient: pollsApiClient,
          initialCommentId: 'external-target',
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Comment context'), findsOneWidget);
    expect(targetGets, ['external-target']);

    final scrollable = find.byType(Scrollable).first;
    await tester.drag(scrollable, const Offset(0, -200));
    await tester.pumpAndSettle();
    final position = tester.state<ScrollableState>(scrollable).position;
    position.jumpTo(0);
    await tester.pumpAndSettle();
    final offsetBeforeRefresh = position.pixels;
    await tester.drag(scrollable, const Offset(0, 350));
    await tester.pumpAndSettle();

    expect(position.pixels, closeTo(offsetBeforeRefresh, 1));
    expect(find.text('Comment context'), findsOneWidget);
    expect(targetGets, ['external-target', 'external-target']);
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

  testWidgets('likes the poll from the comments screen', (tester) async {
    tester.view.physicalSize = const Size(400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final pollsApiClient = _FakePollsApiClient(
      commentsFuture: Future.value([]),
      likePollFuture: Future.value(_likedPoll),
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

    await tester.tap(find.byIcon(Icons.favorite_border));
    await tester.pumpAndSettle();

    expect(pollsApiClient.likePollCalls, 1);
    expect(find.byIcon(Icons.favorite), findsOneWidget);
    expect(find.byTooltip('Unlike'), findsOneWidget);
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

  testWidgets(
      'shows delete in the poll-style menu for the current user comment',
      (tester) async {
    tester.view.physicalSize = const Size(400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

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
    tester.view.physicalSize = const Size(400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

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
    tester.view.physicalSize = const Size(400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

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
    tester.view.physicalSize = const Size(400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

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
    expect(
        find.text('This comment will be removed permanently.'), findsOneWidget);

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

final _likedPoll = _poll.copyWith(
  likesCount: 1,
  viewerHasLiked: true,
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

PollCommentSummary _rootComment({
  String id = 'root-1',
  String body = 'Root comment.',
  int repliesCount = 0,
}) =>
    PollCommentSummary(
      id: id,
      pollId: 'poll-1',
      author: const PollAuthorSummary(
        id: 'author-1',
        username: 'author',
        displayName: 'Author',
      ),
      body: body,
      likesCount: 0,
      repliesCount: repliesCount,
      createdAt: DateTime(2026, 7, 17, 12),
      updatedAt: DateTime(2026, 7, 17, 12),
    );

PollCommentSummary _replyFor(String id, String rootCommentId, String body) =>
    PollCommentSummary(
      id: id,
      pollId: 'poll-1',
      author: const PollAuthorSummary(
        id: 'viewer-1',
        username: 'viewer',
        displayName: 'Viewer',
      ),
      body: body,
      likesCount: 0,
      parentCommentId: rootCommentId,
      createdAt: DateTime(2026, 7, 17, 12, 2),
      updatedAt: DateTime(2026, 7, 17, 12, 2),
    );

final _reply = PollCommentSummary(
  id: 'reply-1',
  pollId: 'poll-1',
  author: const PollAuthorSummary(
    id: 'viewer-1',
    username: 'viewer',
    displayName: 'Viewer',
  ),
  body: 'First reply.',
  likesCount: 0,
  parentCommentId: 'root-1',
  createdAt: DateTime(2026, 7, 17, 12, 2),
  updatedAt: DateTime(2026, 7, 17, 12, 2),
);

final _secondReply = PollCommentSummary(
  id: 'reply-2',
  pollId: 'poll-1',
  author: const PollAuthorSummary(
    id: 'viewer-2',
    username: 'viewer2',
    displayName: 'Second Viewer',
  ),
  body: 'Second reply.',
  likesCount: 0,
  parentCommentId: 'root-1',
  createdAt: DateTime(2026, 7, 17, 12, 3),
  updatedAt: DateTime(2026, 7, 17, 12, 3),
);

final _createdReply = PollCommentSummary(
  id: 'reply-3',
  pollId: 'poll-1',
  author: const PollAuthorSummary(
    id: 'viewer-1',
    username: 'viewer',
    displayName: 'Viewer',
  ),
  body: 'A reply to the root.',
  likesCount: 0,
  parentCommentId: 'root-1',
  createdAt: DateTime(2026, 7, 17, 12, 4),
  updatedAt: DateTime(2026, 7, 17, 12, 4),
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

final _createReplyResult = CreatePollCommentResult(
  comment: _createdReply,
  poll: _poll.copyWith(commentsCount: 2),
);

class _FakePollsApiClient extends PollsApiClient {
  _FakePollsApiClient({
    required this.commentsFuture,
    this.commentsPageLoader,
    Future<CreatePollCommentResult>? createCommentFuture,
    Future<PollCommentSummary>? likeCommentFuture,
    Future<PollSummary>? likePollFuture,
    Future<void>? deleteCommentFuture,
    this.replyPageLoader,
    this.commentLoader,
  })  : createCommentFuture =
            createCommentFuture ?? Future.value(_createCommentResult),
        likeCommentFuture = likeCommentFuture ?? Future.value(_likedComment),
        likePollFuture = likePollFuture ?? Future.value(_likedPoll),
        deleteCommentFuture = deleteCommentFuture ?? Future.value();

  final Future<List<PollCommentSummary>> commentsFuture;
  final Future<CursorPage<PollCommentSummary>> Function({
    required String pollId,
    required int limit,
    required String order,
    String? cursor,
  })? commentsPageLoader;
  final Future<CreatePollCommentResult> createCommentFuture;
  final Future<PollCommentSummary> likeCommentFuture;
  final Future<PollSummary> likePollFuture;
  final Future<void> deleteCommentFuture;
  final Future<PollCommentRepliesPage> Function({
    required String rootCommentId,
    required int limit,
    String? cursor,
  })? replyPageLoader;
  final Future<PollCommentSummary> Function({
    required String pollId,
    required String commentId,
  })? commentLoader;
  int createCommentCalls = 0;
  final List<String> createdCommentBodies = [];
  final List<String?> createdParentCommentIds = [];
  int replyPageCalls = 0;
  int getCommentCalls = 0;
  int likeCommentCalls = 0;
  int likePollCalls = 0;
  int deleteCommentCalls = 0;
  final List<Map<String, Object?>> commentsPageRequests = [];

  @override
  Future<CursorPage<PollCommentSummary>> listCommentsPage({
    required String pollId,
    int limit = 20,
    String order = 'newest',
    String? cursor,
    String? accessToken,
    String? requestId,
    int? pageNumber,
    String? paginationAction,
  }) async {
    commentsPageRequests.add({
      'pollId': pollId,
      'limit': limit,
      'order': order,
      'cursor': cursor,
    });
    final loader = commentsPageLoader;
    if (loader != null) {
      return loader(
        pollId: pollId,
        limit: limit,
        order: order,
        cursor: cursor,
      );
    }
    return CursorPage(
      items: await commentsFuture,
      nextCursor: null,
      paginationSupported: false,
    );
  }

  @override
  Future<List<PollCommentSummary>> listComments({
    required String pollId,
    int limit = 50,
    String? accessToken,
  }) {
    return commentsFuture;
  }

  @override
  Future<PollCommentRepliesPage> listCommentReplies({
    required String pollId,
    required String rootCommentId,
    int limit = 20,
    String? cursor,
    String? accessToken,
    String? requestId,
    int? pageNumber,
    String? paginationAction,
  }) {
    replyPageCalls++;
    return replyPageLoader?.call(
          rootCommentId: rootCommentId,
          limit: limit,
          cursor: cursor,
        ) ??
        Future.value(const PollCommentRepliesPage(items: [], nextCursor: null));
  }

  @override
  Future<PollCommentSummary> getComment({
    required String pollId,
    required String commentId,
    required String accessToken,
  }) {
    getCommentCalls++;
    final loader = commentLoader;
    if (loader != null) {
      return loader(pollId: pollId, commentId: commentId);
    }
    return Future.error(
      const PollsApiException('Comment was not found.', statusCode: 404),
    );
  }

  @override
  Future<CreatePollCommentResult> createComment({
    required String pollId,
    required String body,
    required String accessToken,
    String? parentCommentId,
  }) {
    createCommentCalls++;
    createdCommentBodies.add(body);
    createdParentCommentIds.add(parentCommentId);

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
  Future<PollSummary> likePoll({
    required String pollId,
    required String accessToken,
  }) {
    likePollCalls++;
    return likePollFuture;
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
