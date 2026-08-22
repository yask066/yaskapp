import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:yaskapp_mobile/src/core/config/api_config.dart';
import 'package:yaskapp_mobile/src/features/auth/auth_api_client.dart';

void main() {
  const config = ApiConfig(baseUrl: 'http://api.test');

  test('uploads avatar as multipart field avatar', () async {
    late http.BaseRequest request;
    final client = AuthApiClient(
      config: config,
      httpClient: MockClient((incoming) async {
        request = incoming;
        final body = await incoming.finalize().bytesToString();
        expect(body, contains('name="avatar"'));
        expect(body, contains('filename="avatar.png"'));
        return http.Response(jsonEncode({'user': _userJson('/media/avatars/user-1')}), 200);
      }),
    );

    final user = await client.uploadAvatar(
      accessToken: 'access-token',
      bytes: Uint8List.fromList([137, 80, 78, 71]),
      filename: 'avatar.png',
      contentType: 'image/png',
    );

    expect(request.method, 'POST');
    expect(request.url.path, '/profiles/me/avatar');
    expect(request.headers['authorization'], 'Bearer access-token');
    expect(user.profile.avatarUrl, '/media/avatars/user-1');
  });

  test('deletes avatar with authorization', () async {
    late http.Request request;
    final client = AuthApiClient(
      config: config,
      httpClient: MockClient((incoming) async {
        request = incoming;
        return http.Response(jsonEncode({'user': _userJson(null)}), 200);
      }),
    );

    final user = await client.deleteAvatar(accessToken: 'access-token');

    expect(request.method, 'DELETE');
    expect(request.url.path, '/profiles/me/avatar');
    expect(request.headers['authorization'], 'Bearer access-token');
    expect(user.profile.avatarUrl, isNull);
  });
}

Map<String, dynamic> _userJson(String? avatarUrl) {
  return {
    'id': 'user-1',
    'email': 'user@example.com',
    'username': 'user_123',
    'status': 'active',
    'profile': {
      'displayName': 'Test User',
      'bio': null,
      'countryCode': 'BY',
      'avatarObjectKey': avatarUrl == null ? null : 'avatars/user-1/key.webp',
      'avatarUrl': avatarUrl,
      'pollsCount': 0,
      'followersCount': 0,
      'followingCount': 0,
    },
  };
}
