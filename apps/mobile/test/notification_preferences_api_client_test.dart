import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:yaskapp_mobile/src/features/notifications/notification_preferences_api_client.dart';

void main() {
  test('loads and updates notification preferences', () async {
    final requests = <http.Request>[];
    final client = NotificationPreferencesApiClient(
      httpClient: MockClient((request) async {
        requests.add(request);
        return http.Response(
          '{"poll_vote":{"inApp":true,"push":false},"comment":{"inApp":true,"push":false},"comment_reply":{"inApp":true,"push":false},"like":{"inApp":true,"push":false},"follow":{"inApp":false,"push":true}}',
          200,
        );
      }),
    );

    final preferences = await client.get(accessToken: 'token');
    expect(preferences.follow.inApp, isFalse);
    expect(preferences.follow.push, isTrue);

    await client.update(
        accessToken: 'token', type: 'follow', inApp: true, push: false);
    expect(requests[0].method, 'GET');
    expect(requests[0].headers['authorization'], 'Bearer token');
    expect(requests[1].method, 'PATCH');
    expect(requests[1].body, contains('"follow":{"inApp":true,"push":false}'));
    client.close();
  });
}
