import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:yaskapp_mobile/src/core/config/api_config.dart';
import 'package:yaskapp_mobile/src/features/auth/auth_session.dart';
import 'package:yaskapp_mobile/src/features/polls/polls_api_client.dart';
import 'package:yaskapp_mobile/src/features/realtime/realtime_client.dart';
import 'package:yaskapp_mobile/src/features/subscriptions/subscriptions_screen.dart';

void main() {
  testWidgets('shows subscription polls and empty state', (tester) async {
    final client = PollsApiClient(
      config: const ApiConfig(baseUrl: 'http://api.test'),
      httpClient: MockClient((request) async {
        return http.Response(
          jsonEncode({
            'items': [_pollJson()]
          }),
          200,
        );
      }),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: SubscriptionsScreen(
          session: _session,
          pollsApiClient: client,
          realtimeClient: _FakeRealtimeClient(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Subscriptions'), findsOneWidget);
    expect(find.text('Which feature should be next?'), findsOneWidget);
  });

  testWidgets('shows empty state when there are no subscription polls',
      (tester) async {
    final client = PollsApiClient(
      config: const ApiConfig(baseUrl: 'http://api.test'),
      httpClient: MockClient((request) async {
        return http.Response(jsonEncode({'items': []}), 200);
      }),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: SubscriptionsScreen(
          session: _session,
          pollsApiClient: client,
          realtimeClient: _FakeRealtimeClient(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('No subscription polls yet'), findsOneWidget);
    expect(find.text('Follow users to see their polls here.'), findsOneWidget);
  });
}

class _FakeRealtimeClient extends RealtimeClient {
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

Map<String, dynamic> _pollJson() {
  return {
    'id': 'poll-1',
    'authorId': 'author-1',
    'author': {
      'id': 'author-1',
      'username': 'ada',
      'displayName': 'Ada',
      'avatarObjectKey': null,
    },
    'question': 'Which feature should be next?',
    'description': null,
    'imageObjectKey': null,
    'visibility': 'public',
    'optionsCount': 2,
    'votesCount': 0,
    'commentsCount': 0,
    'likesCount': 0,
    'viewerHasLiked': false,
    'options': [
      {'id': 'option-1', 'text': 'Profiles', 'position': 0, 'votesCount': 0},
      {'id': 'option-2', 'text': 'Themes', 'position': 1, 'votesCount': 0},
    ],
    'createdAt': '2026-07-21T10:00:00.000Z',
    'updatedAt': '2026-07-21T10:00:00.000Z',
    'endsAt': null,
  };
}
