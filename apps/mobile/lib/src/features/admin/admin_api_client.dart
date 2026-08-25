import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../core/config/api_config.dart';

class AdminApiException implements Exception {
  const AdminApiException(this.message, {this.statusCode, this.code});
  final String message;
  final int? statusCode;
  final String? code;
  String get userMessage {
    if (statusCode == 401) return 'Your session has expired. Please sign in again.';
    if (statusCode == 403) return 'You do not have permission to perform this action.';
    if (statusCode == 404) return 'The requested moderation item was not found.';
    if (statusCode == 409 || code == 'invalid_admin_transition') return 'This administrative action is not allowed in the current state.';
    if (statusCode == 400 || statusCode == 422 || code == 'validation_error') return 'Please provide a valid reason and try again.';
    if (statusCode == 429) return 'Too many administrative requests. Try again later.';
    return message;
  }
  @override
  String toString() => message;
}

class AdminCapabilities {
  const AdminCapabilities(this.permissions);
  factory AdminCapabilities.fromJson(Map<String, dynamic> json) => AdminCapabilities(
        (json['permissions'] as List<dynamic>? ?? const []).whereType<String>().toSet(),
      );
  final Set<String> permissions;
  bool has(String permission) => permissions.contains(permission);
  bool get canReadUsers => has('admin.users.read');
  bool get canBlockUsers => has('admin.users.block');
  bool get canUnblockUsers => has('admin.users.unblock');
  bool get canDeleteUsers => has('admin.users.delete');
  bool get canChangeRoles => has('admin.users.roles.update');
  bool get canReadPolls => has('admin.polls.read');
  bool get canDeletePolls => has('admin.polls.delete');
  bool get canDeleteComments => has('admin.comments.delete');
  bool get canReadAudit => has('admin.audit.read');
}

class AdminUserSummary {
  const AdminUserSummary({required this.id, required this.username, required this.email, required this.role, required this.status, required this.displayName, required this.createdAt, required this.pollsCount});
  factory AdminUserSummary.fromJson(Map<String, dynamic> json) {
    final profile = json['profile'] as Map<String, dynamic>? ?? const {};
    return AdminUserSummary(
      id: json['id'] as String,
      username: json['username'] as String,
      email: json['email'] as String,
      role: json['role'] as String,
      status: json['status'] as String,
      displayName: profile['displayName'] as String? ?? json['username'] as String,
      createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.fromMillisecondsSinceEpoch(0),
      pollsCount: profile['pollsCount'] as int? ?? 0,
    );
  }
  final String id, username, email, role, status, displayName;
  final DateTime createdAt;
  final int pollsCount;
}

class AdminPollSummary {
  const AdminPollSummary({required this.id, required this.question, required this.authorUsername, required this.status, required this.votesCount, required this.commentsCount, required this.createdAt});
  factory AdminPollSummary.fromJson(Map<String, dynamic> json) => AdminPollSummary(
    id: json['id'] as String,
    question: json['question'] as String,
    authorUsername: json['authorUsername'] as String,
    status: json['status'] as String,
    votesCount: json['votesCount'] as int? ?? 0,
    commentsCount: json['commentsCount'] as int? ?? 0,
    createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.fromMillisecondsSinceEpoch(0),
  );
  final String id, question, authorUsername, status;
  final int votesCount, commentsCount;
  final DateTime createdAt;
}

class AdminAuditEntry {
  const AdminAuditEntry({required this.action, required this.targetType, required this.targetId, required this.reason, required this.createdAt});
  factory AdminAuditEntry.fromJson(Map<String, dynamic> json) => AdminAuditEntry(
    action: json['action'] as String,
    targetType: json['targetType'] as String,
    targetId: json['targetId'] as String,
    reason: json['reason'] as String,
    createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.fromMillisecondsSinceEpoch(0),
  );
  final String action, targetType, targetId, reason;
  final DateTime createdAt;
}

class AdminCommentSummary {
  const AdminCommentSummary({required this.id, required this.body, required this.authorUsername});
  factory AdminCommentSummary.fromJson(Map<String, dynamic> json) {
    final author = json['author'] as Map<String, dynamic>? ?? const {};
    return AdminCommentSummary(
      id: json['id'] as String,
      body: json['body'] as String,
      authorUsername: author['username'] as String? ?? 'unknown',
    );
  }
  final String id;
  final String body;
  final String authorUsername;
}

class AdminApiClient {
  AdminApiClient({ApiConfig config = const ApiConfig(), http.Client? httpClient}) : _config = config, _httpClient = httpClient ?? http.Client();
  final ApiConfig _config;
  final http.Client _httpClient;
  void close() => _httpClient.close();

  Future<AdminCapabilities> loadCapabilities({required String accessToken}) async {
    final body = await _request('GET', '/admin/capabilities', accessToken: accessToken);
    return AdminCapabilities.fromJson(body);
  }

  Future<bool> canAccess({required String accessToken}) async {
    try {
      await listUsers(accessToken: accessToken, limit: 1);
      return true;
    } on AdminApiException catch (error) {
      if (error.statusCode == 401 || error.statusCode == 403) return false;
      rethrow;
    }
  }

  Future<List<AdminUserSummary>> listUsers({required String accessToken, String query = '', String status = 'all', String role = 'all', int limit = 50}) async {
    final body = await _request('GET', '/admin/users', accessToken: accessToken, query: {'query': query, 'status': status, 'role': role, 'limit': '$limit'});
    return (body['items'] as List<dynamic>).map((item) => AdminUserSummary.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<List<AdminPollSummary>> listPolls({required String accessToken, String query = '', String status = 'all', int limit = 50}) async {
    final body = await _request('GET', '/admin/polls', accessToken: accessToken, query: {'query': query, 'status': status, 'limit': '$limit'});
    return (body['items'] as List<dynamic>).map((item) => AdminPollSummary.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<List<AdminAuditEntry>> listAudit({required String accessToken, int limit = 50}) async {
    final body = await _request('GET', '/admin/audit', accessToken: accessToken, query: {'limit': '$limit'});
    return (body['items'] as List<dynamic>).map((item) => AdminAuditEntry.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<List<AdminCommentSummary>> listComments({required String pollId, int limit = 50}) async {
    final body = await _request('GET', '/polls/$pollId/comments', query: {'limit': '$limit'});
    return (body['items'] as List<dynamic>).map((item) => AdminCommentSummary.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<void> deletePoll({required String pollId, required String accessToken, required String reason}) => _mutate('DELETE', '/admin/polls/$pollId', accessToken, reason);
  Future<void> deleteComment({required String commentId, required String accessToken, required String reason}) => _mutate('DELETE', '/admin/comments/$commentId', accessToken, reason);
  Future<void> deleteUser({required String userId, required String accessToken, required String reason}) => _mutate('DELETE', '/admin/users/$userId', accessToken, reason);
  Future<void> blockUser({required String userId, required String accessToken, required String reason}) => _mutate('POST', '/admin/users/$userId/block', accessToken, reason);
  Future<void> unblockUser({required String userId, required String accessToken, required String reason}) => _mutate('POST', '/admin/users/$userId/unblock', accessToken, reason);

  Future<void> changeRole({required String userId, required String role, required String accessToken, required String reason}) async {
    await _request('PATCH', '/admin/users/$userId/role', accessToken: accessToken, body: {'role': role, 'reason': reason});
  }

  Future<void> _mutate(String method, String path, String token, String reason) async {
    await _request(method, path, accessToken: token, body: {'reason': reason});
  }

  Future<Map<String, dynamic>> _request(String method, String path, {String? accessToken, Map<String, String>? query, Map<String, dynamic>? body}) async {
    final uri = Uri.parse(_config.baseUrl).replace(path: path, queryParameters: query == null ? null : query..removeWhere((_, value) => value.isEmpty));
    final request = http.Request(method, uri);
    if (accessToken != null && accessToken.isNotEmpty) request.headers['authorization'] = 'Bearer $accessToken';
    if (body != null) { request.headers['content-type'] = 'application/json'; request.body = jsonEncode(body); }
    final response = await _httpClient.send(request).then(http.Response.fromStream);
    if (response.statusCode == 204) return <String, dynamic>{};
    final decoded = response.body.isEmpty ? <String, dynamic>{} : jsonDecode(response.body);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw AdminApiException(decoded is Map<String, dynamic> ? decoded['message'] as String? ?? 'Request failed.' : 'Request failed.', statusCode: response.statusCode, code: decoded is Map<String, dynamic> ? decoded['error'] as String? : null);
    }
    if (decoded is! Map<String, dynamic>) throw const AdminApiException('Response is invalid.');
    return decoded;
  }
}
