import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/widgets.dart';

import '../auth/auth_session.dart';
import '../notifications/notification_model.dart';
import '../notifications/notifications_api_client.dart';
import '../notifications/notification_store.dart';
import 'realtime_client.dart';

typedef RealtimeClientFactory = RealtimeClient Function(String accessToken);
typedef NotificationStoreFactory = NotificationStore Function(
    String accessToken);
typedef PollReconcileCallback = void Function();
typedef ReconnectJitter = Duration Function(Duration maxJitter);

class RealtimeSession with WidgetsBindingObserver {
  RealtimeSession({
    RealtimeClientFactory? clientFactory,
    NotificationStoreFactory? storeFactory,
    this.reconcilePolls,
    this.reconnectBaseDelay = const Duration(seconds: 1),
    this.reconnectMaxDelay = const Duration(seconds: 30),
    ReconnectJitter? jitter,
    math.Random? random,
  })  : _clientFactory =
            clientFactory ?? ((token) => RealtimeClient(accessToken: token)),
        _storeFactory = storeFactory ??
            ((token) => NotificationStore(
                  apiClient: NotificationsApiClient(),
                  accessToken: token,
                )),
        _jitter = jitter,
        _random = random ?? math.Random();

  final RealtimeClientFactory _clientFactory;
  final NotificationStoreFactory _storeFactory;
  final PollReconcileCallback? reconcilePolls;
  final Duration reconnectBaseDelay;
  final Duration reconnectMaxDelay;
  final ReconnectJitter? _jitter;
  final math.Random _random;

  RealtimeClient? _client;
  NotificationStore? _store;
  StreamSubscription<RealtimeConnectionEvent>? _connectionSubscription;
  StreamSubscription<NotificationRealtimeEvent>? _notificationSubscription;
  StreamSubscription<NotificationReadRealtimeEvent>?
      _notificationReadSubscription;
  StreamSubscription<NotificationsReadAllRealtimeEvent>?
      _notificationsReadAllSubscription;
  Timer? _reconnectTimer;
  Future<void>? _reconcileFuture;
  int _reconnectAttempt = 0;
  int _epoch = 0;
  String? _currentUserId;
  final _notificationsController =
      StreamController<NotificationItemEvent>.broadcast();

  Stream<NotificationItemEvent> get notificationEvents =>
      _notificationsController.stream;
  RealtimeClient get realtimeClient => _requireClient();
  NotificationStore get notificationStore => _requireStore();
  String? get currentUserId => _currentUserId;

  Future<void> start(AuthSession session) async {
    if (_currentUserId == session.user.id) return;
    if (_currentUserId != null) await stop();

    _epoch++;
    _currentUserId = session.user.id;
    final epoch = _epoch;
    _store = _storeFactory(session.accessToken);
    _client = _clientFactory(session.accessToken);
    _reconnectAttempt = 0;
    WidgetsBinding.instance.addObserver(this);

    _connectionSubscription = _client!.connectionEvents.listen((event) {
      if (epoch != _epoch) return;
      if (event == RealtimeConnectionEvent.ready) {
        _reconnectAttempt = 0;
        unawaited(_reconcile());
        reconcilePolls?.call();
      } else {
        _scheduleReconnect(epoch);
      }
    });
    _notificationSubscription = _client!.notifications.listen((event) {
      if (epoch != _epoch) return;
      _store?.receiveNew(event.notification, unreadCount: event.unreadCount);
      _notificationsController.add(
        NotificationItemEvent(
          notification: event.notification,
          unreadCount: event.unreadCount,
        ),
      );
    });
    _notificationReadSubscription = _client!.notificationReads.listen((event) {
      if (epoch != _epoch) return;
      _store?.applyRemoteRead(
        notificationId: event.notificationId,
        readAt: event.readAt,
        unreadCount: event.unreadCount,
      );
    });
    _notificationsReadAllSubscription =
        _client!.notificationsReadAll.listen((event) {
      if (epoch != _epoch) return;
      _store?.applyRemoteReadAll(
        readAt: event.readAt,
        unreadCount: event.unreadCount,
      );
    });
    _client!.connect();
  }

  Future<void> stop() async {
    _epoch++;
    _currentUserId = null;
    WidgetsBinding.instance.removeObserver(this);
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _reconcileFuture = null;
    await _connectionSubscription?.cancel();
    await _notificationSubscription?.cancel();
    await _notificationReadSubscription?.cancel();
    await _notificationsReadAllSubscription?.cancel();
    _connectionSubscription = null;
    _notificationSubscription = null;
    _notificationReadSubscription = null;
    _notificationsReadAllSubscription = null;
    final client = _client;
    _client = null;
    _store?.resetSession();
    _store?.close();
    _store = null;
    await client?.close();
  }

  Future<void> close() async {
    await stop();
    await _notificationsController.close();
  }

  void onLifecycleStateChanged(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _currentUserId != null) {
      unawaited(_reconcile());
      reconcilePolls?.call();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) =>
      onLifecycleStateChanged(state);

  Future<void> _reconcile() {
    final existing = _reconcileFuture;
    if (existing != null) return existing;
    final epoch = _epoch;
    final store = _store;
    if (store == null) return Future<void>.value();
    final future = store.loadFirstPage().whenComplete(() {
      if (epoch == _epoch) _reconcileFuture = null;
    });
    _reconcileFuture = future;
    return future;
  }

  void _scheduleReconnect(int epoch) {
    if (epoch != _epoch || _reconnectTimer != null || _client == null) return;
    final exponent = math.min(_reconnectAttempt, 5);
    final raw = reconnectBaseDelay * (1 << exponent);
    final delay = raw > reconnectMaxDelay ? reconnectMaxDelay : raw;
    _reconnectAttempt++;
    final maxJitter = delay ~/ 4;
    final jitter = _jitter?.call(maxJitter) ??
        (maxJitter == Duration.zero
            ? Duration.zero
            : Duration(
                microseconds: _random.nextInt(maxJitter.inMicroseconds + 1)));
    _reconnectTimer = Timer(delay + jitter, () {
      _reconnectTimer = null;
      if (epoch == _epoch) _client?.connect();
    });
  }

  RealtimeClient _requireClient() =>
      _client ?? (throw StateError('RealtimeSession has not started'));

  NotificationStore _requireStore() =>
      _store ?? (throw StateError('RealtimeSession has not started'));
}

class NotificationItemEvent {
  const NotificationItemEvent(
      {required this.notification, required this.unreadCount});

  final NotificationItem notification;
  final int unreadCount;
}
