import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:yaskapp_mobile/src/core/config/api_config.dart';
import 'package:yaskapp_mobile/src/features/admin/admin_api_client.dart';
import 'package:yaskapp_mobile/src/features/admin/admin_screen.dart';

void main() {
  testWidgets('shows Users, Polls, and Audit tabs', (tester) async {
    final client = AdminApiClient(
      config: const ApiConfig(baseUrl: 'http://api.test'),
      httpClient: MockClient((request) async {
        expect(request.headers['authorization'], 'Bearer token');
        return http.Response(jsonEncode({'items': []}), 200);
      }),
    );

    await tester.pumpWidget(MaterialApp(
      home: AdminScreen(accessToken: 'token', apiClient: client),
    ));
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Users'), findsOneWidget);
    expect(find.text('Polls'), findsOneWidget);
    expect(find.text('Audit'), findsOneWidget);

    await tester.tap(find.text('Polls'));
    await tester.pump();
    expect(find.text('Status'), findsOneWidget);

    await tester.tap(find.text('Audit'));
    await tester.pump();
    expect(find.text('Audit'), findsOneWidget);
  });
}
