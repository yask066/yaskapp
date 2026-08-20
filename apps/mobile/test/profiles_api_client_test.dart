import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:yaskapp_mobile/src/core/config/api_config.dart';
import 'package:yaskapp_mobile/src/features/profile/profiles_api_client.dart';

void main() {
  const config = ApiConfig(baseUrl: 'http://api.test');

  test('loads a public profile with optional authorization', () async {
    late http.Request request;
    final client = ProfilesApiClient(
      config: config,
      httpClient: MockClient((incoming) async {
        request = incoming;
        return http.Response(
          jsonEncode({'user': _profileJson()}),
          200,
        );
      }),
    );

    final profile = await client.getPublicProfile(
      userId: 'user-1',
      accessToken: 'access-token',
    );

    expect(request.method, 'GET');
    expect(request.url.path, '/users/user-1');
    expect(request.headers['authorization'], 'Bearer access-token');
    expect(profile.username, 'ada');
    expect(profile.followersCount, 12);
    expect(profile.viewerIsFollowing, isTrue);
  });

  test('follows and unfollows a user', () async {
    final requests = <http.Request>[];
    final client = ProfilesApiClient(
      config: config,
      httpClient: MockClient((request) async {
        requests.add(request);
        return http.Response(
          jsonEncode({
            'following': request.method == 'POST',
            'followerFollowingCount': request.method == 'POST' ? 4 : 3,
            'followeeFollowersCount': request.method == 'POST' ? 13 : 12,
          }),
          201,
        );
      }),
    );

    final followed = await client.follow(
      userId: 'user-2',
      accessToken: 'access-token',
    );
    final unfollowed = await client.unfollow(
      userId: 'user-2',
      accessToken: 'access-token',
    );

    expect(requests.map((request) => request.method), ['POST', 'DELETE']);
    expect(requests.every(
      (request) => request.url.path == '/users/user-2/follow' &&
          request.headers['authorization'] == 'Bearer access-token',
    ), isTrue);
    expect(followed.following, isTrue);
    expect(unfollowed.following, isFalse);
  });

  test('loads following and followers with limits', () async {
    final requestedUris = <Uri>[];
    final client = ProfilesApiClient(
      config: config,
      httpClient: MockClient((request) async {
        requestedUris.add(request.url);
        return http.Response(jsonEncode({'items': [_profileJson()]}), 200);
      }),
    );

    final followers = await client.listFollowers(
      userId: 'user-1',
      limit: 10,
    );
    final following = await client.listFollowing(
      accessToken: 'access-token',
      limit: 25,
    );

    expect(requestedUris[0].path, '/users/user-1/followers');
    expect(requestedUris[0].queryParameters['limit'], '10');
    expect(requestedUris[1].path, '/profiles/me/following');
    expect(requestedUris[1].queryParameters['limit'], '25');
    expect(followers.single.id, 'user-1');
    expect(following.single.displayName, 'Ada Lovelace');
  });
}

Map<String, dynamic> _profileJson() {
  return {
    'id': 'user-1',
    'username': 'ada',
    'status': 'active',
    'createdAt': '2026-07-21T10:00:00.000Z',
    'updatedAt': '2026-07-21T10:00:00.000Z',
    'viewerIsFollowing': true,
    'profile': {
      'displayName': 'Ada Lovelace',
      'bio': 'Polls and conversations.',
      'avatarObjectKey': null,
      'pollsCount': 3,
      'followersCount': 12,
      'followingCount': 4,
    },
  };
}
