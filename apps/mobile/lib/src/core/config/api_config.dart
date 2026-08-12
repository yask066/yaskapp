class ApiConfig {
  const ApiConfig({
    this.baseUrl = const String.fromEnvironment(
      'API_BASE_URL',
      defaultValue: 'http://192.168.0.12:3000',
    ),
    this.websocketUrl = const String.fromEnvironment(
      'API_WEBSOCKET_URL',
      defaultValue: 'ws://192.168.0.12:3000/realtime',
    ),
  });

  final String baseUrl;
  final String websocketUrl;
}
