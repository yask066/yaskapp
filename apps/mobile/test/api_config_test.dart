import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/core/config/api_config.dart';

void main() {
  test('uses the HTTPS domain endpoints when no deployment overrides are provided', () {
    const config = ApiConfig();
    const expectedBaseUrl = 'https://api.yaskapp.org';
    const expectedWebsocketUrl = 'wss://api.yaskapp.org/realtime';

    expect(config.baseUrl, expectedBaseUrl);
    expect(config.websocketUrl, expectedWebsocketUrl);
  });
}
