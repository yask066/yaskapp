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

  test('omits empty admin query parameters', () async {
    late http.Request request;
    final client = AdminApiClient(
      config: config,
      httpClient: MockClient((incoming) async {
        request = incoming;
        return http.Response(jsonEncode({'items': [], 'nextCursor': null}), 200);
      }),
    );

    await client.listUsers(accessToken: 'token');

    expect(request.url.queryParameters, {
      'status': 'all',
      'role': 'all',
      'limit': '50',
    });
  });

  test('loads server-issued admin capabilities without changing AuthUser', () async {
    final client = AdminApiClient(
      config: config,
      httpClient: MockClient((request) async {
        expect(request.url.path, '/admin/capabilities');
        return http.Response(jsonEncode({
          'permissions': ['admin.users.read', 'admin.polls.read'],
        }), 200);
      }),
    );

    final capabilities = await client.loadCapabilities(accessToken: 'token');

    expect(capabilities.canReadUsers, isTrue);
    expect(capabilities.canDeleteUsers, isFalse);
    expect(capabilities.canReadPolls, isTrue);
  });

  test('maps admin transition errors to a safe user message', () async {
    final client = AdminApiClient(
      config: config,
      httpClient: MockClient((_) async {
        return http.Response(jsonEncode({
          'error': 'invalid_admin_transition',
          'message': 'At least one superadmin must remain.',
        }), 409);
      }),
    );

    await expectLater(
      client.deleteUser(userId: 'user-1', accessToken: 'token', reason: 'Cleanup.'),
      throwsA(isA<AdminApiException>().having(
        (error) => error.userMessage,
        'userMessage',
        'This administrative action is not allowed in the current state.',
      )),
    );
  });
}
