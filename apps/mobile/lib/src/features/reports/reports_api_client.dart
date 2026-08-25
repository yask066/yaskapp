import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../core/config/api_config.dart';

class ReportsApiException implements Exception {
  const ReportsApiException(this.message, {this.statusCode, this.code});

  final String message;
  final int? statusCode;
  final String? code;

  String get userMessage {
    if (statusCode == 409 || code == 'report_already_exists') {
      return 'You have already reported this content.';
    }
    if (statusCode == 401 || statusCode == 403) {
      return 'You are not allowed to submit this report.';
    }
    return message;
  }

  @override
  String toString() => message;
}

class ReportsApiClient {
  ReportsApiClient({
    ApiConfig config = const ApiConfig(),
    http.Client? httpClient,
  })  : _config = config,
        _httpClient = httpClient ?? http.Client();

  final ApiConfig _config;
  final http.Client _httpClient;

  void close() => _httpClient.close();

  Future<void> submitReport({
    required String accessToken,
    required String targetType,
    required String targetId,
    required String category,
    required String description,
  }) async {
    final response = await _httpClient.post(
      Uri.parse(_config.baseUrl).replace(path: '/reports'),
      headers: {
        'authorization': 'Bearer $accessToken',
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'targetType': targetType,
        'targetId': targetId,
        'category': category,
        'description': description.trim(),
      }),
    );
    final decoded = jsonDecode(response.body);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final body = decoded is Map<String, dynamic> ? decoded : const {};
      throw ReportsApiException(
        body['message'] as String? ?? 'Request failed.',
        statusCode: response.statusCode,
        code: body['error'] as String?,
      );
    }
  }
}
