class ApiConfig {
  const ApiConfig({
    this.baseUrl = 'http://localhost:3000',
    this.websocketUrl = 'ws://localhost:3000/realtime',
  });

  final String baseUrl;
  final String websocketUrl;
}
