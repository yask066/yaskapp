class ApiConfig {
  const ApiConfig({
    this.baseUrl = const String.fromEnvironment(
      'API_BASE_URL',
      defaultValue: 'http://localhost:3000',
    ),
    this.websocketUrl = const String.fromEnvironment(
      'API_WEBSOCKET_URL',
      defaultValue: 'ws://localhost:3000/realtime',
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
