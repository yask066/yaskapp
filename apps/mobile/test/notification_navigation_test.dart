import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:yaskapp_mobile/src/core/config/api_config.dart';
import 'package:yaskapp_mobile/src/features/notifications/notification_model.dart';
import 'package:yaskapp_mobile/src/features/notifications/notification_navigator.dart';
import 'package:yaskapp_mobile/src/features/notifications/notification_store.dart';
import 'package:yaskapp_mobile/src/features/notifications/notifications_api_client.dart';
import 'package:yaskapp_mobile/src/features/notifications/notifications_screen.dart';
import 'package:yaskapp_mobile/src/features/polls/poll_comments_screen.dart';
import 'package:yaskapp_mobile/src/features/polls/polls_api_client.dart';
import 'package:yaskapp_mobile/src/features/profile/profiles_api_client.dart';
import 'package:yaskapp_mobile/src/features/profile/public_profile_screen.dart';

void main() {
  testWidgets(
      'opens poll, comment, reply, both like targets and the followed profile',
      (tester) async {
    final requestedPaths = <String>[];
    final pollsApiClient = PollsApiClient(
      config: const ApiConfig(baseUrl: 'http://test'),
      httpClient: MockClient((request) async {
        requestedPaths.add(request.url.path);
        if (request.url.path == '/polls/poll-1') {
          return http.Response(jsonEncode({'poll': _pollJson}), 200);
        }
        if (request.url.path == '/polls/poll-1/comments') {
          return http.Response(jsonEncode({'items': _commentsJson}), 200);
        }
        if (request.url.path.startsWith('/polls/poll-1/comments/')) {
          final commentId = request.url.pathSegments.last;
          return http.Response(
            jsonEncode({'comment': _commentJson(commentId)}),
            200,
          );
        }
        if (request.url.path == '/users/actor-1/polls') {
          return http.Response('{"items":[]}', 200);
        }
        return http.Response('{"message":"not found"}', 404);
      }),
    );
    final profilesApiClient = ProfilesApiClient(
      config: const ApiConfig(baseUrl: 'http://test'),
      httpClient: MockClient((request) async {
        requestedPaths.add(request.url.path);
        return http.Response(jsonEncode({'user': _profileJson}), 200);
      }),
    );
    addTearDown(pollsApiClient.close);
    addTearDown(profilesApiClient.close);

    final scenarios = [
      _item(NotificationType.pollVote),
      _item(NotificationType.comment, commentId: 'comment-1'),
      _item(NotificationType.commentReply, commentId: 'reply-1'),
      _item(NotificationType.like, commentId: 'comment-2'),
      _item(NotificationType.like),
      _item(NotificationType.follow),
    ];

    for (final item in scenarios) {
      await tester.pumpWidget(MaterialApp(
        home: NotificationNavigationScope(
          accessToken: 'access-token',
          currentUserId: 'recipient-1',
          pollsApiClient: pollsApiClient,
          profilesApiClient: profilesApiClient,
          child: Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: ElevatedButton(
                  onPressed: () => unawaited(
                    openNotificationTarget(context, item),
                  ),
                  child: const Text('Open target'),
                ),
              ),
            ),
          ),
        ),
      ));
      await tester.tap(find.text('Open target'));
      await tester.pumpAndSettle();

      if (item.type == NotificationType.follow) {
        expect(find.byType(PublicProfileScreen), findsOneWidget);
        expect(find.text('alice'), findsWidgets);
      } else {
        expect(find.byType(PollCommentsScreen), findsOneWidget);
        expect(find.text('Which feature should be next?'), findsOneWidget);
        if (item.commentId != null) {
          expect(
            find.byKey(
                ValueKey('notification-target-comment-${item.commentId}')),
            findsOneWidget,
          );
        }
      }
      await tester.pageBack();
      await tester.pumpAndSettle();
    }

    expect(requestedPaths.where((path) => path == '/polls/poll-1').length, 5);
    expect(requestedPaths, contains('/users/actor-1'));
  });

  testWidgets('scrolls the target comment into view and highlights it',
      (tester) async {
    final requestedPaths = <String>[];
    final pollsApiClient = _pollsClient((request) async {
      requestedPaths.add(request.url.path);
      if (request.url.path == '/polls/poll-1') {
        return http.Response(jsonEncode({'poll': _pollJson}), 200);
      }
      if (request.url.path == '/polls/poll-1/comments/comment-80') {
        return http.Response(
          jsonEncode({
            'comment': _commentJson(
              'comment-80',
              body: 'Comment outside the first page',
            ),
          }),
          200,
        );
      }
      return http.Response(jsonEncode({'items': _longCommentsJson}), 200);
    });
    final profilesApiClient = _profilesClient();
    addTearDown(pollsApiClient.close);
    addTearDown(profilesApiClient.close);

    await tester.pumpWidget(MaterialApp(
      home: NotificationNavigationScope(
        accessToken: 'access-token',
        currentUserId: 'recipient-1',
        pollsApiClient: pollsApiClient,
        profilesApiClient: profilesApiClient,
        child: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: ElevatedButton(
                onPressed: () => unawaited(openNotificationTarget(
                  context,
                  _item(NotificationType.comment, commentId: 'comment-80'),
                )),
                child: const Text('Open target'),
              ),
            ),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('Open target'));
    await tester.pumpAndSettle();

    final target = find.byKey(
      const ValueKey('notification-target-comment-comment-80'),
    );
    expect(target, findsOneWidget);
    expect(find.text('Comment outside the first page'), findsOneWidget);
    expect(requestedPaths, contains('/polls/poll-1/comments/comment-80'));
    expect(tester.getTopLeft(target).dy, greaterThanOrEqualTo(0));
    expect(tester.getBottomRight(target).dy,
        lessThan(tester.view.physicalSize.height));
  });

  testWidgets('resolves a reply notification to its root and focuses the reply',
      (tester) async {
    final requestedPaths = <String>[];
    final root = {
      ..._commentJson('root-1', body: 'The root comment.'),
      'repliesCount': 1,
    };
    final reply = _commentJson(
      'reply-1',
      body: 'The exact reply notification target.',
      parentCommentId: 'root-1',
    );
    final earlierReply = _commentJson(
      'reply-0',
      body: 'An earlier reply on the first page.',
      parentCommentId: 'root-1',
    );
    final pollsApiClient = _pollsClient((request) async {
      requestedPaths.add(request.url.path);
      if (request.url.path == '/polls/poll-1') {
        return http.Response(jsonEncode({'poll': _pollJson}), 200);
      }
      if (request.url.path == '/polls/poll-1/comments') {
        return http.Response('{"items":[]}', 200);
      }
      if (request.url.path == '/polls/poll-1/comments/reply-1') {
        return http.Response(jsonEncode({'comment': reply}), 200);
      }
      if (request.url.path == '/polls/poll-1/comments/root-1') {
        return http.Response(jsonEncode({'comment': root}), 200);
      }
      if (request.url.path == '/polls/poll-1/comments/root-1/replies') {
        final cursor = request.url.queryParameters['cursor'];
        return http.Response(
          jsonEncode(cursor == null
              ? {
                  'items': [earlierReply],
                  'nextCursor': 'reply-page-2',
                }
              : {
                  'items': [reply],
                  'nextCursor': null,
                }),
          200,
        );
      }
      return http.Response('{"message":"not found"}', 404);
    });
    final profilesApiClient = _profilesClient();
    addTearDown(pollsApiClient.close);
    addTearDown(profilesApiClient.close);

    await tester.pumpWidget(MaterialApp(
      home: NotificationNavigationScope(
        accessToken: 'access-token',
        currentUserId: 'recipient-1',
        pollsApiClient: pollsApiClient,
        profilesApiClient: profilesApiClient,
        child: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: ElevatedButton(
                onPressed: () => unawaited(openNotificationTarget(
                  context,
                  _item(NotificationType.commentReply, commentId: 'reply-1'),
                )),
                child: const Text('Open reply notification'),
              ),
            ),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('Open reply notification'));
    await tester.pumpAndSettle();

    final target = find.byKey(
      const ValueKey('notification-target-comment-reply-1'),
    );
    expect(find.byType(PollCommentsScreen), findsOneWidget);
    expect(find.text('The root comment.'), findsOneWidget);
    expect(find.text('The exact reply notification target.'), findsOneWidget);
    expect(target, findsOneWidget);
    expect(requestedPaths, contains('/polls/poll-1/comments/reply-1'));
    expect(requestedPaths, contains('/polls/poll-1/comments/root-1'));
    expect(
      requestedPaths,
      contains('/polls/poll-1/comments/root-1/replies'),
    );
    expect(
      requestedPaths
          .where((path) => path == '/polls/poll-1/comments/root-1/replies')
          .length,
      2,
    );
    expect(tester.getTopLeft(target).dy, greaterThanOrEqualTo(0));
    final targetFocus = find.descendant(
      of: target,
      matching: find.byType(Focus),
    );
    expect(
      tester.widget<Focus>(targetFocus).focusNode?.hasFocus,
      isTrue,
    );
  });

  testWidgets('unavailable targets show a safe fallback without navigation',
      (tester) async {
    final store = NotificationStore();
    store.mergePage(
      items: [_item(NotificationType.pollVote, available: false)],
      unreadCount: 1,
    );
    addTearDown(store.close);
    final pollsApiClient = _pollsClient((_) async {
      fail('Unavailable targets must not trigger a target request.');
    });
    final profilesApiClient = _profilesClient();
    addTearDown(pollsApiClient.close);
    addTearDown(profilesApiClient.close);

    await tester.pumpWidget(MaterialApp(
      home: NotificationNavigationScope(
        accessToken: 'access-token',
        currentUserId: 'recipient-1',
        pollsApiClient: pollsApiClient,
        profilesApiClient: profilesApiClient,
        child: NotificationsScreen(notificationStore: store),
      ),
    ));
    await tester.tap(find.byKey(const ValueKey('notification-card-item-1')));
    await tester.pumpAndSettle();

    expect(find.byType(NotificationsScreen), findsOneWidget);
    expect(find.text('This content is no longer available.'), findsOneWidget);
    expect(store.state.itemsById, contains('item-1'));
  });

  testWidgets('missing comment targets keep the poll open and show a fallback',
      (tester) async {
    final pollsApiClient = _pollsClient((request) async {
      if (request.url.path == '/polls/poll-1') {
        return http.Response(jsonEncode({'poll': _pollJson}), 200);
      }
      if (request.url.path == '/polls/poll-1/comments') {
        return http.Response('{"items":[]}', 200);
      }
      return http.Response('{"message":"Comment was not found."}', 404);
    });
    final profilesApiClient = _profilesClient();
    addTearDown(pollsApiClient.close);
    addTearDown(profilesApiClient.close);

    await tester.pumpWidget(MaterialApp(
      home: NotificationNavigationScope(
        accessToken: 'access-token',
        currentUserId: 'recipient-1',
        pollsApiClient: pollsApiClient,
        profilesApiClient: profilesApiClient,
        child: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: ElevatedButton(
                onPressed: () => unawaited(openNotificationTarget(
                  context,
                  _item(
                    NotificationType.comment,
                    commentId: 'comment-missing',
                  ),
                )),
                child: const Text('Open target'),
              ),
            ),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('Open target'));
    await tester.pumpAndSettle();

    expect(find.byType(PollCommentsScreen), findsOneWidget);
    expect(find.text('This comment is no longer available.'), findsOneWidget);
  });

  testWidgets('failed read mutation reconciles without removing the card',
      (tester) async {
    final requests = <http.Request>[];
    final notificationClient = NotificationsApiClient(
      config: const ApiConfig(baseUrl: 'http://test'),
      httpClient: MockClient((request) async {
        requests.add(request);
        if (request.method == 'POST' &&
            request.url.path == '/notifications/item-1/read') {
          return http.Response('{"message":"offline"}', 503);
        }
        if (request.method == 'GET' && request.url.path == '/notifications') {
          return http.Response(
            jsonEncode({
              'items': [
                _wireItem('item-1', unread: false),
                _wireItem('item-2', unread: true),
              ],
              'nextCursor': null,
              'unreadCount': 1,
            }),
            200,
          );
        }
        return http.Response('{}', 200);
      }),
    );
    final pollsApiClient = _pollsClient((request) async {
      if (request.url.path == '/polls/poll-1') {
        return http.Response(jsonEncode({'poll': _pollJson}), 200);
      }
      return http.Response('{"items":[]}', 200);
    });
    final profilesApiClient = _profilesClient();
    final store = NotificationStore(
      apiClient: notificationClient,
      accessToken: 'access-token',
    );
    store.mergePage(
      items: [
        _item(NotificationType.pollVote),
        _item(NotificationType.pollVote, id: 'item-2'),
      ],
      unreadCount: 2,
    );
    addTearDown(store.close);
    addTearDown(pollsApiClient.close);
    addTearDown(profilesApiClient.close);

    await tester.pumpWidget(MaterialApp(
      home: NotificationNavigationScope(
        accessToken: 'access-token',
        currentUserId: 'recipient-1',
        pollsApiClient: pollsApiClient,
        profilesApiClient: profilesApiClient,
        child: NotificationsScreen(notificationStore: store),
      ),
    ));
    await tester.tap(find.byKey(const ValueKey('notification-card-item-1')));
    await tester.pumpAndSettle();

    expect(requests.any((request) => request.method == 'POST'), isTrue);
    expect(
        requests.where((request) =>
            request.method == 'GET' && request.url.path == '/notifications'),
        hasLength(1));
    expect(store.state.itemsById, contains('item-1'));
    expect(store.state.itemsById['item-1']!.isUnread, isFalse);
    expect(store.state.itemsById['item-2']!.isUnread, isTrue);
    expect(store.state.unreadCount, 1);
  });
}

PollsApiClient _pollsClient(
        Future<http.Response> Function(http.Request) handler) =>
    PollsApiClient(
      config: const ApiConfig(baseUrl: 'http://test'),
      httpClient: MockClient(handler),
    );

ProfilesApiClient _profilesClient() => ProfilesApiClient(
      config: const ApiConfig(baseUrl: 'http://test'),
      httpClient: MockClient(
          (_) async => http.Response(jsonEncode({'user': _profileJson}), 200)),
    );

NotificationItem _item(
  NotificationType type, {
  String id = 'item-1',
  String? commentId,
  bool available = true,
}) {
  final isFollow = type == NotificationType.follow;
  return NotificationItem(
    id: id,
    type: type,
    actor: const NotificationActor(
      id: 'actor-1',
      username: 'alice',
      displayName: 'Alice',
    ),
    target: NotificationTarget(
      type: isFollow
          ? NotificationTargetType.profile
          : commentId == null
              ? NotificationTargetType.poll
              : NotificationTargetType.comment,
      pollId: isFollow ? null : 'poll-1',
      commentId: commentId,
    ),
    payload: const {},
    readAt: null,
    createdAt: DateTime.utc(2026, 9, 20),
    isTargetAvailable: available,
  );
}

Map<String, dynamic> _wireItem(String id, {required bool unread}) => {
      'id': id,
      'type': 'poll_vote',
      'actor': {
        'id': 'actor-1',
        'username': 'alice',
        'displayName': 'Alice',
      },
      'targetType': 'poll',
      'pollId': 'poll-1',
      'commentId': null,
      'payload': <String, dynamic>{},
      'readAt': unread ? null : '2026-09-21T12:00:00.000Z',
      'createdAt': '2026-09-20T12:00:00.000Z',
      'isTargetAvailable': true,
    };

final _pollJson = <String, dynamic>{
  'id': 'poll-1',
  'authorId': 'author-1',
  'author': {
    'id': 'author-1',
    'username': 'author',
    'displayName': 'Author',
    'avatarObjectKey': null,
    'avatarUrl': null,
  },
  'question': 'Which feature should be next?',
  'description': null,
  'imageUrl': null,
  'visibility': 'public',
  'optionsCount': 2,
  'votesCount': 0,
  'commentsCount': 0,
  'likesCount': 0,
  'viewerHasLiked': false,
  'allowVoteCancellation': false,
  'options': [
    {'id': 'option-1', 'text': 'One', 'position': 0, 'votesCount': 0},
    {'id': 'option-2', 'text': 'Two', 'position': 1, 'votesCount': 0},
  ],
  'createdAt': '2026-09-20T12:00:00.000Z',
  'updatedAt': '2026-09-20T12:00:00.000Z',
  'endsAt': null,
};

final _profileJson = <String, dynamic>{
  'id': 'actor-1',
  'username': 'alice',
  'status': 'active',
  'profile': {
    'displayName': 'Alice',
    'bio': null,
    'countryCode': null,
    'avatarObjectKey': null,
    'avatarUrl': null,
    'pollsCount': 0,
    'followersCount': 0,
    'followingCount': 0,
  },
  'viewerIsFollowing': false,
};

final _commentsJson = [
  _commentJson('comment-1'),
  _commentJson('comment-2'),
];

final _longCommentsJson = List.generate(
  16,
  (index) => _commentJson(
    'comment-$index',
    body: 'Comment $index ${'A detailed comment. ' * 8}',
  ),
);

Map<String, dynamic> _commentJson(
  String id, {
  String? body,
  String? parentCommentId,
  int repliesCount = 0,
}) =>
    {
      'id': id,
      'pollId': 'poll-1',
      'author': {
        'id': 'commenter-$id',
        'username': 'commenter',
        'displayName': 'Commenter $id',
        'avatarObjectKey': null,
      },
      'body': body ?? 'Body for $id',
      'likesCount': 0,
      'viewerHasLiked': false,
      'parentCommentId': parentCommentId,
      'repliesCount': repliesCount,
      'createdAt': '2026-09-20T12:00:00.000Z',
      'updatedAt': '2026-09-20T12:00:00.000Z',
    };
