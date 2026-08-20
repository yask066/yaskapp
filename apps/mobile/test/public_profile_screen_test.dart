import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:yaskapp_mobile/src/core/config/api_config.dart';
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
    expect(find.text('Follow'), findsOneWidget);

    await tester.tap(find.text('Follow'));
    await tester.pumpAndSettle();

    expect(methods, ['GET', 'POST']);
    expect(find.widgetWithText(OutlinedButton, 'Following'), findsOneWidget);
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
      'avatarObjectKey': null,
      'pollsCount': 3,
      'followersCount': following ? 1 : 0,
      'followingCount': 4,
    },
  };
}
