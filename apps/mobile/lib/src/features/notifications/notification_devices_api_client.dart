import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../core/config/api_config.dart';

class NotificationDevicesApiClient {
  NotificationDevicesApiClient({
    ApiConfig config = const ApiConfig(),
    http.Client? httpClient,
  })  : _config = config,
        _httpClient = httpClient ?? http.Client();

  final ApiConfig _config;
  final http.Client _httpClient;

  void close() => _httpClient.close();

  Future<void> register({
    required String accessToken,
    required String token,
    required String platform,
  }) async {
    final response = await _httpClient.post(
      Uri.parse(_config.baseUrl).replace(path: '/notification-devices'),
      headers: {
        'authorization': 'Bearer $accessToken',
        'content-type': 'application/json',
      },
      body: jsonEncode({'token': token, 'platform': platform}),
    );
    _check(response);
  }

  Future<void> revoke({
    required String accessToken,
    required String token,
  }) async {
    final response = await _httpClient.delete(
      Uri.parse(_config.baseUrl).replace(path: '/notification-devices'),
      headers: {
        'authorization': 'Bearer $accessToken',
        'content-type': 'application/json',
      },
      body: jsonEncode({'token': token}),
    );
    _check(response);
  }

  void _check(http.Response response) {
    if (response.statusCode >= 200 && response.statusCode < 300) return;
    final decoded = response.body.isEmpty ? null : jsonDecode(response.body);
    final message =
        decoded is Map<String, dynamic> ? decoded['message'] as String? : null;
    throw Exception(message ?? 'Could not update notification device.');
  }
}
