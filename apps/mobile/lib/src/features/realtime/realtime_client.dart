import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/io.dart';

import '../../core/config/api_config.dart';
import '../notifications/notification_model.dart';
import '../polls/poll_summary.dart';

enum RealtimeConnectionEvent { ready, disconnected }

class PollVoteRealtimeEvent {
  const PollVoteRealtimeEvent({required this.poll});

  final PollSummary poll;
}

class PollDeletedRealtimeEvent {
  const PollDeletedRealtimeEvent({required this.pollId});

  final String pollId;
}

class UserModerationRealtimeEvent {
  const UserModerationRealtimeEvent({required this.userId});
  final String userId;
}

class CommentDeletedRealtimeEvent {
  const CommentDeletedRealtimeEvent(
      {required this.commentId, required this.pollId});
  final String commentId;
  final String pollId;
}

class NotificationRealtimeEvent {
  const NotificationRealtimeEvent(
      {required this.notification, required this.unreadCount});
  final NotificationItem notification;
  final int unreadCount;

  Map<String, dynamic> get payload => notification.toJson();
}

class NotificationReadRealtimeEvent {
  const NotificationReadRealtimeEvent({
    required this.notificationId,
    required this.readAt,
    required this.unreadCount,
  });

  final String notificationId;
  final DateTime readAt;
  final int unreadCount;
}

class NotificationsReadAllRealtimeEvent {
  const NotificationsReadAllRealtimeEvent({
    required this.readAt,
    required this.unreadCount,
  });

  final DateTime readAt;
  final int unreadCount;
}

NotificationReadRealtimeEvent? decodeNotificationReadRealtimeEvent(
    Object? envelope) {
  if (envelope is! Map<String, dynamic> ||
      envelope['version'] != 1 ||
      envelope['type'] != 'notification.read') {
    return null;
  }
  final payload = envelope['payload'];
  if (payload is! Map<String, dynamic> ||
      payload['notificationId'] is! String ||
      payload['readAt'] is! String ||
      payload['unreadCount'] is! int) {
    return null;
  }
  final readAt = DateTime.tryParse(payload['readAt'] as String);
  if (readAt == null) return null;
  return NotificationReadRealtimeEvent(
    notificationId: payload['notificationId'] as String,
    readAt: readAt,
    unreadCount: payload['unreadCount'] as int,
  );
}

NotificationsReadAllRealtimeEvent? decodeNotificationsReadAllRealtimeEvent(
    Object? envelope) {
  if (envelope is! Map<String, dynamic> ||
      envelope['version'] != 1 ||
      envelope['type'] != 'notifications.read_all') {
    return null;
  }
  final payload = envelope['payload'];
  if (payload is! Map<String, dynamic> ||
      payload['readAt'] is! String ||
      payload['unreadCount'] is! int) {
    return null;
  }
  final readAt = DateTime.tryParse(payload['readAt'] as String);
  if (readAt == null) return null;
  return NotificationsReadAllRealtimeEvent(
    readAt: readAt,
    unreadCount: payload['unreadCount'] as int,
  );
}

class RealtimeClient {
  RealtimeClient({
    ApiConfig config = const ApiConfig(),
    this.accessToken,
    this.heartbeatInterval = const Duration(seconds: 20),
    this.heartbeatTimeout = const Duration(seconds: 45),
  }) : _config = config;

  final ApiConfig _config;
  final String? accessToken;
  final Duration heartbeatInterval;
  final Duration heartbeatTimeout;
  IOWebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;
  Timer? _heartbeatTimer;
  DateTime _lastPong = DateTime.now().toUtc();
  bool _closing = false;
  final _pollVoteController =
      StreamController<PollVoteRealtimeEvent>.broadcast();
  final _pollDeletedController =
      StreamController<PollDeletedRealtimeEvent>.broadcast();
  final _userBlockedController =
      StreamController<UserModerationRealtimeEvent>.broadcast();
  final _userUnblockedController =
      StreamController<UserModerationRealtimeEvent>.broadcast();
  final _commentDeletedController =
      StreamController<CommentDeletedRealtimeEvent>.broadcast();
  final _notificationController =
      StreamController<NotificationRealtimeEvent>.broadcast();
  final _notificationReadController =
      StreamController<NotificationReadRealtimeEvent>.broadcast();
  final _notificationsReadAllController =
      StreamController<NotificationsReadAllRealtimeEvent>.broadcast();
  final _connectionController =
      StreamController<RealtimeConnectionEvent>.broadcast();

  Stream<PollVoteRealtimeEvent> get pollVotes => _pollVoteController.stream;
  Stream<PollDeletedRealtimeEvent> get pollDeletions =>
      _pollDeletedController.stream;
  Stream<UserModerationRealtimeEvent> get userBlocked =>
      _userBlockedController.stream;
  Stream<UserModerationRealtimeEvent> get userUnblocked =>
      _userUnblockedController.stream;
  Stream<CommentDeletedRealtimeEvent> get commentDeletions =>
      _commentDeletedController.stream;
  Stream<NotificationRealtimeEvent> get notifications =>
      _notificationController.stream;
  Stream<NotificationReadRealtimeEvent> get notificationReads =>
      _notificationReadController.stream;
  Stream<NotificationsReadAllRealtimeEvent> get notificationsReadAll =>
      _notificationsReadAllController.stream;
  Stream<RealtimeConnectionEvent> get connectionEvents =>
      _connectionController.stream;

  void connect() {
    if (_channel != null) {
      return;
    }

    _closing = false;

    final channel = IOWebSocketChannel.connect(
      Uri.parse(_config.websocketUrl),
      headers: accessToken == null
          ? const <String, String>{}
          : {'Authorization': 'Bearer $accessToken'},
    );
    _channel = channel;
    _lastPong = DateTime.now().toUtc();
    _startHeartbeat();
    _subscription = channel.stream.listen(
      _handleMessage,
      onError: (_) => disconnect(),
      onDone: disconnect,
      cancelOnError: false,
    );
  }

  Future<void> disconnect() async {
    final subscription = _subscription;
    _subscription = null;

    if (subscription != null) {
      await subscription.cancel();
    }

    final channel = _channel;
    _channel = null;
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;

    await channel?.sink.close();
    if (channel != null && !_closing) {
      _emitConnectionEvent(RealtimeConnectionEvent.disconnected);
    }
  }

  Future<void> close() async {
    _closing = true;
    await disconnect();
    await _pollVoteController.close();
    await _pollDeletedController.close();
    await _userBlockedController.close();
    await _userUnblockedController.close();
    await _commentDeletedController.close();
    await _notificationController.close();
    await _notificationReadController.close();
    await _notificationsReadAllController.close();
    await _connectionController.close();
  }

  void emitConnectionEvent(RealtimeConnectionEvent event) {
    if (!_connectionController.isClosed) {
      _connectionController.add(event);
    }
  }

  void emitNotificationReadEvent(NotificationReadRealtimeEvent event) {
    if (!_notificationReadController.isClosed) {
      _notificationReadController.add(event);
    }
  }

  void emitNotificationsReadAllEvent(
      NotificationsReadAllRealtimeEvent event) {
    if (!_notificationsReadAllController.isClosed) {
      _notificationsReadAllController.add(event);
    }
  }

  void _emitConnectionEvent(RealtimeConnectionEvent event) {
    emitConnectionEvent(event);
  }

  void _startHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(heartbeatInterval, (_) {
      final channel = _channel;
      if (channel == null) return;
      if (DateTime.now().toUtc().difference(_lastPong) > heartbeatTimeout) {
        unawaited(disconnect());
        return;
      }
      channel.sink.add(jsonEncode({'type': 'ping'}));
    });
  }

  void _handleMessage(dynamic message) {
    final Object? decoded;

    try {
      decoded = jsonDecode(message as String);
    } catch (_) {
      return;
    }

    if (decoded is! Map<String, dynamic>) {
      return;
    }

    if (decoded['type'] == 'connection.ready') {
      if (decoded['version'] == 1) {
        _lastPong = DateTime.now().toUtc();
        _emitConnectionEvent(RealtimeConnectionEvent.ready);
      }
      return;
    }

    if (decoded['type'] == 'pong') {
      if (decoded['version'] == 1) {
        _lastPong = DateTime.now().toUtc();
      }
      return;
    }

    if (decoded['type'] == 'poll.admin_deleted') {
      final payload = decoded['payload'];
      if (payload is Map<String, dynamic> && payload['pollId'] is String) {
        _pollDeletedController.add(
          PollDeletedRealtimeEvent(pollId: payload['pollId'] as String),
        );
      }
      return;
    }

    if (decoded['type'] == 'notification.created') {
      final payload = decoded['payload'];
      if (payload is Map<String, dynamic> &&
          payload['notification'] is Map<String, dynamic> &&
          payload['unreadCount'] is int &&
          decoded['version'] == 1) {
        final notification = NotificationItem.tryParse(
          payload['notification'] as Map<String, dynamic>,
        );
        if (notification == null) return;
        _notificationController.add(NotificationRealtimeEvent(
          notification: notification,
          unreadCount: payload['unreadCount'] as int,
        ));
      }
      return;
    }

    if (decoded['type'] == 'notification.read') {
      final event = decodeNotificationReadRealtimeEvent(decoded);
      if (event != null) _notificationReadController.add(event);
      return;
    }

    if (decoded['type'] == 'notifications.read_all') {
      final event = decodeNotificationsReadAllRealtimeEvent(decoded);
      if (event != null) _notificationsReadAllController.add(event);
      return;
    }

    if (decoded['type'] == 'user.blocked' ||
        decoded['type'] == 'user.unblocked') {
      final payload = decoded['payload'];
      if (payload is Map<String, dynamic> && payload['userId'] is String) {
        final event =
            UserModerationRealtimeEvent(userId: payload['userId'] as String);
        if (decoded['type'] == 'user.blocked') {
          _userBlockedController.add(event);
        } else {
          _userUnblockedController.add(event);
        }
      }
      return;
    }

    if (decoded['type'] == 'comment.admin_deleted') {
      final payload = decoded['payload'];
      if (payload is Map<String, dynamic> &&
          payload['commentId'] is String &&
          payload['pollId'] is String) {
        _commentDeletedController.add(CommentDeletedRealtimeEvent(
          commentId: payload['commentId'] as String,
          pollId: payload['pollId'] as String,
        ));
      }
      return;
    }

    if (decoded['type'] != 'poll.vote.created' &&
        decoded['type'] != 'poll.vote.updated') {
      return;
    }

    final payload = decoded['payload'];

    if (payload is! Map<String, dynamic>) {
      return;
    }

    final pollJson = payload['poll'];

    if (pollJson is! Map<String, dynamic>) {
      return;
    }

    _pollVoteController.add(
      PollVoteRealtimeEvent(poll: PollSummary.fromJson(pollJson)),
    );
  }
}
