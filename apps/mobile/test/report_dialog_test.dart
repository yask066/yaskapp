import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:yaskapp_mobile/src/features/reports/report_dialog.dart';
import 'package:yaskapp_mobile/src/features/reports/reports_api_client.dart';

void main() {
  testWidgets('renders the reference-style report dialog', (tester) async {
    final client = ReportsApiClient(httpClient: _ReportHttpClient());
    await tester.pumpWidget(_TestApp(client: client));

    final dialogFuture = showReportDialog(
      context: tester.element(find.byType(Scaffold)),
      accessToken: 'token',
      targetType: 'poll',
      targetId: 'poll-1',
      reportsApiClient: client,
    );
    await tester.pumpAndSettle();

    expect(find.text('Report content'), findsOneWidget);
    expect(
        find.text(
            'Help us keep Yask safe by letting us know\nwhat’s wrong with this content.'),
        findsOneWidget);
    expect(find.text('Details · Optional'), findsOneWidget);
    expect(
        find.text(
            'Your report is anonymous.\nWe’ll review it as soon as possible.'),
        findsOneWidget);
    expect(find.byTooltip('Close'), findsOneWidget);
    expect(_button(tester, 'Submit').onPressed, isNull);

    await tester.tap(find.text('Select a reason'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Spam').last);
    await tester.pumpAndSettle();

    expect(_button(tester, 'Submit').onPressed, isNotNull);
    await tester.tap(find.text('Cancel'));
    await dialogFuture;
    client.close();
  });
}

FilledButton _button(WidgetTester tester, String label) =>
    tester.widget<FilledButton>(find.widgetWithText(FilledButton, label));

class _TestApp extends StatelessWidget {
  const _TestApp({required this.client});

  final ReportsApiClient client;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      theme: ThemeData(useMaterial3: true),
      home: const Scaffold(body: SizedBox()),
    );
  }
}

class _ReportHttpClient extends http.BaseClient {
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    return http.StreamedResponse(
      Stream.value(utf8.encode('{}')),
      201,
      request: request,
    );
  }
}
