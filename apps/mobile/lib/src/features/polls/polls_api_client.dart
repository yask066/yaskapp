import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../core/config/api_config.dart';
import 'poll_summary.dart';

class PollsApiException implements Exception {
  const PollsApiException(this.message, {this.statusCode, this.code});

  final String message;
  final int? statusCode;
  final String? code;

  String get userMessage {
    if (code == 'vote_cancellation_not_allowed') {
      return 'The poll author does not allow vote cancellation.';
    }

    if (code == 'poll_closed' || statusCode == 422) {
      return 'This poll is closed. Voting changes are no longer available.';
    }

    if (code == 'not_found' &&
        statusCode == 404 &&
        message != 'Route was not found.') {
      return 'That poll option is no longer available. Refresh the poll and try again.';
    }

    return message;
  }

  @override
  String toString() => message;
}

class CreatePollCommentResult {
  const CreatePollCommentResult({
    required this.comment,
    required this.poll,
  });

  final PollCommentSummary comment;
  final PollSummary poll;
}

class PollsApiClient {
  PollsApiClient({
    ApiConfig config = const ApiConfig(),
    http.Client? httpClient,
  })  : _config = config,
        _httpClient = httpClient ?? http.Client();

  final ApiConfig _config;
  final http.Client _httpClient;

  void close() {
    _httpClient.close();
  }

  Future<List<PollSummary>> listPolls({
    int limit = 20,
    String? accessToken,
  }) async {
    final uri = Uri.parse(_config.baseUrl).replace(
      path: '/polls',
      queryParameters: {
        'limit': limit.toString(),
      },
    );
    final response = await _httpClient.get(
      uri,
      headers: {
        if (accessToken != null) 'authorization': 'Bearer $accessToken',
      },
    );
    final body = _decodeObject(response);

    final items = body['items'];

    if (items is! List<dynamic>) {
      throw const PollsApiException('Poll feed response is invalid.');
    }

    return items
        .map(
          (item) => PollSummary.fromJson(item as Map<String, dynamic>),
        )
        .toList();
  }

  Future<List<PollSummary>> listMyPolls({
    required String accessToken,
    int limit = 20,
  }) async {
    final uri = Uri.parse(_config.baseUrl).replace(
      path: '/profiles/me/polls',
      queryParameters: {
        'limit': limit.toString(),
      },
    );
    final response = await _httpClient.get(
      uri,
      headers: {
        'authorization': 'Bearer $accessToken',
      },
    );
    final body = _decodeObject(response);

    final items = body['items'];

    if (items is! List<dynamic>) {
      throw const PollsApiException('My polls response is invalid.');
    }

    return items
        .map(
          (item) => PollSummary.fromJson(item as Map<String, dynamic>),
        )
        .toList();
  }

  Future<List<PollSummary>> listUserPolls({
    required String userId,
    String? accessToken,
    int limit = 20,
  }) async {
    final uri = Uri.parse(_config.baseUrl).replace(
      path: '/users/$userId/polls',
      queryParameters: {'limit': limit.toString()},
    );
    final response = await _httpClient.get(
      uri,
      headers: {
        if (accessToken != null) 'authorization': 'Bearer $accessToken',
      },
    );
    final body = _decodeObject(response);
    final items = body['items'];

    if (items is! List<dynamic>) {
      throw const PollsApiException('User polls response is invalid.');
    }

    return items
        .map((item) => PollSummary.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<List<PollSummary>> listSubscriptions({
    required String accessToken,
    int limit = 20,
  }) async {
    final uri = Uri.parse(_config.baseUrl).replace(
      path: '/polls/subscriptions',
      queryParameters: {
        'limit': limit.toString(),
      },
    );
    final response = await _httpClient.get(
      uri,
      headers: {
        'authorization': 'Bearer $accessToken',
      },
    );
    final body = _decodeObject(response);
    final items = body['items'];

    if (items is! List<dynamic>) {
      throw const PollsApiException('Subscriptions response is invalid.');
    }

    return items
        .map(
          (item) => PollSummary.fromJson(item as Map<String, dynamic>),
        )
        .toList();
  }

  Future<PollSummary> createPoll({
    required String question,
    required List<String> options,
    required String accessToken,
    bool allowVoteCancellation = false,
  }) async {
    final uri = Uri.parse(_config.baseUrl).replace(
      path: '/polls',
    );
    final requestBody = <String, dynamic>{
      'question': question,
      'options': options,
      // Older API versions reject unknown fields because their schema is
      // strict. Omitting the default value keeps creation compatible with
      // those versions; enabling the option requires the updated API.
      if (allowVoteCancellation)
        'allowVoteCancellation': true,
    };

    final response = await _httpClient.post(
      uri,
      headers: {
        'authorization': 'Bearer $accessToken',
        'content-type': 'application/json',
      },
      body: jsonEncode(requestBody),
    );
    final body = _decodeObject(response);
    final poll = body['poll'];

    if (poll is! Map<String, dynamic>) {
      throw const PollsApiException('Create poll response is invalid.');
    }

    return PollSummary.fromJson(poll);
  }

  Future<PollSummary> vote({
    required String pollId,
    required String optionId,
    required String accessToken,
  }) async {
    final uri = Uri.parse(_config.baseUrl).replace(
      path: '/polls/$pollId/votes',
    );
    final response = await _httpClient.post(
      uri,
      headers: {
        'authorization': 'Bearer $accessToken',
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'optionId': optionId,
      }),
    );
    final body = _decodeObject(response);
    final poll = body['poll'];

    if (poll is! Map<String, dynamic>) {
      throw const PollsApiException('Vote response is invalid.');
    }

    return PollSummary.fromJson(poll);
  }

  Future<PollSummary> setVote({
    required String pollId,
    required String optionId,
    required String accessToken,
  }) async {
    final uri = Uri.parse(_config.baseUrl).replace(
      path: '/polls/$pollId/votes',
    );
    try {
      final response = await _httpClient.put(
        uri,
        headers: {
          'authorization': 'Bearer $accessToken',
          'content-type': 'application/json',
        },
        body: jsonEncode({'optionId': optionId}),
      );

      return _decodePollResponse(response, 'Set vote response is invalid.');
    } on PollsApiException catch (error) {
      // Keep first-time voting usable while an older API instance is being
      // rolled out. Do not fall back for a real missing poll/option error.
      if (error.statusCode == 404 &&
          error.code == 'not_found' &&
          error.message == 'Route was not found.') {
        return vote(
          pollId: pollId,
          optionId: optionId,
          accessToken: accessToken,
        );
      }
      rethrow;
    }
  }

  Future<PollSummary> cancelVote({
    required String pollId,
    required String accessToken,
  }) async {
    final uri = Uri.parse(_config.baseUrl).replace(
      path: '/polls/$pollId/votes',
    );
    final response = await _httpClient.delete(
      uri,
      headers: {
        'authorization': 'Bearer $accessToken',
      },
    );

    return _decodePollResponse(response, 'Cancel vote response is invalid.');
  }

  Future<void> deletePoll({
    required String pollId,
    required String accessToken,
  }) async {
    final uri = Uri.parse(_config.baseUrl).replace(
      path: '/polls/$pollId',
    );
    final response = await _httpClient.delete(
      uri,
      headers: {
        'authorization': 'Bearer $accessToken',
      },
    );

    if (response.statusCode != 204) {
      _decodeObject(response);
    }
  }

  Future<PollSummary> likePoll({
    required String pollId,
    required String accessToken,
  }) async {
    final uri = Uri.parse(_config.baseUrl).replace(
      path: '/polls/$pollId/likes',
    );
    final response = await _httpClient.post(
      uri,
      headers: {
        'authorization': 'Bearer $accessToken',
      },
    );

    return _decodePollResponse(response, 'Like response is invalid.');
  }

  Future<PollSummary> unlikePoll({
    required String pollId,
    required String accessToken,
  }) async {
    final uri = Uri.parse(_config.baseUrl).replace(
      path: '/polls/$pollId/likes',
    );
    final response = await _httpClient.delete(
      uri,
      headers: {
        'authorization': 'Bearer $accessToken',
      },
    );

    return _decodePollResponse(response, 'Unlike response is invalid.');
  }

  Future<List<PollCommentSummary>> listComments({
    required String pollId,
    int limit = 50,
  }) async {
    final uri = Uri.parse(_config.baseUrl).replace(
      path: '/polls/$pollId/comments',
      queryParameters: {
        'limit': limit.toString(),
      },
    );
    final response = await _httpClient.get(uri);
    final body = _decodeObject(response);

    final items = body['items'];

    if (items is! List<dynamic>) {
      throw const PollsApiException('Poll comments response is invalid.');
    }

    return items
        .map(
          (item) => PollCommentSummary.fromJson(item as Map<String, dynamic>),
        )
        .toList();
  }

  Future<CreatePollCommentResult> createComment({
    required String pollId,
    required String body,
    required String accessToken,
  }) async {
    final uri = Uri.parse(_config.baseUrl).replace(
      path: '/polls/$pollId/comments',
    );
    final response = await _httpClient.post(
      uri,
      headers: {
        'authorization': 'Bearer $accessToken',
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'body': body,
      }),
    );
    final decoded = _decodeObject(response);
    final comment = decoded['comment'];
    final poll = decoded['poll'];

    if (comment is! Map<String, dynamic> || poll is! Map<String, dynamic>) {
      throw const PollsApiException('Create comment response is invalid.');
    }

    return CreatePollCommentResult(
      comment: PollCommentSummary.fromJson(comment),
      poll: PollSummary.fromJson(poll),
    );
  }

  PollSummary _decodePollResponse(http.Response response, String errorMessage) {
    final body = _decodeObject(response);
    final poll = body['poll'];

    if (poll is! Map<String, dynamic>) {
      throw PollsApiException(errorMessage);
    }

    return PollSummary.fromJson(poll);
  }

  Map<String, dynamic> _decodeObject(http.Response response) {
    final decoded = jsonDecode(response.body);

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = decoded is Map<String, dynamic>
          ? decoded['message'] as String?
          : null;
      final code = decoded is Map<String, dynamic>
          ? decoded['error'] as String?
          : null;

      throw PollsApiException(
        message ?? 'Request failed.',
        statusCode: response.statusCode,
        code: code,
      );
    }

    if (decoded is! Map<String, dynamic>) {
      throw const PollsApiException('Response is invalid.');
    }

    return decoded;
  }
}
