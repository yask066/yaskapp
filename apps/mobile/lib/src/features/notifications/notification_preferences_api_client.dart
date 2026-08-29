import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../core/config/api_config.dart';

class NotificationPreferencesApiException implements Exception {
  const NotificationPreferencesApiException(this.message);
  final String message;
  @override
  String toString() => message;
}

class NotificationPreference {
  const NotificationPreference({required this.inApp, required this.push});
  final bool inApp;
  final bool push;

  factory NotificationPreference.fromJson(Map<String, dynamic> json) {
    return NotificationPreference(
      inApp: json['inApp'] as bool? ?? true,
      push: json['push'] as bool? ?? false,
    );
  }
}

class NotificationPreferences {
  const NotificationPreferences({
    required this.pollVote,
    required this.comment,
    required this.commentReply,
    required this.like,
    required this.follow,
  });

  factory NotificationPreferences.fromJson(Map<String, dynamic> json) {
    NotificationPreference read(String key) => NotificationPreference.fromJson(
          (json[key] as Map<String, dynamic>?) ?? const {},
        );
    return NotificationPreferences(
      pollVote: read('poll_vote'),
      comment: read('comment'),
      commentReply: read('comment_reply'),
      like: read('like'),
      follow: read('follow'),
    );
  }

  final NotificationPreference pollVote;
  final NotificationPreference comment;
  final NotificationPreference commentReply;
  final NotificationPreference like;
  final NotificationPreference follow;
}

class NotificationPreferencesApiClient {
  NotificationPreferencesApiClient({
    ApiConfig config = const ApiConfig(),
    http.Client? httpClient,
  })  : _config = config,
        _httpClient = httpClient ?? http.Client();

  final ApiConfig _config;
  final http.Client _httpClient;

  void close() => _httpClient.close();

  Future<NotificationPreferences> get({required String accessToken}) async {
    final response = await _httpClient.get(
      Uri.parse(_config.baseUrl).replace(path: '/notification-preferences'),
      headers: {'authorization': 'Bearer $accessToken'},
    );
    return NotificationPreferences.fromJson(_decode(response));
  }

  Future<NotificationPreferences> update({
    required String accessToken,
    required String type,
    bool? inApp,
    bool? push,
  }) async {
    final response = await _httpClient.patch(
      Uri.parse(_config.baseUrl).replace(path: '/notification-preferences'),
      headers: {
        'authorization': 'Bearer $accessToken',
        'content-type': 'application/json',
      },
      body: jsonEncode({
        type: {
          if (inApp != null) 'inApp': inApp,
          if (push != null) 'push': push,
        }
      }),
    );
    return NotificationPreferences.fromJson(_decode(response));
  }

  Map<String, dynamic> _decode(http.Response response) {
    final decoded = response.body.isEmpty
        ? const <String, dynamic>{}
        : jsonDecode(response.body);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final body =
          decoded is Map<String, dynamic> ? decoded : const <String, dynamic>{};
      throw NotificationPreferencesApiException(
        body['message'] as String? ??
            'Could not load notification preferences.',
      );
    }
    if (decoded is! Map<String, dynamic>) {
      throw const NotificationPreferencesApiException(
        'Notification preferences response is invalid.',
      );
    }
    return decoded;
  }
}
