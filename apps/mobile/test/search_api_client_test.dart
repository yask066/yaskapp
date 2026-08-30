import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:yaskapp_mobile/src/core/config/api_config.dart';
import 'package:yaskapp_mobile/src/features/search/search_api_client.dart';
import 'package:yaskapp_mobile/src/features/search/search_result.dart';

void main() {
  const config = ApiConfig(baseUrl: 'http://api.test');

  test(
      'builds authenticated search request with defaults and decodes mixed results',
      () async {
    late http.Request request;
    final client = SearchApiClient(
      config: config,
      httpClient: MockClient((incoming) async {
        request = incoming;
        return http.Response(
          jsonEncode({
            'items': [
              {'type': 'poll', 'poll': _pollJson(), 'score': 0.92},
              {'type': 'user', 'user': _profileJson(), 'score': 0.87},
            ],
            'nextCursor': 'opaque-cursor',
          }),
          200,
        );
      }),
    );

    final page = await client.search(
      accessToken: 'access-token',
      query: 'climate change',
    );

    expect(request.method, 'GET');
    expect(request.url.path, '/search');
    expect(request.url.queryParameters, {
      'q': 'climate change',
      'type': 'all',
      'sort': 'relevance',
      'limit': '20',
    });
    expect(request.headers['authorization'], 'Bearer access-token');
    expect(page.items, hasLength(2));
    expect(page.items[0], isA<PollSearchResult>());
    expect((page.items[0] as PollSearchResult).poll.id, 'poll-1');
    expect(page.items[1], isA<UserSearchResult>());
    expect((page.items[1] as UserSearchResult).user.username, 'ada');
    expect(page.nextCursor, 'opaque-cursor');
  });

  test('propagates selected type, sort, limit and cursor', () async {
    late Uri requestedUri;
    final client = SearchApiClient(
      config: config,
      httpClient: MockClient((request) async {
        requestedUri = request.url;
        return http.Response(
            jsonEncode({'items': [], 'nextCursor': null}), 200);
      }),
    );

    await client.search(
      accessToken: 'token',
      query: '  users  ',
      type: SearchType.users,
      sort: SearchSort.popular,
      cursor: 'cursor-1',
      limit: 5,
    );

    expect(requestedUri.queryParameters, {
      'q': 'users',
      'type': 'users',
      'sort': 'popular',
      'cursor': 'cursor-1',
      'limit': '5',
    });
  });

  test('maps API errors and rejects malformed search results', () async {
    final errorClient = SearchApiClient(
      config: config,
      httpClient: MockClient((_) async {
        return http.Response(
          jsonEncode(
              {'error': 'validation_error', 'message': 'Invalid query.'}),
          400,
        );
      }),
    );

    await expectLater(
      errorClient.search(accessToken: 'token', query: 'bad'),
      throwsA(isA<SearchApiException>().having(
        (error) => error.statusCode,
        'statusCode',
        400,
      )),
    );

    final malformedClient = SearchApiClient(
      config: config,
      httpClient: MockClient((_) async {
        return http.Response(
          jsonEncode({
            'items': [
              {'type': 'unknown'}
            ],
            'nextCursor': null
          }),
          200,
        );
      }),
    );

    await expectLater(
      malformedClient.search(accessToken: 'token', query: 'valid'),
      throwsA(isA<SearchApiException>()),
    );
  });

  test('maps network failures to SearchApiException', () async {
    final client = SearchApiClient(
      config: config,
      httpClient: MockClient((_) async {
        throw http.ClientException('socket unavailable');
      }),
    );

    await expectLater(
      client.search(accessToken: 'token', query: 'valid'),
      throwsA(isA<SearchApiException>().having(
        (error) => error.message,
        'message',
        'Could not complete search request.',
      )),
    );
  });
}

Map<String, dynamic> _pollJson() {
  return {
    'id': 'poll-1',
    'author': {
      'id': 'user-1',
      'username': 'ada',
      'displayName': 'Ada',
      'avatarObjectKey': null,
      'avatarUrl': null,
    },
    'question': 'Climate?',
    'imageUrl': null,
    'options': [
      {'id': 'option-1', 'text': 'Yes', 'position': 0, 'votesCount': 1},
    ],
    'votesCount': 1,
    'commentsCount': 0,
    'likesCount': 0,
    'viewerHasLiked': false,
    'createdAt': '2026-08-30T10:00:00.000Z',
    'endsAt': null,
  };
}

Map<String, dynamic> _profileJson() {
  return {
    'id': 'user-1',
    'username': 'ada',
    'status': 'active',
    'profile': {
      'displayName': 'Ada',
      'bio': null,
      'countryCode': null,
      'avatarObjectKey': null,
      'avatarUrl': null,
      'pollsCount': 1,
      'followersCount': 2,
      'followingCount': 3,
    },
    'viewerIsFollowing': false,
  };
}
