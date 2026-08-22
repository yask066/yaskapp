import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import '../../core/config/api_config.dart';
import 'auth_session.dart';

class AuthApiException implements Exception {
  const AuthApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

class AuthApiClient {
  AuthApiClient({
    ApiConfig config = const ApiConfig(),
    http.Client? httpClient,
  })  : _config = config,
        _httpClient = httpClient ?? http.Client();

  final ApiConfig _config;
  final http.Client _httpClient;

  void close() {
    _httpClient.close();
  }

  Future<AuthSession> login({
    required String login,
    required String password,
  }) async {
    final response = await _httpClient.post(
      _uri('/auth/login'),
      headers: const {
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'login': login,
        'password': password,
      }),
    );

    return AuthSession.fromJson(_decodeObject(response));
  }

  Future<AuthSession> register({
    required String email,
    required String username,
    required String password,
    required String countryCode,
    String? displayName,
  }) async {
    final response = await _httpClient.post(
      _uri('/auth/register'),
      headers: const {
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'email': email,
        'username': username,
        'password': password,
        'countryCode': countryCode,
        if (displayName != null && displayName.trim().isNotEmpty)
          'displayName': displayName.trim(),
      }),
    );

    return AuthSession.fromJson(_decodeObject(response));
  }

  Future<AuthUser> me({required String accessToken}) async {
    final response = await _httpClient.get(
      _uri('/auth/me'),
      headers: {
        'authorization': 'Bearer $accessToken',
      },
    );
    final body = _decodeObject(response);
    final user = body['user'];

    if (user is! Map<String, dynamic>) {
      throw const AuthApiException('Profile response is invalid.');
    }

    return AuthUser.fromJson(user);
  }

  Future<AuthUser> updateProfile({
    required String accessToken,
    String? displayName,
    String? bio,
    String? countryCode,
  }) async {
    final response = await _httpClient.patch(
      _uri('/profiles/me'),
      headers: {
        'authorization': 'Bearer $accessToken',
        'content-type': 'application/json',
      },
      body: jsonEncode({
        if (displayName != null) 'displayName': displayName,
        'bio': bio,
        if (countryCode != null) 'countryCode': countryCode,
      }),
    );
    final body = _decodeObject(response);
    final user = body['user'];

    if (user is! Map<String, dynamic>) {
      throw const AuthApiException('Profile update response is invalid.');
    }

    return AuthUser.fromJson(user);
  }

  Future<AuthUser> uploadAvatar({
    required String accessToken,
    required Uint8List bytes,
    required String filename,
    required String contentType,
  }) async {
    final request = http.MultipartRequest(
      'POST',
      _uri('/profiles/me/avatar'),
    )
      ..headers['authorization'] = 'Bearer $accessToken'
      ..files.add(
        http.MultipartFile.fromBytes(
          'avatar',
          bytes,
          filename: filename,
          contentType: _mediaType(contentType),
        ),
      );

    final response = await http.Response.fromStream(
      await _httpClient.send(request),
    );
    final body = _decodeObject(response);
    final user = body['user'];

    if (user is! Map<String, dynamic>) {
      throw const AuthApiException('Avatar upload response is invalid.');
    }

    return AuthUser.fromJson(user);
  }

  Future<AuthUser> deleteAvatar({required String accessToken}) async {
    final response = await _httpClient.delete(
      _uri('/profiles/me/avatar'),
      headers: {
        'authorization': 'Bearer $accessToken',
      },
    );
    final body = _decodeObject(response);
    final user = body['user'];

    if (user is! Map<String, dynamic>) {
      throw const AuthApiException('Avatar delete response is invalid.');
    }

    return AuthUser.fromJson(user);
  }

  Uri _uri(String path) {
    return Uri.parse(_config.baseUrl).replace(path: path);
  }

  MediaType? _mediaType(String contentType) {
    final parts = contentType.split('/');

    if (parts.length != 2 || parts.any((part) => part.isEmpty)) {
      return null;
    }

    return MediaType(parts[0], parts[1]);
  }

  Map<String, dynamic> _decodeObject(http.Response response) {
    final decoded = jsonDecode(response.body);

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = decoded is Map<String, dynamic>
          ? decoded['message'] as String?
          : null;

      throw AuthApiException(
        message ?? 'Request failed.',
        statusCode: response.statusCode,
      );
    }

    if (decoded is! Map<String, dynamic>) {
      throw const AuthApiException('Response is invalid.');
    }

    return decoded;
  }
}
