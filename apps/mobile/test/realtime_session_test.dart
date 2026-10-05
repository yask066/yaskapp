import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/features/auth/auth_session.dart';
import 'package:yaskapp_mobile/src/features/notifications/notification_model.dart';
import 'package:yaskapp_mobile/src/features/notifications/notification_store.dart';
import 'package:yaskapp_mobile/src/features/realtime/realtime_client.dart';
import 'package:yaskapp_mobile/src/features/realtime/realtime_session.dart';

class _FakeRealtimeClient extends RealtimeClient {
  _FakeRealtimeClient() : super(accessToken: 'token');

  var connectCalls = 0;
  var closeCalls = 0;

  @override
  void connect() => connectCalls++;

  @override
  Future<void> close() async => closeCalls++;

  void ready() => emitConnectionEvent(RealtimeConnectionEvent.ready);
  void disconnected() =>
      emitConnectionEvent(RealtimeConnectionEvent.disconnected);
  void notificationRead(NotificationReadRealtimeEvent event) =>
      emitNotificationReadEvent(event);
  void emitReadAll(NotificationsReadAllRealtimeEvent event) =>
      emitNotificationsReadAllEvent(event);
}

class _FakeStore extends NotificationStore {
  var reconcileCalls = 0;
  final Completer<void> reconcileGate = Completer<void>();

  @override
  Future<void> loadFirstPage() async {
    reconcileCalls++;
    await reconcileGate.future;
  }
}

const _session = AuthSession(
  user: AuthUser(
    id: 'user-1',
    email: 'user@example.com',
    username: 'user',
    status: 'active',
    profile: AuthUserProfile(
      displayName: 'User',
      pollsCount: 0,
      followersCount: 0,
      followingCount: 0,
    ),
  ),
  accessToken: 'token',
  tokenType: 'Bearer',
  expiresIn: '1h',
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('starts exactly one connection and reconciles once on ready', () async {
    final client = _FakeRealtimeClient();
    final store = _FakeStore();
    final session = RealtimeSession(
      clientFactory: (_) => client,
      storeFactory: (_) => store,
      reconnectBaseDelay: Duration.zero,
      jitter: (_) => Duration.zero,
    );

    await session.start(_session);
    session.start(_session);
    client.ready();
    client.ready();
    await Future<void>.delayed(const Duration(milliseconds: 10));

    expect(client.connectCalls, 1);
    expect(store.reconcileCalls, 1);
  });

  test('reconnects after disconnect without parallel reconnects', () async {
    final clients = <_FakeRealtimeClient>[];
    final session = RealtimeSession(
      clientFactory: (_) {
        final client = _FakeRealtimeClient();
        clients.add(client);
        return client;
      },
      storeFactory: (_) => _FakeStore()..reconcileGate.complete(),
      reconnectBaseDelay: Duration.zero,
      jitter: (_) => Duration.zero,
    );

    await session.start(_session);
    clients.single.disconnected();
    clients.single.disconnected();
    await Future<void>.delayed(const Duration(milliseconds: 10));

    expect(clients, hasLength(1));
    expect(clients.single.connectCalls, 2);
  });

  test(
      'resume reconciliation is single-flight and logout invalidates old callbacks',
      () async {
    final client = _FakeRealtimeClient();
    final store = _FakeStore();
    var pollReconciliations = 0;
    final session = RealtimeSession(
      clientFactory: (_) => client,
      storeFactory: (_) => store,
      reconcilePolls: () => pollReconciliations++,
    );

    await session.start(_session);
    session.onLifecycleStateChanged(AppLifecycleState.resumed);
    session.onLifecycleStateChanged(AppLifecycleState.resumed);
    expect(store.reconcileCalls, 1);
    expect(pollReconciliations, 2);

    await session.stop();
    store.reconcileGate.complete();
    await Future<void>.delayed(Duration.zero);

    expect(client.closeCalls, 1);
    expect(session.currentUserId, isNull);
    expect(store.reconcileCalls, 1);
    expect(pollReconciliations, 2);
  });

  test('existing realtime ready event reconciles loaded Poll state', () async {
    final client = _FakeRealtimeClient();
    final store = _FakeStore()..reconcileGate.complete();
    var pollReconciliations = 0;
    final session = RealtimeSession(
      clientFactory: (_) => client,
      storeFactory: (_) => store,
      reconcilePolls: () => pollReconciliations++,
    );

    await session.start(_session);
    client.ready();
    await Future<void>.delayed(Duration.zero);

    expect(pollReconciliations, 1);
    await session.close();
  });

  test(
      'applies remote read and read-all events to the active notification store',
      () async {
    final client = _FakeRealtimeClient();
    final store = NotificationStore();
    final older = NotificationItem(
      id: 'notification-1',
      type: NotificationType.follow,
      actor: null,
      target: const NotificationTarget(type: NotificationTargetType.profile),
      payload: const {},
      readAt: null,
      createdAt: DateTime.parse('2026-09-19T12:00:00Z'),
      isTargetAvailable: true,
    );
    final newer = NotificationItem(
      id: 'notification-2',
      type: NotificationType.follow,
      actor: null,
      target: const NotificationTarget(type: NotificationTargetType.profile),
      payload: const {},
      readAt: null,
      createdAt: DateTime.parse('2026-09-19T13:00:00Z'),
      isTargetAvailable: true,
    );
    store.mergePage(items: [older, newer], unreadCount: 2);
    final session = RealtimeSession(
      clientFactory: (_) => client,
      storeFactory: (_) => store,
    );

    await session.start(_session);
    client.notificationRead(NotificationReadRealtimeEvent(
      notificationId: older.id,
      readAt: DateTime.parse('2026-09-19T12:30:00Z'),
      unreadCount: 1,
    ));
    await Future<void>.delayed(Duration.zero);

    expect(store.state.itemsById[older.id]!.isUnread, isFalse);
    expect(store.state.itemsById[newer.id]!.isUnread, isTrue);
    expect(store.state.unreadCount, 1);

    client.emitReadAll(NotificationsReadAllRealtimeEvent(
      readAt: DateTime.parse('2026-09-19T13:30:00Z'),
      unreadCount: 0,
    ));
    await Future<void>.delayed(Duration.zero);

    expect(store.state.itemsById[older.id]!.isUnread, isFalse);
    expect(store.state.itemsById[newer.id]!.isUnread, isFalse);
    expect(store.state.unreadCount, 0);
    await session.close();
  });
}
