import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../core/config/api_config.dart';
import 'public_profile.dart';

class ProfilesApiException implements Exception {
  const ProfilesApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

class ProfilesApiClient {
  ProfilesApiClient({
    ApiConfig config = const ApiConfig(),
    http.Client? httpClient,
  })  : _config = config,
        _httpClient = httpClient ?? http.Client();

  final ApiConfig _config;
  final http.Client _httpClient;

  void close() {
    _httpClient.close();
  }

  Future<PublicProfile> getPublicProfile({
    required String userId,
    String? accessToken,
  }) async {
    final response = await _httpClient.get(
      _config.uri('/users/$userId'),
      headers: _authHeaders(accessToken),
    );
    final body = _decodeObject(response);
    final user = body['user'];

    if (user is! Map<String, dynamic>) {
      throw const ProfilesApiException('Public profile response is invalid.');
    }

    return PublicProfile.fromJson(user);
  }

  Future<FollowRelationship> follow({
    required String userId,
    required String accessToken,
  }) async {
    final response = await _httpClient.post(
      _config.uri('/users/$userId/follow'),
      headers: _authHeaders(accessToken),
    );

    return _decodeRelationship(response, 'Follow response is invalid.');
  }

  Future<FollowRelationship> unfollow({
    required String userId,
    required String accessToken,
  }) async {
    final response = await _httpClient.delete(
      _config.uri('/users/$userId/follow'),
      headers: _authHeaders(accessToken),
    );

    return _decodeRelationship(response, 'Unfollow response is invalid.');
  }

  Future<List<PublicProfile>> listFollowers({
    required String userId,
    int limit = 50,
    String? accessToken,
  }) async {
    final response = await _httpClient.get(
      _config.uri(
        '/users/$userId/followers',
        queryParameters: {'limit': limit.toString()},
      ),
      headers: _authHeaders(accessToken),
    );

    return _decodeProfiles(response, 'Followers response is invalid.');
  }

  Future<List<PublicProfile>> listFollowing({
    required String accessToken,
    int limit = 50,
  }) async {
    final response = await _httpClient.get(
      _config.uri(
        '/profiles/me/following',
        queryParameters: {'limit': limit.toString()},
      ),
      headers: _authHeaders(accessToken),
    );

    return _decodeProfiles(response, 'Following response is invalid.');
  }

  Future<List<PublicProfile>> listPopularUsers({
    String? accessToken,
    int limit = 3,
  }) async {
    final response = await _httpClient.get(
      _config.uri(
        '/users',
        queryParameters: {'sort': 'popular', 'limit': limit.toString()},
      ),
      headers: _authHeaders(accessToken),
    );

    return _decodeProfiles(response, 'Popular users response is invalid.');
  }

  Map<String, String> _authHeaders(String? accessToken) {
    return {
      if (accessToken != null) 'authorization': 'Bearer $accessToken',
    };
  }

  List<PublicProfile> _decodeProfiles(
    http.Response response,
    String errorMessage,
  ) {
    final body = _decodeObject(response);
    final items = body['items'];

    if (items is! List<dynamic>) {
      throw ProfilesApiException(errorMessage);
    }

    return items
        .map((item) => PublicProfile.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  FollowRelationship _decodeRelationship(
    http.Response response,
    String errorMessage,
  ) {
    final body = _decodeObject(response);

    try {
      return FollowRelationship.fromJson(body);
    } on TypeError catch (_) {
      throw ProfilesApiException(errorMessage);
    }
  }

  Map<String, dynamic> _decodeObject(http.Response response) {
    final decoded = jsonDecode(response.body);

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = decoded is Map<String, dynamic>
          ? decoded['message'] as String?
          : null;

      throw ProfilesApiException(
        message ?? 'Request failed.',
        statusCode: response.statusCode,
      );
    }

    if (decoded is! Map<String, dynamic>) {
      throw const ProfilesApiException('Response is invalid.');
    }

    return decoded;
  }
}
