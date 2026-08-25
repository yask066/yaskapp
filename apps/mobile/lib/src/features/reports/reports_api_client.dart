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

class ReportSummary {
  const ReportSummary({
    required this.id,
    required this.targetType,
    required this.targetId,
    required this.category,
    required this.description,
    required this.status,
    required this.createdAt,
  });

  factory ReportSummary.fromJson(Map<String, dynamic> json) {
    return ReportSummary(
      id: json['id'] as String,
      targetType: json['targetType'] as String,
      targetId: json['targetId'] as String,
      category: json['category'] as String,
      description: json['description'] as String,
      status: json['status'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String).toLocal(),
    );
  }

  final String id;
  final String targetType;
  final String targetId;
  final String category;
  final String description;
  final String status;
  final DateTime createdAt;
}

class ReportsPage {
  const ReportsPage({required this.items, required this.nextCursor});

  final List<ReportSummary> items;
  final String? nextCursor;
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

  Future<ReportsPage> listMine({
    required String accessToken,
    int limit = 20,
    String? cursor,
  }) async {
    final query = <String, String>{
      'limit': limit.toString(),
      if (cursor != null) 'cursor': cursor,
    };
    final response = await _httpClient.get(
      Uri.parse(_config.baseUrl).replace(
        path: '/reports/mine',
        queryParameters: query,
      ),
      headers: {'authorization': 'Bearer $accessToken'},
    );
    final body = _decodeObject(response);
    final items = body['items'];
    if (items is! List<dynamic>) {
      throw const ReportsApiException('Reports response is invalid.');
    }
    return ReportsPage(
      items: items
          .map((item) => ReportSummary.fromJson(item as Map<String, dynamic>))
          .toList(),
      nextCursor: body['nextCursor'] as String?,
    );
  }

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

  Map<String, dynamic> _decodeObject(http.Response response) {
    final decoded = jsonDecode(response.body);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final body = decoded is Map<String, dynamic> ? decoded : const {};
      throw ReportsApiException(
        body['message'] as String? ?? 'Request failed.',
        statusCode: response.statusCode,
        code: body['error'] as String?,
      );
    }
    if (decoded is! Map<String, dynamic>) {
      throw const ReportsApiException('Response is invalid.');
    }
    return decoded;
  }
}
