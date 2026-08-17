import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/core/config/api_config.dart';

void main() {
  test('uses local endpoints by default', () {
    const config = ApiConfig();
    const expectedBaseUrl = 'http://5.44.44.197';
    const expectedWebsocketUrl = 'ws://5.44.44.197/realtime';

    expect(config.baseUrl, expectedBaseUrl);
    expect(config.websocketUrl, expectedWebsocketUrl);
  });
}
