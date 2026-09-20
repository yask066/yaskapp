import 'package:flutter_test/flutter_test.dart';

import 'package:yaskapp_mobile/src/features/notifications/notification_model.dart';
import 'package:yaskapp_mobile/src/features/notifications/notification_store.dart';

NotificationItem _item(String id, String createdAt, {String? readAt}) =>
    NotificationItem(
      id: id,
      type: NotificationType.comment,
      actor: const NotificationActor(
        id: 'actor-1', username: 'alice', displayName: 'Alice',
      ),
      target: const NotificationTarget(
        type: NotificationTargetType.comment, pollId: 'poll-1', commentId: 'comment-1',
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
      items: [_item('old', '2026-09-18T12:00:00Z'), _item('new', '2026-09-19T12:00:00Z')],
      nextCursor: 'cursor-1',
      unreadCount: 2,
    );
    store.mergePage(
      items: [_item('new', '2026-09-19T12:00:00Z', readAt: '2026-09-19T13:00:00Z')],
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
    store.mergePage(items: [_item('one', '2026-09-19T12:00:00Z'), _item('two', '2026-09-19T11:00:00Z')], unreadCount: 2);
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
    store.mergePage(items: [_item('one', '2026-09-19T12:00:00Z')], unreadCount: 1);
    store.receiveNew(_item('two', '2026-09-19T13:00:00Z'));
    expect(store.state.pendingIds, ['two']);
    store.materializePending();
    expect(store.state.ids, ['two', 'one']);
    store.resetSession();
    expect(store.state.ids, isEmpty);
    expect(store.state.sessionEpoch, 1);
  });

  test('reconcile replaces authoritative fields without dropping history', () {
    final store = NotificationStore();
    store.mergePage(items: [_item('history', '2026-09-17T12:00:00Z')], unreadCount: 1);
    store.reconcilePage(
      items: [_item('history', '2026-09-17T12:00:00Z', readAt: '2026-09-19T14:00:00Z')],
      nextCursor: 'next',
      unreadCount: 0,
    );
    expect(store.state.ids, ['history']);
    expect(store.state.itemsById['history']!.isUnread, isFalse);
    expect(store.state.nextCursor, 'next');
    expect(store.state.unreadCount, 0);
  });
}
