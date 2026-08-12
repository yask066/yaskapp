import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/core/config/api_config.dart';

void main() {
  test('uses local endpoints by default', () {
    const config = ApiConfig();
    const expectedBaseUrl = 'http://192.168.0.10:3000';
    const expectedWebsocketUrl = 'ws://192.168.0.10:3000/realtime';

    expect(config.baseUrl, expectedBaseUrl);
    expect(config.websocketUrl, expectedWebsocketUrl);
  });
}
