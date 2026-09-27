import 'dart:async';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:yaskapp_mobile/src/core/config/api_config.dart';
import 'package:yaskapp_mobile/src/features/notifications/notification_model.dart';
import 'package:yaskapp_mobile/src/features/notifications/notification_store.dart';
import 'package:yaskapp_mobile/src/features/notifications/notifications_api_client.dart';

NotificationItem _item(String id, String createdAt, {String? readAt}) =>
    NotificationItem(
      id: id,
      type: NotificationType.comment,
      actor: const NotificationActor(
        id: 'actor-1',
        username: 'alice',
        displayName: 'Alice',
      ),
      target: const NotificationTarget(
        type: NotificationTargetType.comment,
        pollId: 'poll-1',
        commentId: 'comment-1',
      ),
      payload: const <String, dynamic>{},
      readAt: readAt == null ? null : DateTime.parse(readAt),
      createdAt: DateTime.parse(createdAt),
      isTargetAvailable: true,
    );

void main() {
  test('merges, deduplicates, orders items, and preserves cursor', () {
    final store = NotificationStore();
    store.mergePage(
      items: [
        _item('old', '2026-09-18T12:00:00Z'),
        _item('new', '2026-09-19T12:00:00Z')
      ],
      nextCursor: 'cursor-1',
      unreadCount: 2,
    );
    store.mergePage(
      items: [
        _item('new', '2026-09-19T12:00:00Z', readAt: '2026-09-19T13:00:00Z')
      ],
      nextCursor: null,
      unreadCount: 1,
    );

    expect(store.state.ids, ['new', 'old']);
    expect(store.state.itemsById['new']!.isUnread, isFalse);
    expect(store.state.nextCursor, isNull);
    expect(store.state.unreadCount, 1);
  });

  test('optimistic read and read-all can roll back', () {
    final store = NotificationStore();
    store.mergePage(items: [
      _item('one', '2026-09-19T12:00:00Z'),
      _item('two', '2026-09-19T11:00:00Z')
    ], unreadCount: 2);
    store.markReadOptimistic('one');
    expect(store.state.itemsById['one']!.isUnread, isFalse);
    store.rollbackRead('one');
    expect(store.state.itemsById['one']!.isUnread, isTrue);

    store.markAllReadOptimistic();
    expect(store.state.unreadCount, 0);
    store.rollbackReadAll();
    expect(store.state.unreadCount, 2);
  });

  test('holds new items as pending and resets the session', () {
    final store = NotificationStore();
    store.mergePage(
        items: [_item('one', '2026-09-19T12:00:00Z')], unreadCount: 1);
    store.setInboxAtTop(false);
    store.receiveNew(_item('two', '2026-09-19T13:00:00Z'));
    expect(store.state.pendingIds, ['two']);
    store.materializePending();
    expect(store.state.ids, ['two', 'one']);
    store.resetSession();
    expect(store.state.ids, isEmpty);
    expect(store.state.sessionEpoch, 1);
  });

  test('inserts a new notification immediately while the inbox is at top', () {
    final store = NotificationStore();
    store.mergePage(items: [_item('older', '2026-09-19T12:00:00Z')]);

    store.receiveNew(_item('newer', '2026-09-19T13:00:00Z'));

    expect(store.state.pendingIds, isEmpty);
    expect(store.state.ids.first, 'newer');
  });

  test('reconciliation does not materialize items pending below the top', () {
    final store = NotificationStore();
    final older = _item('older', '2026-09-19T12:00:00Z');
    final newer = _item('newer', '2026-09-19T13:00:00Z');
    store.mergePage(items: [older], unreadCount: 1);
    store.setInboxAtTop(false);
    store.receiveNew(newer);

    store.reconcile(
      items: [newer, older],
      nextCursor: 'next',
      unreadCount: 2,
    );

    expect(store.state.ids, ['older']);
    expect(store.state.pendingIds, ['newer']);
    store.materializePending();
    expect(store.state.ids, ['newer', 'older']);
  });

  test(
      'read-all failure restores authoritative unread count without loaded items',
      () async {
    final store = NotificationStore(
      apiClient: NotificationsApiClient(
        config: const ApiConfig(baseUrl: 'http://test'),
        httpClient: MockClient((_) async => http.Response(
              '{"message":"offline"}',
              503,
            )),
      ),
      accessToken: 'token',
    );
    store.mergePage(items: const [], unreadCount: 3);

    await store.markAllRead();

    expect(store.state.unreadCount, 3);
    expect(store.state.readAllError, isNotNull);
    store.close();
  });

  test('read-all rollback preserves realtime and paginated arrivals', () async {
    final readAll = Completer<http.Response>();
    final store = NotificationStore(
      apiClient: NotificationsApiClient(
        config: const ApiConfig(baseUrl: 'http://test'),
        httpClient: MockClient((request) async {
          if (request.url.path.endsWith('/read-all')) return readAll.future;
          return http.Response('{}', 200);
        }),
      ),
      accessToken: 'token',
    );
    store.mergePage(
      items: [_item('original', '2026-09-19T12:00:00Z')],
      unreadCount: 1,
    );
    store.setInboxAtTop(false);

    final request = store.markAllRead();
    expect(store.state.itemsById['original']!.isUnread, isFalse);

    store.receiveNew(
      _item('realtime', '2026-09-19T13:00:00Z'),
      unreadCount: 2,
    );
    store.mergePage(
      items: [_item('page-arrival', '2026-09-19T11:00:00Z')],
      nextCursor: 'cursor-2',
      unreadCount: 3,
    );
    readAll.complete(http.Response('{"message":"offline"}', 503));
    await request;

    expect(store.state.itemsById.keys,
        containsAll(['original', 'realtime', 'page-arrival']));
    expect(store.state.ids, containsAll(['original', 'page-arrival']));
    expect(store.state.pendingIds, ['realtime']);
    expect(store.state.itemsById['original']!.isUnread, isTrue);
    expect(store.state.unreadCount, 3);
    expect(store.state.pendingReadIds, isEmpty);
    store.close();
  });

  test('reconcile replaces authoritative fields without dropping history', () {
    final store = NotificationStore();
    store.mergePage(
        items: [_item('history', '2026-09-17T12:00:00Z')], unreadCount: 1);
    store.reconcilePage(
      items: [
        _item('history', '2026-09-17T12:00:00Z', readAt: '2026-09-19T14:00:00Z')
      ],
      nextCursor: 'next',
      unreadCount: 0,
    );
    expect(store.state.ids, ['history']);
    expect(store.state.itemsById['history']!.isUnread, isFalse);
    expect(store.state.nextCursor, 'next');
    expect(store.state.unreadCount, 0);
  });

  test('applies remote read events without overwriting newer unread notifications', () {
    final store = NotificationStore();
    final older = _item('older', '2026-09-19T12:00:00Z');
    final newer = _item('newer', '2026-09-19T12:20:00Z');
    store.mergePage(items: [older, newer], unreadCount: 2);

    store.applyRemoteRead(
      notificationId: older.id,
      readAt: DateTime.parse('2026-09-19T12:10:00Z'),
      unreadCount: 0,
    );

    expect(store.state.itemsById[older.id]!.isUnread, isFalse);
    expect(store.state.itemsById[newer.id]!.isUnread, isTrue);
    expect(store.state.unreadCount, 1);
  });

  test('applies remote read-all only to notifications created by that mutation time', () {
    final store = NotificationStore();
    final older = _item('older', '2026-09-19T12:00:00Z');
    final newer = _item('newer', '2026-09-19T12:20:00Z');
    store.mergePage(items: [older, newer], unreadCount: 2);

    store.applyRemoteReadAll(
      readAt: DateTime.parse('2026-09-19T12:10:00Z'),
      unreadCount: 0,
    );

    expect(store.state.itemsById[older.id]!.isUnread, isFalse);
    expect(store.state.itemsById[newer.id]!.isUnread, isTrue);
    expect(store.state.unreadCount, 1);
  });
}
