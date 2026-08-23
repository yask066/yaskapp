import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

import '../../core/config/api_config.dart';
import '../polls/poll_summary.dart';

class PollVoteRealtimeEvent {
  const PollVoteRealtimeEvent({required this.poll});

  final PollSummary poll;
}

class RealtimeClient {
  RealtimeClient({ApiConfig config = const ApiConfig()}) : _config = config;

  final ApiConfig _config;
  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;
  final _pollVoteController =
      StreamController<PollVoteRealtimeEvent>.broadcast();

  Stream<PollVoteRealtimeEvent> get pollVotes => _pollVoteController.stream;

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
