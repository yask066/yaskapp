import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:yaskapp_mobile/src/core/config/api_config.dart';
import 'package:yaskapp_mobile/src/features/reports/reports_api_client.dart';

void main() {
  const config = ApiConfig(baseUrl: 'http://api.test');

  test('submits a poll report with authorization and JSON payload', () async {
    late http.Request request;
    final client = ReportsApiClient(
      config: config,
      httpClient: MockClient((incoming) async {
        request = incoming;
        return http.Response(jsonEncode({'id': 'report-1'}), 201);
      }),
    );

    await client.submitReport(
      accessToken: 'token',
      targetType: 'poll',
      targetId: 'poll-1',
      category: 'spam',
      description: '  suspicious content  ',
    );

    expect(request.method, 'POST');
    expect(request.url.path, '/reports');
    expect(request.headers['authorization'], 'Bearer token');
    expect(jsonDecode(request.body), {
      'targetType': 'poll',
      'targetId': 'poll-1',
      'category': 'spam',
      'description': 'suspicious content',
    });
  });

  test('maps duplicate reports to a user-facing message', () async {
    final client = ReportsApiClient(
      config: config,
      httpClient: MockClient((_) async {
        return http.Response(
          jsonEncode({
            'error': 'report_already_exists',
            'message': 'Report already exists.',
          }),
          409,
        );
      }),
    );

    await expectLater(
      client.submitReport(
        accessToken: 'token',
        targetType: 'poll',
        targetId: 'poll-1',
        category: 'spam',
        description: 'spam',
      ),
      throwsA(isA<ReportsApiException>().having(
        (error) => error.userMessage,
        'userMessage',
        'You have already reported this content.',
      )),
    );
  });
}
