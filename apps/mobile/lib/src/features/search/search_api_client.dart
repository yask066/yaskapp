import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../core/config/api_config.dart';
import 'search_result.dart';

class SearchApiException implements Exception {
  const SearchApiException(this.message, {this.statusCode, this.code});

  final String message;
  final int? statusCode;
  final String? code;

  @override
  String toString() => message;
}

class SearchApiClient {
  SearchApiClient({
    ApiConfig config = const ApiConfig(),
    http.Client? httpClient,
  })  : _config = config,
        _httpClient = httpClient ?? http.Client();

  final ApiConfig _config;
  final http.Client _httpClient;

  void close() {
    _httpClient.close();
  }

  Future<SearchPage> search({
    required String accessToken,
    required String query,
    SearchType type = SearchType.all,
    SearchSort sort = SearchSort.relevance,
    String? cursor,
    int limit = 20,
  }) async {
    final normalizedQuery = query.trim().replaceAll(RegExp(r'\s+'), ' ');
    late http.Response response;
    try {
      response = await _httpClient.get(
        _config.uri(
          '/search',
          queryParameters: {
            'q': normalizedQuery,
            'type': type.name,
            'sort': sort.name,
            if (cursor != null) 'cursor': cursor,
            'limit': limit.toString(),
          },
        ),
        headers: {'authorization': 'Bearer $accessToken'},
      );
    } on Object {
      throw const SearchApiException('Could not complete search request.');
    }

    try {
      return SearchPage.fromJson(_decodeObject(response));
    } on SearchApiException {
      rethrow;
    } on Object {
      throw const SearchApiException('Search response is invalid.');
    }
  }

  Map<String, dynamic> _decodeObject(http.Response response) {
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } on FormatException {
      throw SearchApiException(
        response.statusCode >= 200 && response.statusCode < 300
            ? 'Response is invalid.'
            : 'Request failed.',
        statusCode: response.statusCode,
      );
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final body = decoded is Map<String, dynamic> ? decoded : null;
      throw SearchApiException(
        body?['message'] as String? ?? 'Request failed.',
        statusCode: response.statusCode,
        code: body?['error'] as String?,
      );
    }

    if (decoded is! Map<String, dynamic>) {
      throw const SearchApiException('Response is invalid.');
    }

    return decoded;
  }
}
