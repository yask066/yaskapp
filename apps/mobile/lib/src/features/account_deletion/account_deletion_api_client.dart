import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../core/config/api_config.dart';

enum AccountDeletionStatus {
  notStarted('not_started'),
  pending('pending'),
  processing('processing'),
  retrying('retrying'),
  completed('completed');

  const AccountDeletionStatus(this.wireValue);
  final String wireValue;

  static AccountDeletionStatus parse(Object? value) {
    return AccountDeletionStatus.values.firstWhere(
      (status) => status.wireValue == value,
      orElse: () =>
          throw const FormatException('Unknown account deletion status.'),
    );
  }
}

class AccountDeletionVerification {
  const AccountDeletionVerification({
    required this.operationId,
    required this.deletionToken,
    required this.statusToken,
    required this.deletionTokenExpiresAt,
    required this.statusTokenExpiresAt,
  });

  final String operationId;
  final String deletionToken;
  final String statusToken;
  final DateTime deletionTokenExpiresAt;
  final DateTime statusTokenExpiresAt;

  factory AccountDeletionVerification.fromJson(Map<String, dynamic> json) {
    return AccountDeletionVerification(
      operationId: _requiredString(json, 'operationId'),
      deletionToken: _requiredString(json, 'deletionToken'),
      statusToken: _requiredString(json, 'statusToken'),
      deletionTokenExpiresAt: _requiredDate(json, 'deletionTokenExpiresAt'),
      statusTokenExpiresAt: _requiredDate(json, 'statusTokenExpiresAt'),
    );
  }
}

class AccountDeletionStatusResponse {
  const AccountDeletionStatusResponse({
    required this.operationId,
    required this.status,
    required this.acceptedAt,
    required this.deadlineAt,
    required this.completedAt,
  });

  final String operationId;
  final AccountDeletionStatus status;
  final DateTime? acceptedAt;
  final DateTime? deadlineAt;
  final DateTime? completedAt;

  factory AccountDeletionStatusResponse.fromJson(Map<String, dynamic> json) {
    return AccountDeletionStatusResponse(
      operationId: _requiredString(json, 'operationId'),
      status: AccountDeletionStatus.parse(json['status']),
      acceptedAt: _optionalDate(json['acceptedAt']),
      deadlineAt: _optionalDate(json['deadlineAt']),
      completedAt: _optionalDate(json['completedAt']),
    );
  }
}

class AccountDeletionApiException implements Exception {
  const AccountDeletionApiException(
    this.message, {
    this.statusCode,
    this.code,
    this.retryAfter,
  });

  final String message;
  final int? statusCode;
  final String? code;
  final Duration? retryAfter;

  @override
  String toString() => message;
}

abstract class AccountDeletionApi {
  Future<AccountDeletionVerification> verify({
    String? accessToken,
    String? login,
    required String password,
  });

  Future<AccountDeletionStatusResponse> deleteAccount({
    required String deletionToken,
  });

  Future<AccountDeletionStatusResponse> getStatus({
    required String statusToken,
  });
}

class AccountDeletionApiClient extends AccountDeletionApi {
  AccountDeletionApiClient({
    ApiConfig config = const ApiConfig(),
    http.Client? httpClient,
  })  : _config = config,
        _httpClient = httpClient ?? http.Client();

  final ApiConfig _config;
  final http.Client _httpClient;

  void close() => _httpClient.close();

  @override
  Future<AccountDeletionVerification> verify({
    String? accessToken,
    String? login,
    required String password,
  }) async {
    final response = await _httpClient.post(
      _uri('/auth/account-deletion/verification'),
      headers: {
        'content-type': 'application/json',
        if (accessToken != null) 'authorization': 'Bearer $accessToken',
      },
      body: jsonEncode({
        if (login != null) 'login': login,
        'password': password,
      }),
    );
    return AccountDeletionVerification.fromJson(
      _decodeObject(response, expectedStatus: 200),
    );
  }

  @override
  Future<AccountDeletionStatusResponse> deleteAccount({
    required String deletionToken,
  }) async {
    final response = await _httpClient.delete(
      _uri('/auth/me'),
      headers: {
        'authorization': 'Bearer $deletionToken',
        'content-type': 'application/json',
      },
      body: jsonEncode(const {'confirm': true}),
    );
    return AccountDeletionStatusResponse.fromJson(
      _decodeObject(response, expectedStatus: 202),
    );
  }

  @override
  Future<AccountDeletionStatusResponse> getStatus({
    required String statusToken,
  }) async {
    final response = await _httpClient.get(
      _uri('/auth/account-deletion/status'),
      headers: {'authorization': 'Bearer $statusToken'},
    );
    return AccountDeletionStatusResponse.fromJson(
      _decodeObject(response, expectedStatus: 200),
    );
  }

  Uri _uri(String path) => Uri.parse(_config.baseUrl).replace(path: path);

  Map<String, dynamic> _decodeObject(
    http.Response response, {
    required int expectedStatus,
  }) {
    Object? decoded;
    try {
      decoded = jsonDecode(response.body);
    } on FormatException {
      throw const AccountDeletionApiException('Response is invalid.');
    }
    if (response.statusCode != expectedStatus) {
      final body = decoded is Map<String, dynamic> ? decoded : null;
      final retryAfterHeader = response.headers['retry-after'];
      final retryAfterSeconds = int.tryParse(retryAfterHeader ?? '');
      throw AccountDeletionApiException(
        body?['message'] as String? ?? 'Request failed.',
        statusCode: response.statusCode,
        code: body?['error'] as String?,
        retryAfter: retryAfterSeconds == null
            ? null
            : Duration(seconds: retryAfterSeconds),
      );
    }
    if (decoded is! Map<String, dynamic>) {
      throw const AccountDeletionApiException('Response is invalid.');
    }
    return decoded;
  }
}

String _requiredString(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is! String || value.isEmpty) {
    throw FormatException('Invalid account deletion field: $key.');
  }
  return value;
}

DateTime _requiredDate(Map<String, dynamic> json, String key) {
  final value = _optionalDate(json[key]);
  if (value == null) {
    throw FormatException('Invalid account deletion field: $key.');
  }
  return value;
}

DateTime? _optionalDate(Object? value) {
  if (value == null) {
    return null;
  }
  if (value is! String) {
    throw const FormatException('Invalid account deletion date.');
  }
  final parsed = DateTime.tryParse(value);
  if (parsed == null) {
    throw const FormatException('Invalid account deletion date.');
  }
  return parsed.toUtc();
}
