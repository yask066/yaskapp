class ApiConfig {
  const ApiConfig({
    this.baseUrl = const String.fromEnvironment(
      'API_BASE_URL',
      defaultValue: 'http://5.44.44.197',
    ),
    this.websocketUrl = const String.fromEnvironment(
      'API_WEBSOCKET_URL',
      defaultValue: 'ws://5.44.44.197/realtime',
    ),
  });

  final String baseUrl;
  final String websocketUrl;

  Uri uri(String path, {Map<String, String>? queryParameters}) {
    return Uri.parse(baseUrl).replace(
      path: path,
      queryParameters: queryParameters,
    );
  }
}
