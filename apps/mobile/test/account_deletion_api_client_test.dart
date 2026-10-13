import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:yaskapp_mobile/src/core/config/api_config.dart';
import 'package:yaskapp_mobile/src/features/account_deletion/account_deletion_api_client.dart';

void main() {
  test('verification uses the deletion contract and current session only',
      () async {
    late http.Request captured;
    final client = AccountDeletionApiClient(
      config: const ApiConfig(baseUrl: 'https://api.test'),
      httpClient: MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'operationId': 'op-1',
            'status': 'not_started',
            'deletionToken': 'delete-token',
            'statusToken': 'status-token',
            'deletionTokenExpiresAt': '2026-10-13T12:00:00Z',
            'statusTokenExpiresAt': '2026-10-15T12:00:00Z',
          }),
          200,
        );
      }),
    );
    addTearDown(client.close);

    final result = await client.verify(
      accessToken: 'session-token',
      password: 'secret',
    );

    expect(captured.method, 'POST');
    expect(captured.url.path, '/auth/account-deletion/verification');
    expect(captured.headers['authorization'], 'Bearer session-token');
    expect(jsonDecode(captured.body), {'password': 'secret'});
    expect(result.operationId, 'op-1');
    expect(result.statusToken, 'status-token');
  });

  test('deletion sends only the scoped token and explicit confirmation',
      () async {
    late http.Request captured;
    final client = AccountDeletionApiClient(
      config: const ApiConfig(baseUrl: 'https://api.test'),
      httpClient: MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'operationId': 'op-1',
            'status': 'pending',
            'acceptedAt': '2026-10-13T10:00:00Z',
            'deadlineAt': '2026-10-14T10:00:00Z',
            'completedAt': null,
          }),
          202,
        );
      }),
    );
    addTearDown(client.close);

    final result = await client.deleteAccount(deletionToken: 'delete-token');

    expect(captured.method, 'DELETE');
    expect(captured.url.path, '/auth/me');
    expect(captured.headers['authorization'], 'Bearer delete-token');
    expect(jsonDecode(captured.body), {'confirm': true});
    expect(result.status, AccountDeletionStatus.pending);
  });

  test('status uses the receipt token and parses completion', () async {
    late http.Request captured;
    final client = AccountDeletionApiClient(
      config: const ApiConfig(baseUrl: 'https://api.test'),
      httpClient: MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'operationId': 'op-1',
            'status': 'completed',
            'acceptedAt': '2026-10-13T10:00:00Z',
            'deadlineAt': '2026-10-14T10:00:00Z',
            'completedAt': '2026-10-13T10:05:00Z',
          }),
          200,
        );
      }),
    );
    addTearDown(client.close);

    final result = await client.getStatus(statusToken: 'status-token');

    expect(captured.method, 'GET');
    expect(captured.url.path, '/auth/account-deletion/status');
    expect(captured.url.query, isEmpty);
    expect(captured.headers['authorization'], 'Bearer status-token');
    expect(result.completedAt, isNotNull);
  });

  test('invalid credentials remains a scoped API error', () async {
    final client = AccountDeletionApiClient(
      config: const ApiConfig(baseUrl: 'https://api.test'),
      httpClient: MockClient((_) async => http.Response(
            jsonEncode(
                {'error': 'invalid_credentials', 'message': 'Wrong password.'}),
            403,
          )),
    );
    addTearDown(client.close);

    await expectLater(
      client.verify(login: 'alice', password: 'wrong'),
      throwsA(isA<AccountDeletionApiException>()
          .having((error) => error.statusCode, 'statusCode', 403)
          .having((error) => error.code, 'code', 'invalid_credentials')),
    );
  });
}
