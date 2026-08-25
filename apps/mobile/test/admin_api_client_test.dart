import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:yaskapp_mobile/src/core/config/api_config.dart';
import 'package:yaskapp_mobile/src/features/admin/admin_api_client.dart';

void main() {
  const config = ApiConfig(baseUrl: 'http://api.test');

  test('probes admin access through the protected users endpoint', () async {
    late http.Request request;
    final client = AdminApiClient(
      config: config,
      httpClient: MockClient((incoming) async {
        request = incoming;
        return http.Response(jsonEncode({'items': []}), 200);
      }),
    );

    expect(await client.canAccess(accessToken: 'token'), isTrue);
    expect(request.url.path, '/admin/users');
    expect(request.headers['authorization'], 'Bearer token');
  });

  test('ordinary users stay outside admin UI after a server 403', () async {
    final client = AdminApiClient(
      config: config,
      httpClient: MockClient((_) async {
        return http.Response(
          jsonEncode({'error': 'forbidden', 'message': 'No access.'}),
          403,
        );
      }),
    );

    expect(await client.canAccess(accessToken: 'token'), isFalse);
  });

  test('sends a reason for deleting a poll', () async {
    late http.Request request;
    final client = AdminApiClient(
      config: config,
      httpClient: MockClient((incoming) async {
        request = incoming;
        return http.Response('', 204);
      }),
    );

    await client.deletePoll(
      pollId: 'poll-1',
      accessToken: 'token',
      reason: 'Violates rules.',
    );

    expect(request.method, 'DELETE');
    expect(request.url.path, '/admin/polls/poll-1');
    expect(jsonDecode(request.body), {'reason': 'Violates rules.'});
  });
}
