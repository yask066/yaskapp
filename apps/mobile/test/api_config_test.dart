import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/core/config/api_config.dart';

void main() {
  test('uses localhost endpoints when no deployment overrides are provided', () {
    const config = ApiConfig();
    const expectedBaseUrl = 'http://localhost:3000';
    const expectedWebsocketUrl = 'ws://localhost:3000/realtime';

    expect(config.baseUrl, expectedBaseUrl);
    expect(config.websocketUrl, expectedWebsocketUrl);
  });
}
