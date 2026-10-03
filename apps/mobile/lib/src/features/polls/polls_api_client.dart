import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import '../../core/config/api_config.dart';
import 'poll_summary.dart';
import 'poll_state_store.dart';

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
  PollStateStore? _pollStateStore;
  int _requestSequence = 0;

  void bindPollStateStore(PollStateStore store) {
    _pollStateStore = store;
  }

  _PollReadContext _captureRead({String? expectedPollId}) {
    final store = _pollStateStore;
    return _PollReadContext(
      store: store,
      epoch: store?.sessionEpoch ?? 0,
      viewerId: store?.viewerId,
      expectedPollId: expectedPollId,
      requestId: 'read-${++_requestSequence}',
      startedGeneration:
          expectedPollId == null ? null : store?.generationFor(expectedPollId),
      generationSnapshot: store?.generationSnapshot ?? const {},
    );
  }

  PollSummary _ingestRead(PollSummary poll, _PollReadContext context) {
    final store = context.store;
    if (store == null) return poll;
    return store
            .ingest(
              poll,
              PollIngress(
                origin: PollOrigin.http,
                sessionEpoch: context.epoch,
                viewerId: context.viewerId,
                expectedPollId: context.expectedPollId,
                requestId: context.requestId,
                startedGeneration: context.startedGeneration ??
                    context.generationSnapshot[poll.id] ??
                    0,
              ),
            )
            .state ??
        poll;
  }

  List<PollSummary> _ingestReadList(
    List<PollSummary> polls,
    _PollReadContext context,
  ) {
    final unique = <String, PollSummary>{};
    for (final poll in polls) {
      unique[poll.id] = _ingestRead(poll, context);
    }
    return unique.values.toList();
  }

  PollSummary _ingestMutation(PollSummary poll, String requestId) {
    final store = _pollStateStore;
    if (store == null) return poll;
    return store
            .ingest(
              poll,
              PollIngress(
                origin: PollOrigin.mutation,
                sessionEpoch: store.sessionEpoch,
                viewerId: store.viewerId,
                expectedPollId: poll.id,
                requestId: requestId,
                startedGeneration: store.generationFor(poll.id),
              ),
            )
            .state ??
        poll;
  }

  void close() {
    _httpClient.close();
  }

  Future<List<PollSummary>> listPolls({
    int limit = 20,
    String? accessToken,
    String sort = 'newest',
  }) async {
    final readContext = _captureRead();
    final uri = Uri.parse(_config.baseUrl).replace(
      path: '/polls',
      queryParameters: {
        'limit': limit.toString(),
        if (sort != 'newest') 'sort': sort,
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

    return _ingestReadList(
        items
            .map(
              (item) => PollSummary.fromJson(item as Map<String, dynamic>),
            )
            .toList(),
        readContext);
  }

  Future<PollSummary> getPoll({
    required String pollId,
    String? accessToken,
  }) async {
    final readContext = _captureRead(expectedPollId: pollId);
    final uri = Uri.parse(_config.baseUrl).replace(path: '/polls/$pollId');
    final response = await _httpClient.get(
      uri,
      headers: {
        if (accessToken != null) 'authorization': 'Bearer $accessToken',
      },
    );
    return _ingestRead(
      _decodePollResponse(response, 'Poll response is invalid.'),
      readContext,
    );
  }

  Future<List<PollSummary>> listMyPolls({
    required String accessToken,
    int limit = 20,
  }) async {
    final readContext = _captureRead();
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

    return _ingestReadList(
        items
            .map(
              (item) => PollSummary.fromJson(item as Map<String, dynamic>),
            )
            .toList(),
        readContext);
  }

  Future<List<PollSummary>> listUserPolls({
    required String userId,
    String? accessToken,
    int limit = 20,
  }) async {
    final readContext = _captureRead();
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

    return _ingestReadList(
        items
            .map((item) => PollSummary.fromJson(item as Map<String, dynamic>))
            .toList(),
        readContext);
  }

  Future<List<PollSummary>> listSubscriptions({
    required String accessToken,
    int limit = 20,
  }) async {
    final readContext = _captureRead();
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

    return _ingestReadList(
        items
            .map(
              (item) => PollSummary.fromJson(item as Map<String, dynamic>),
            )
            .toList(),
        readContext);
  }

  Future<PollSummary> createPoll({
    required String question,
    required List<String> options,
    required String accessToken,
    bool allowVoteCancellation = false,
    Uint8List? imageBytes,
    String? imageFilename,
    String? imageContentType,
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
      if (allowVoteCancellation) 'allowVoteCancellation': true,
    };

    final http.Response response;

    if (imageBytes == null) {
      response = await _httpClient.post(
        uri,
        headers: {
          'authorization': 'Bearer $accessToken',
          'content-type': 'application/json',
        },
        body: jsonEncode(requestBody),
      );
    } else {
      final request = http.MultipartRequest('POST', uri)
        ..headers['authorization'] = 'Bearer $accessToken'
        ..fields['question'] = question
        ..fields['options'] = jsonEncode(options);

      if (allowVoteCancellation) {
        request.fields['allowVoteCancellation'] = 'true';
      }

      request.files.add(
        http.MultipartFile.fromBytes(
          'image',
          imageBytes,
          filename: imageFilename ?? 'poll-image',
          contentType: _mediaType(imageContentType ?? 'image/jpeg'),
        ),
      );

      response = await http.Response.fromStream(
        await _httpClient.send(request),
      );
    }
    final body = _decodeObject(response);
    final poll = body['poll'];

    if (poll is! Map<String, dynamic>) {
      throw const PollsApiException('Create poll response is invalid.');
    }

    return _ingestMutation(PollSummary.fromJson(poll), 'create-${poll['id']}');
  }

  MediaType? _mediaType(String contentType) {
    final parts = contentType.split('/');

    if (parts.length != 2 || parts.any((part) => part.isEmpty)) {
      return null;
    }

    return MediaType(parts[0], parts[1]);
  }

  Future<PollSummary> vote({
    required String pollId,
    required String optionId,
    required String accessToken,
  }) async {
    final stateStore = _pollStateStore;
    final operation = stateStore?.beginOperation(pollId, PollAction.vote);
    if (stateStore != null && operation == null) {
      final current = stateStore.pollById(pollId);
      if (current != null) return current;
      throw const PollsApiException('Poll action already in progress.');
    }
    try {
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

      final updated = PollSummary.fromJson(poll);
      if (operation != null) {
        stateStore!.completeOperation(operation, updated);
        return stateStore.pollById(pollId) ?? updated;
      }
      return updated;
    } catch (error) {
      if (operation != null) {
        stateStore!.failOperation(
          operation,
          ambiguous: error is! PollsApiException,
        );
      }
      rethrow;
    }
  }

  Future<PollSummary> cancelVote({
    required String pollId,
    required String accessToken,
  }) async {
    final stateStore = _pollStateStore;
    final operation = stateStore?.beginOperation(pollId, PollAction.vote);
    if (stateStore != null && operation == null) {
      final current = stateStore.pollById(pollId);
      if (current != null) return current;
      throw const PollsApiException('Poll action already in progress.');
    }
    try {
      final uri = Uri.parse(_config.baseUrl).replace(
        path: '/polls/$pollId/votes',
      );
      final response = await _httpClient.delete(
        uri,
        headers: {
          'authorization': 'Bearer $accessToken',
        },
      );

      final updated =
          _decodePollResponse(response, 'Cancel vote response is invalid.');
      if (operation != null) {
        stateStore!.completeOperation(operation, updated);
        return stateStore.pollById(pollId) ?? updated;
      }
      return updated;
    } catch (error) {
      if (operation != null) {
        stateStore!.failOperation(
          operation,
          ambiguous: error is! PollsApiException,
        );
      }
      rethrow;
    }
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
    final store = _pollStateStore;
    if (store != null) {
      store.markDeleted(
        pollId,
        PollIngress(
          origin: PollOrigin.mutation,
          sessionEpoch: store.sessionEpoch,
          viewerId: store.viewerId,
          expectedPollId: pollId,
          requestId: 'delete-$pollId',
          startedGeneration: store.generationFor(pollId),
        ),
      );
    }
  }

  Future<PollSummary> likePoll({
    required String pollId,
    required String accessToken,
  }) async {
    final stateStore = _pollStateStore;
    final operation = stateStore?.beginOperation(pollId, PollAction.like);
    if (stateStore != null && operation == null) {
      final current = stateStore.pollById(pollId);
      if (current != null) return current;
      throw const PollsApiException('Poll action already in progress.');
    }
    try {
      final uri = Uri.parse(_config.baseUrl).replace(
        path: '/polls/$pollId/likes',
      );
      final response = await _httpClient.post(
        uri,
        headers: {
          'authorization': 'Bearer $accessToken',
        },
      );

      final updated =
          _decodePollResponse(response, 'Like response is invalid.');
      if (operation != null) {
        stateStore!.completeOperation(operation, updated);
        return stateStore.pollById(pollId) ?? updated;
      }
      return updated;
    } catch (error) {
      if (operation != null) {
        stateStore!.failOperation(
          operation,
          ambiguous: error is! PollsApiException,
        );
      }
      rethrow;
    }
  }

  Future<PollSummary> unlikePoll({
    required String pollId,
    required String accessToken,
  }) async {
    final stateStore = _pollStateStore;
    final operation = stateStore?.beginOperation(pollId, PollAction.like);
    if (stateStore != null && operation == null) {
      final current = stateStore.pollById(pollId);
      if (current != null) return current;
      throw const PollsApiException('Poll action already in progress.');
    }
    try {
      final uri = Uri.parse(_config.baseUrl).replace(
        path: '/polls/$pollId/likes',
      );
      final response = await _httpClient.delete(
        uri,
        headers: {
          'authorization': 'Bearer $accessToken',
        },
      );

      final updated =
          _decodePollResponse(response, 'Unlike response is invalid.');
      if (operation != null) {
        stateStore!.completeOperation(operation, updated);
        return stateStore.pollById(pollId) ?? updated;
      }
      return updated;
    } catch (error) {
      if (operation != null) {
        stateStore!.failOperation(
          operation,
          ambiguous: error is! PollsApiException,
        );
      }
      rethrow;
    }
  }

  Future<List<PollCommentSummary>> listComments({
    required String pollId,
    int limit = 50,
    String? accessToken,
  }) async {
    final uri = Uri.parse(_config.baseUrl).replace(
      path: '/polls/$pollId/comments',
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
      throw const PollsApiException('Poll comments response is invalid.');
    }

    return items
        .map(
          (item) => PollCommentSummary.fromJson(item as Map<String, dynamic>),
        )
        .toList();
  }

  Future<PollCommentRepliesPage> listCommentReplies({
    required String pollId,
    required String rootCommentId,
    int limit = 20,
    String? cursor,
    String? accessToken,
  }) async {
    final uri = Uri.parse(_config.baseUrl).replace(
      path: '/polls/$pollId/comments/$rootCommentId/replies',
      queryParameters: {
        'limit': limit.toString(),
        if (cursor != null) 'cursor': cursor,
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
      throw const PollsApiException(
          'Poll comment replies response is invalid.');
    }
    final nextCursor = body['nextCursor'];
    if (nextCursor != null && nextCursor is! String) {
      throw const PollsApiException(
          'Poll comment replies response is invalid.');
    }

    return PollCommentRepliesPage(
      items: items
          .map(
            (item) => PollCommentSummary.fromJson(item as Map<String, dynamic>),
          )
          .toList(),
      nextCursor: nextCursor as String?,
    );
  }

  Future<PollCommentSummary> getComment({
    required String pollId,
    required String commentId,
    required String accessToken,
  }) async {
    final uri = Uri.parse(_config.baseUrl).replace(
      path: '/polls/$pollId/comments/$commentId',
    );
    final response = await _httpClient.get(
      uri,
      headers: {'authorization': 'Bearer $accessToken'},
    );

    return _decodeCommentResponse(
      response,
      'Poll comment response is invalid.',
    );
  }

  Future<PollCommentSummary> likeComment({
    required String pollId,
    required String commentId,
    required String accessToken,
  }) async {
    final uri = Uri.parse(_config.baseUrl).replace(
      path: '/polls/$pollId/comments/$commentId/likes',
    );
    final response = await _httpClient.post(
      uri,
      headers: {'authorization': 'Bearer $accessToken'},
    );

    return _decodeCommentResponse(
        response, 'Like comment response is invalid.');
  }

  Future<PollCommentSummary> unlikeComment({
    required String pollId,
    required String commentId,
    required String accessToken,
  }) async {
    final uri = Uri.parse(_config.baseUrl).replace(
      path: '/polls/$pollId/comments/$commentId/likes',
    );
    final response = await _httpClient.delete(
      uri,
      headers: {'authorization': 'Bearer $accessToken'},
    );

    return _decodeCommentResponse(
        response, 'Unlike comment response is invalid.');
  }

  Future<void> deleteComment({
    required String pollId,
    required String commentId,
    required String accessToken,
  }) async {
    final uri = Uri.parse(_config.baseUrl).replace(
      path: '/polls/$pollId/comments/$commentId',
    );
    final response = await _httpClient.delete(
      uri,
      headers: {'authorization': 'Bearer $accessToken'},
    );

    if (response.statusCode != 204) {
      _decodeObject(response);
    }
  }

  Future<CreatePollCommentResult> createComment({
    required String pollId,
    required String body,
    required String accessToken,
    String? parentCommentId,
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
        if (parentCommentId != null) 'parentCommentId': parentCommentId,
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
      poll: _ingestMutation(PollSummary.fromJson(poll), 'comment-$pollId'),
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

  PollCommentSummary _decodeCommentResponse(
    http.Response response,
    String errorMessage,
  ) {
    final body = _decodeObject(response);
    final comment = body['comment'];

    if (comment is! Map<String, dynamic>) {
      throw PollsApiException(errorMessage);
    }

    return PollCommentSummary.fromJson(comment);
  }

  Map<String, dynamic> _decodeObject(http.Response response) {
    final decoded = jsonDecode(response.body);

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = decoded is Map<String, dynamic>
          ? decoded['message'] as String?
          : null;
      final code =
          decoded is Map<String, dynamic> ? decoded['error'] as String? : null;

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

class _PollReadContext {
  const _PollReadContext({
    required this.store,
    required this.epoch,
    required this.viewerId,
    required this.expectedPollId,
    required this.requestId,
    required this.startedGeneration,
    required this.generationSnapshot,
  });

  final PollStateStore? store;
  final int epoch;
  final String? viewerId;
  final String? expectedPollId;
  final String requestId;
  final int? startedGeneration;
  final Map<String, int> generationSnapshot;
}
