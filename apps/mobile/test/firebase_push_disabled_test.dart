import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/features/notifications/firebase_push_service.dart';

void main() {
  test('disabled push works without any Firebase app or platform channel',
      () async {
    final service = FirebasePushService(enabled: false);
    await service.initialize();
    expect(await service.getToken(), isNull);
    expect(await service.onTokenRefresh.toList(), isEmpty);
    expect(await service.onMessageOpenedApp.toList(), isEmpty);
  });
}
