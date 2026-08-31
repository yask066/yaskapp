import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:yaskapp_mobile/src/core/config/api_config.dart';
import 'package:yaskapp_mobile/src/features/auth/auth_session.dart';
import 'package:yaskapp_mobile/src/features/notifications/notifications_api_client.dart';
import 'package:yaskapp_mobile/src/features/notifications/notifications_screen.dart';
import 'package:yaskapp_mobile/src/features/realtime/realtime_client.dart';
import 'package:yaskapp_mobile/src/core/widgets/user_avatar.dart';

class _TestRealtimeClient extends RealtimeClient {
  _TestRealtimeClient() : super(accessToken: 'token');

  @override
  void connect() {}

  @override
  Future<void> close() async {}
}

void main() {
  test('formats notification age using the largest suitable unit', () {
    final now = DateTime(2026, 8, 30, 12);

    expect(notificationAgeLabel(now, now: now), '0 seconds ago');
    expect(notificationAgeLabel(now.subtract(const Duration(seconds: 12)), now: now), '12 seconds ago');
    expect(notificationAgeLabel(now.subtract(const Duration(minutes: 5)), now: now), '5 minutes ago');
    expect(notificationAgeLabel(now.subtract(const Duration(hours: 2)), now: now), '2 hours ago');
    expect(notificationAgeLabel(now.subtract(const Duration(days: 3)), now: now), '3 days ago');
    expect(notificationAgeLabel(now.subtract(const Duration(days: 14)), now: now), '2 weeks ago');
    expect(notificationAgeLabel(now.subtract(const Duration(days: 60)), now: now), '2 months ago');
    expect(notificationAgeLabel(now.subtract(const Duration(days: 730)), now: now), '2 years ago');
  });

  test('notifications load only when the tab becomes active', () {
    expect(shouldLoadNotifications(isActive: false, wasActive: false), isFalse);
    expect(shouldLoadNotifications(isActive: true, wasActive: false), isTrue);
    expect(shouldLoadNotifications(isActive: true, wasActive: true), isFalse);
  });

  test('notification summary exposes readable details for the notification tab',
      () {
    final item = NotificationSummary.fromJson({
      'id': 'notification-1',
      'type': 'comment',
      'actor': {
        'username': 'alice',
        'displayName': 'Alice',
        'avatarUrl': null,
      },
      'pollId': 'poll-1',
      'commentId': 'comment-1',
      'readAt': null,
      'createdAt': '2026-08-29T10:00:00.000Z',
      'isTargetAvailable': true,
    });

    expect(item.title, 'Alice commented on your poll');
    expect(item.detail, 'Open the comment to view the discussion');
    expect(item.targetLabel, 'Poll and comment');
    expect(item.isUnread, isTrue);
  });

  testWidgets('notification tab loads the first page on open', (tester) async {
    final requests = <http.Request>[];
    final apiClient = NotificationsApiClient(
      config: const ApiConfig(baseUrl: 'http://test'),
      httpClient: MockClient((request) async {
        requests.add(request);
        if (request.url.path == '/notifications/read-all') {
          return http.Response('{"unreadCount":0}', 200);
        }
        return http.Response(
          '{"items":[{"id":"notification-1","type":"follow","actor":{"username":"alice","displayName":"Alice","avatarUrl":"/media/avatars/alice"},"pollId":null,"commentId":null,"readAt":null,"createdAt":"2026-08-29T10:00:00.000Z","isTargetAvailable":true}],"nextCursor":null,"unreadCount":1}',
          200,
        );
      }),
    );
    final session = AuthSession(
      user: AuthUser(
        id: 'user-1',
        email: 'user@example.com',
        username: 'user',
        status: 'active',
        profile: AuthUserProfile(
          displayName: 'User',
          pollsCount: 0,
          followersCount: 0,
          followingCount: 0,
        ),
      ),
      accessToken: 'token',
      tokenType: 'Bearer',
      expiresIn: '1h',
    );

    await tester.pumpWidget(MaterialApp(
      home: NotificationsScreen(
        session: session,
        isActive: true,
        apiClient: apiClient,
        realtimeClient: _TestRealtimeClient(),
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Alice started following you'), findsOneWidget);
    expect(find.text('Earlier'), findsOneWidget);
    expect(find.text('Mark all read'), findsNothing);
    final avatar = tester.widget<UserAvatar>(find.byType(UserAvatar));
    expect(avatar.displayName, 'Alice');
    expect(avatar.username, 'alice');
    expect(avatar.imageUrl, '/media/avatars/alice');
    expect(requests.map((request) => request.url.path),
        contains('/notifications/read-all'));
  });

  testWidgets('renders reference-style header and grouped notification cards',
      (tester) async {
    final apiClient = NotificationsApiClient(
      config: const ApiConfig(baseUrl: 'http://test'),
      httpClient: MockClient((request) async {
        if (request.url.path == '/notifications/read-all') {
          return http.Response('{"unreadCount":0}', 200);
        }
        return http.Response(
          '{"items":['
          '{"id":"today","type":"comment","actor":{"username":"alice","displayName":"Alice","avatarUrl":null},"pollId":"poll-1","commentId":"comment-1","readAt":null,"createdAt":"2026-08-31T10:00:00.000Z","isTargetAvailable":true},'
          '{"id":"yesterday","type":"like","actor":{"username":"bob","displayName":"Bob","avatarUrl":null},"pollId":"poll-2","commentId":null,"readAt":"2026-08-30T10:00:00.000Z","createdAt":"2026-08-30T10:00:00.000Z","isTargetAvailable":true},'
          '{"id":"earlier","type":"poll_vote","actor":{"username":"cara","displayName":"Cara","avatarUrl":null},"pollId":"poll-3","commentId":null,"readAt":"2026-08-28T10:00:00.000Z","createdAt":"2026-08-28T10:00:00.000Z","isTargetAvailable":true}'
          '],"nextCursor":null,"unreadCount":1}',
          200,
        );
      }),
    );
    final session = AuthSession(
      user: AuthUser(
        id: 'user-1',
        email: 'user@example.com',
        username: 'user',
        status: 'active',
        profile: AuthUserProfile(
          displayName: 'User', pollsCount: 0, followersCount: 0, followingCount: 0,
        ),
      ),
      accessToken: 'token', tokenType: 'Bearer', expiresIn: '1h',
    );

    await tester.pumpWidget(MaterialApp(
      home: NotificationsScreen(
        session: session, isActive: true, apiClient: apiClient,
        realtimeClient: _TestRealtimeClient(),
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Notifications'), findsOneWidget);
    expect(find.text('Mark all as read'), findsNothing);
    expect(find.text('Today'), findsOneWidget);
    expect(find.text('Yesterday'), findsOneWidget);
    expect(find.text('Earlier'), findsOneWidget);
    expect(find.byKey(const ValueKey('notification-card-today')), findsOneWidget);
    expect(find.byKey(const ValueKey('notification-event-comment')), findsOneWidget);

    final header = tester.getSize(find.byKey(const ValueKey('notifications-header')));
    expect(header.height, 68);
    expect(tester.getSize(find.byKey(const ValueKey('notification-avatar-today'))).width, 52);
    expect(tester.getSize(find.byKey(const ValueKey('notification-event-comment'))).width, 28);
    expect(tester.getSize(find.byKey(const ValueKey('notification-preview-today'))).width, 68);
  });

  testWidgets('inactive notification tab does not load until activated',
      (tester) async {
    final requests = <http.Request>[];
    final apiClient = NotificationsApiClient(
      config: const ApiConfig(baseUrl: 'http://test'),
      httpClient: MockClient((request) async {
        requests.add(request);
        if (request.url.path == '/notifications/read-all') {
          return http.Response('{"unreadCount":0}', 200);
        }
        return http.Response(
          '{"items":[],"nextCursor":null,"unreadCount":0}',
          200,
        );
      }),
    );
    final session = AuthSession(
      user: AuthUser(
        id: 'user-1',
        email: 'user@example.com',
        username: 'user',
        status: 'active',
        profile: AuthUserProfile(
          displayName: 'User',
          pollsCount: 0,
          followersCount: 0,
          followingCount: 0,
        ),
      ),
      accessToken: 'token',
      tokenType: 'Bearer',
      expiresIn: '1h',
    );
    final realtimeClient = _TestRealtimeClient();

    await tester.pumpWidget(MaterialApp(
      home: NotificationsScreen(
        session: session,
        isActive: false,
        apiClient: apiClient,
        realtimeClient: realtimeClient,
      ),
    ));
    await tester.pump();
    expect(requests, isEmpty);

    await tester.pumpWidget(MaterialApp(
      home: NotificationsScreen(
        session: session,
        isActive: true,
        apiClient: apiClient,
        realtimeClient: realtimeClient,
      ),
    ));
    await tester.pumpAndSettle();

    expect(requests.map((request) => request.url.path),
        contains('/notifications'));
  });

  testWidgets('does not mark notifications read after leaving during loading',
      (tester) async {
    final responseCompleter = Completer<http.Response>();
    final requests = <http.Request>[];
    final apiClient = NotificationsApiClient(
      config: const ApiConfig(baseUrl: 'http://test'),
      httpClient: MockClient((request) async {
        requests.add(request);
        return responseCompleter.future;
      }),
    );
    final session = AuthSession(
      user: AuthUser(
        id: 'user-1',
        email: 'user@example.com',
        username: 'user',
        status: 'active',
        profile: AuthUserProfile(
          displayName: 'User',
          pollsCount: 0,
          followersCount: 0,
          followingCount: 0,
        ),
      ),
      accessToken: 'token',
      tokenType: 'Bearer',
      expiresIn: '1h',
    );

    await tester.pumpWidget(MaterialApp(
      home: NotificationsScreen(
        session: session,
        isActive: true,
        apiClient: apiClient,
        realtimeClient: _TestRealtimeClient(),
      ),
    ));
    await tester.pump();

    await tester.pumpWidget(MaterialApp(
      home: NotificationsScreen(
        session: session,
        isActive: false,
        apiClient: apiClient,
        realtimeClient: _TestRealtimeClient(),
      ),
    ));
    responseCompleter.complete(http.Response(
      '{"items":[],"nextCursor":null,"unreadCount":1}',
      200,
    ));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(requests.map((request) => request.url.path),
        isNot(contains('/notifications/read-all')));
  });
}
