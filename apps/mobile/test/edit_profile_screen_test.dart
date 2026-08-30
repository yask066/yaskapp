import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:yaskapp_mobile/src/core/config/api_config.dart';
import 'package:yaskapp_mobile/src/features/auth/auth_api_client.dart';
import 'package:yaskapp_mobile/src/features/auth/auth_session.dart';
import 'package:yaskapp_mobile/src/features/profile/edit_profile_screen.dart';

void main() {
  testWidgets('does not show Log out on the edit profile screen',
      (tester) async {
    final apiClient = AuthApiClient(
      config: const ApiConfig(baseUrl: 'http://api.test'),
      httpClient: MockClient((_) async {
        return http.Response(jsonEncode({'user': _userJson(null)}), 200);
      }),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: EditProfileScreen(
          user: _user(null),
          accessToken: 'access-token',
          authApiClient: apiClient,
          onLogout: () {},
        ),
      ),
    );

    expect(find.text('Log out'), findsNothing);
  });

  testWidgets('shows Not selected for a legacy profile', (tester) async {
    final apiClient = AuthApiClient(
      config: const ApiConfig(baseUrl: 'http://api.test'),
      httpClient: MockClient((_) async {
        return http.Response(jsonEncode({'user': _userJson(null)}), 200);
      }),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: EditProfileScreen(
          user: _user(null),
          accessToken: 'access-token',
          authApiClient: apiClient,
          onLogout: () {},
        ),
      ),
    );

    expect(find.text('Not selected'), findsOneWidget);
  });
}

AuthUser _user(String? countryCode) {
  return AuthUser.fromJson(_userJson(countryCode));
}

Map<String, dynamic> _userJson(String? countryCode) {
  return {
    'id': 'user-1',
    'email': 'user@example.com',
    'username': 'user_123',
    'status': 'active',
    'profile': {
      'displayName': 'Test User',
      'bio': null,
      'countryCode': countryCode,
      'avatarObjectKey': null,
      'pollsCount': 0,
      'followersCount': 0,
      'followingCount': 0,
    },
  };
}
