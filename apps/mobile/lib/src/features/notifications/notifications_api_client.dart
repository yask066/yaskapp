import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../core/config/api_config.dart';

class NotificationsApiException implements Exception {
  const NotificationsApiException(this.message);
  final String message;
  @override
  String toString() => message;
}

class NotificationActor {
  const NotificationActor(
      {required this.username, required this.displayName, this.avatarUrl});
  final String username;
  final String displayName;
  final String? avatarUrl;
}

class NotificationSummary {
  const NotificationSummary({
    required this.id,
    required this.type,
    required this.actor,
    required this.pollId,
    required this.commentId,
    required this.readAt,
    required this.createdAt,
    required this.isTargetAvailable,
  });

  factory NotificationSummary.fromJson(Map<String, dynamic> json) {
    final actor = json['actor'] as Map<String, dynamic>?;
    return NotificationSummary(
      id: json['id'] as String,
      type: json['type'] as String,
      actor: actor == null
          ? null
          : NotificationActor(
              username: actor['username'] as String,
              displayName: actor['displayName'] as String,
              avatarUrl: actor['avatarUrl'] as String?,
            ),
      pollId: json['pollId'] as String?,
      commentId: json['commentId'] as String?,
      readAt: json['readAt'] == null
          ? null
          : DateTime.parse(json['readAt'] as String).toLocal(),
      createdAt: DateTime.parse(json['createdAt'] as String).toLocal(),
      isTargetAvailable: json['isTargetAvailable'] as bool? ?? true,
    );
  }

  final String id;
  final String type;
  final NotificationActor? actor;
  final String? pollId;
  final String? commentId;
  final DateTime? readAt;
  final DateTime createdAt;
  final bool isTargetAvailable;
  bool get isUnread => readAt == null;

  String get title {
    final actorName = actor?.displayName ?? 'Someone';
    return switch (type) {
      'poll_vote' => '$actorName voted in your poll',
      'comment' => '$actorName commented on your poll',
      'comment_reply' => '$actorName replied to your comment',
      'follow' => '$actorName started following you',
      'like' => '$actorName liked your poll',
      _ => 'You have a new notification',
    };
  }

  String get detail => switch (type) {
        'poll_vote' => 'Open the poll to view the updated results',
        'comment' => 'Open the comment to view the discussion',
        'comment_reply' => 'Open the discussion to view the reply',
        'follow' => 'View this profile to see more details',
        'like' => 'Open the poll to view its activity',
        _ => 'Open this notification to view more details',
      };

  String get targetLabel {
    if (!isTargetAvailable) return 'Content unavailable';
    if (commentId != null) return 'Poll and comment';
    if (pollId != null) return 'Poll';
    return 'Profile';
  }
}

class NotificationsPage {
  const NotificationsPage(
      {required this.items,
      required this.nextCursor,
      required this.unreadCount});
  final List<NotificationSummary> items;
  final String? nextCursor;
  final int unreadCount;
}

class NotificationsApiClient {
  NotificationsApiClient(
      {ApiConfig config = const ApiConfig(), http.Client? httpClient})
      : _config = config,
        _httpClient = httpClient ?? http.Client();

  final ApiConfig _config;
  final http.Client _httpClient;
  void close() => _httpClient.close();

  Future<NotificationsPage> list(
      {required String accessToken,
      String? cursor,
      bool unreadOnly = false,
      int limit = 25}) async {
    final query = <String, String>{
      'limit': '$limit',
      'unreadOnly': '$unreadOnly',
      if (cursor != null) 'cursor': cursor
    };
    final response = await _httpClient
        .get(
          Uri.parse(_config.baseUrl)
              .replace(path: '/notifications', queryParameters: query),
          headers: {'authorization': 'Bearer $accessToken'},
        )
        .timeout(const Duration(seconds: 10));
    final body = _decode(response);
    final items = body['items'];
    if (items is! List<dynamic>)
      throw const NotificationsApiException(
          'Notifications response is invalid.');
    return NotificationsPage(
      items: items
          .map((item) =>
              NotificationSummary.fromJson(item as Map<String, dynamic>))
          .toList(),
      nextCursor: body['nextCursor'] as String?,
      unreadCount: body['unreadCount'] as int? ?? 0,
    );
  }

  Future<void> markRead(
      {required String accessToken, required String id}) async {
    final response = await _httpClient.post(
      Uri.parse(_config.baseUrl).replace(path: '/notifications/$id/read'),
      headers: {'authorization': 'Bearer $accessToken'},
    );
    if (response.statusCode < 200 || response.statusCode >= 300)
      _throwResponse(response);
  }

  Future<int> markAllRead({required String accessToken}) async {
    final response = await _httpClient.post(
      Uri.parse(_config.baseUrl).replace(path: '/notifications/read-all'),
      headers: {'authorization': 'Bearer $accessToken'},
    );
    final body = _decode(response);
    return body['unreadCount'] as int? ?? 0;
  }

  Map<String, dynamic> _decode(http.Response response) {
    final decoded = response.body.isEmpty
        ? const <String, dynamic>{}
        : jsonDecode(response.body);
    if (response.statusCode < 200 || response.statusCode >= 300)
      _throwResponse(response, decoded);
    if (decoded is! Map<String, dynamic>)
      throw const NotificationsApiException(
          'Notifications response is invalid.');
    return decoded;
  }

  Never _throwResponse(http.Response response, [Object? decoded]) {
    final body =
        decoded is Map<String, dynamic> ? decoded : <String, dynamic>{};
    throw NotificationsApiException(
        body['message'] as String? ?? 'Could not load notifications.');
  }
}
