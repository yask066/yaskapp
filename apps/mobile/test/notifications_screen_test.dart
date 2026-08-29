import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:yaskapp_mobile/src/core/config/api_config.dart';
import 'package:yaskapp_mobile/src/features/auth/auth_session.dart';
import 'package:yaskapp_mobile/src/features/notifications/notifications_api_client.dart';
import 'package:yaskapp_mobile/src/features/notifications/notifications_screen.dart';
import 'package:yaskapp_mobile/src/features/realtime/realtime_client.dart';

class _TestRealtimeClient extends RealtimeClient {
  _TestRealtimeClient() : super(accessToken: 'token');

  @override
  void connect() {}

  @override
  Future<void> close() async {}
}

void main() {
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
          '{"items":[{"id":"notification-1","type":"follow","actor":{"username":"alice","displayName":"Alice"},"pollId":null,"commentId":null,"readAt":null,"createdAt":"2026-08-29T10:00:00.000Z","isTargetAvailable":true}],"nextCursor":null,"unreadCount":1}',
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
    expect(requests.map((request) => request.url.path),
        contains('/notifications/read-all'));
  });
}
