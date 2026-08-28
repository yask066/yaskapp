import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:yaskapp_mobile/src/features/polls/create_poll_screen.dart';
import 'package:yaskapp_mobile/src/features/polls/polls_api_client.dart';

void main() {
  testWidgets('create poll screen shows an add image action', (tester) async {
    final client = PollsApiClient(httpClient: MockClient((_) async {
      throw StateError('The publish request should not run in this test.');
    }));

    await tester.pumpWidget(
      MaterialApp(
        home: CreatePollScreen(
          accessToken: 'token',
          pollsApiClient: client,
        ),
      ),
    );

    expect(find.text('Add image'), findsOneWidget);
  });
}
