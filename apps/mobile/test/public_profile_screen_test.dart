import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:yaskapp_mobile/src/core/config/api_config.dart';
import 'package:yaskapp_mobile/src/features/polls/polls_api_client.dart';
import 'package:yaskapp_mobile/src/features/profile/profiles_api_client.dart';
import 'package:yaskapp_mobile/src/features/profile/public_profile_screen.dart';

void main() {
  testWidgets('loads public profile and follows the user', (tester) async {
    final methods = <String>[];
    final client = ProfilesApiClient(
      config: const ApiConfig(baseUrl: 'http://api.test'),
      httpClient: MockClient((request) async {
        methods.add(request.method);
        if (request.method == 'GET') {
          return http.Response(jsonEncode({'user': _profileJson(false)}), 200);
        }
        return http.Response(
          jsonEncode({
            'following': true,
            'followerFollowingCount': 1,
            'followeeFollowersCount': 1,
          }),
          201,
        );
      }),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: PublicProfileScreen(
          userId: 'user-2',
          currentUserId: 'user-1',
          accessToken: 'access-token',
          profilesApiClient: client,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('ada'), findsOneWidget);
    expect(find.text('Belarus'), findsOneWidget);
    expect(find.text('Follow'), findsOneWidget);

    await tester.tap(find.text('Follow'));
    await tester.pumpAndSettle();

    expect(methods, ['GET', 'POST']);
    expect(find.widgetWithText(OutlinedButton, 'Following'), findsOneWidget);
  });

  testWidgets('shows public polls created by the user', (tester) async {
    final profilesClient = ProfilesApiClient(
      config: const ApiConfig(baseUrl: 'http://api.test'),
      httpClient: MockClient((request) async {
        return http.Response(jsonEncode({'user': _profileJson(false)}), 200);
      }),
    );
    final pollsClient = PollsApiClient(
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
        home: PublicProfileScreen(
          userId: 'user-2',
          currentUserId: 'user-1',
          accessToken: 'access-token',
          profilesApiClient: profilesClient,
          pollsApiClient: pollsClient,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('A public poll'), findsOneWidget);
  });
}

Map<String, dynamic> _profileJson(bool following) {
  return {
    'id': 'user-2',
    'username': 'ada',
    'status': 'active',
    'createdAt': '2026-07-21T10:00:00.000Z',
    'updatedAt': '2026-07-21T10:00:00.000Z',
    'viewerIsFollowing': following,
    'profile': {
      'displayName': 'Ada Lovelace',
      'bio': 'Polls and conversations.',
      'countryCode': 'BY',
      'avatarObjectKey': null,
      'pollsCount': 3,
      'followersCount': following ? 1 : 0,
      'followingCount': 4,
    },
  };
}

Map<String, dynamic> _pollJson() {
  return {
    'id': 'poll-1',
    'authorId': 'user-2',
    'author': {
      'id': 'user-2',
      'username': 'ada',
      'displayName': 'Ada Lovelace',
      'avatarObjectKey': null,
    },
    'question': 'A public poll',
    'description': null,
    'imageObjectKey': null,
    'visibility': 'public',
    'optionsCount': 2,
    'votesCount': 0,
    'commentsCount': 0,
    'likesCount': 0,
    'viewerHasLiked': false,
    'options': [
      {'id': 'option-1', 'text': 'Yes', 'position': 0, 'votesCount': 0},
      {'id': 'option-2', 'text': 'No', 'position': 1, 'votesCount': 0},
    ],
    'createdAt': '2026-07-21T10:00:00.000Z',
    'updatedAt': '2026-07-21T10:00:00.000Z',
    'endsAt': null,
  };
}
