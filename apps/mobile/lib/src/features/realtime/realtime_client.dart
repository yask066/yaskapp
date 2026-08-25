import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

import '../../core/config/api_config.dart';
import '../polls/poll_summary.dart';

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
  const CommentDeletedRealtimeEvent({required this.commentId, required this.pollId});
  final String commentId;
  final String pollId;
}

class RealtimeClient {
  RealtimeClient({ApiConfig config = const ApiConfig()}) : _config = config;

  final ApiConfig _config;
  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;
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

  Stream<PollVoteRealtimeEvent> get pollVotes => _pollVoteController.stream;
  Stream<PollDeletedRealtimeEvent> get pollDeletions =>
      _pollDeletedController.stream;
  Stream<UserModerationRealtimeEvent> get userBlocked =>
      _userBlockedController.stream;
  Stream<UserModerationRealtimeEvent> get userUnblocked =>
      _userUnblockedController.stream;
  Stream<CommentDeletedRealtimeEvent> get commentDeletions =>
      _commentDeletedController.stream;

  void connect() {
    if (_channel != null) {
      return;
    }

    final channel = WebSocketChannel.connect(Uri.parse(_config.websocketUrl));
    _channel = channel;
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

    await channel?.sink.close();
  }

  Future<void> close() async {
    await disconnect();
    await _pollVoteController.close();
    await _pollDeletedController.close();
    await _userBlockedController.close();
    await _userUnblockedController.close();
    await _commentDeletedController.close();
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

    if (decoded['type'] == 'poll.admin_deleted') {
      final payload = decoded['payload'];
      if (payload is Map<String, dynamic> && payload['pollId'] is String) {
        _pollDeletedController.add(
          PollDeletedRealtimeEvent(pollId: payload['pollId'] as String),
        );
      }
      return;
    }

    if (decoded['type'] == 'user.blocked' || decoded['type'] == 'user.unblocked') {
      final payload = decoded['payload'];
      if (payload is Map<String, dynamic> && payload['userId'] is String) {
        final event = UserModerationRealtimeEvent(userId: payload['userId'] as String);
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
      if (payload is Map<String, dynamic> && payload['commentId'] is String && payload['pollId'] is String) {
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
