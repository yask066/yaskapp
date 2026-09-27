import 'dart:collection';

import 'notification_model.dart';
import 'notifications_api_client.dart';

class NotificationStoreState {
  const NotificationStoreState({
    required this.itemsById,
    required this.ids,
    required this.nextCursor,
    required this.unreadCount,
    required this.pendingIds,
    required this.pendingReadIds,
    required this.sessionEpoch,
    this.error,
  });

  final Map<String, NotificationItem> itemsById;
  final List<String> ids;
  final String? nextCursor;
  final int unreadCount;
  final List<String> pendingIds;
  final Set<String> pendingReadIds;
  final int sessionEpoch;
  final Object? error;
}

class NotificationStore {
  NotificationStore({this.apiClient, this.accessToken});

  final NotificationsApiClient? apiClient;
  final String? accessToken;
  final Map<String, NotificationItem> _itemsById = {};
  final List<String> _ids = [];
  final List<String> _pendingIds = [];
  final Set<String> _pendingReadIds = {};
  Map<String, NotificationItem> _readAllRollback = {};
  int _unreadCount = 0;
  String? _nextCursor;
  Object? _error;
  int _sessionEpoch = 0;
  final List<void Function()> _listeners = [];

  void close() {
    apiClient?.close();
    _listeners.clear();
  }

  NotificationStoreState get state => NotificationStoreState(
        itemsById: UnmodifiableMapView(Map.of(_itemsById)),
        ids: List.unmodifiable(_ids),
        nextCursor: _nextCursor,
        unreadCount: _unreadCount,
        pendingIds: List.unmodifiable(_pendingIds),
        pendingReadIds: Set.unmodifiable(_pendingReadIds),
        sessionEpoch: _sessionEpoch,
        error: _error,
      );

  void addListener(void Function() listener) => _listeners.add(listener);
  void removeListener(void Function() listener) => _listeners.remove(listener);
  void _notify() {
    for (final listener in List.of(_listeners)) {
      listener();
    }
  }

  void mergePage({
    required List<NotificationItem> items,
    String? nextCursor,
    int? unreadCount,
  }) {
    for (final item in items) {
      _itemsById[item.id] = item;
    }
    _sortIds();
    _nextCursor = nextCursor;
    if (unreadCount != null) _unreadCount = unreadCount;
    _error = null;
    _notify();
  }

  void reconcilePage({
    required List<NotificationItem> items,
    String? nextCursor,
    required int unreadCount,
  }) {
    for (final item in items) {
      _itemsById[item.id] = item;
    }
    _sortIds();
    _nextCursor = nextCursor;
    _unreadCount = unreadCount;
    _error = null;
    _notify();
  }

  /// Applies the authoritative first page while retaining older history.
  void reconcile({
    required List<NotificationItem> items,
    String? nextCursor,
    required int unreadCount,
  }) {
    reconcilePage(
      items: items,
      nextCursor: nextCursor,
      unreadCount: unreadCount,
    );
  }

  void receiveNew(NotificationItem item, {bool atTop = false, int? unreadCount}) {
    if (_itemsById.containsKey(item.id)) return;
    _itemsById[item.id] = item;
    if (atTop) {
      _sortIds();
    } else {
      _pendingIds.add(item.id);
    }
    if (unreadCount != null) {
      _unreadCount = unreadCount;
    } else if (item.isUnread) {
      _unreadCount++;
    }
    _notify();
  }

  void materializePending() {
    _sortIds();
    _pendingIds.clear();
    _notify();
  }

  void markReadOptimistic(String id, {DateTime? readAt}) {
    final item = _itemsById[id];
    if (item == null || !item.isUnread) return;
    _itemsById[id] = item.copyWith(readAt: readAt ?? DateTime.now().toUtc());
    _pendingReadIds.add(id);
    if (_unreadCount > 0) _unreadCount--;
    _notify();
  }

  void rollbackRead(String id) {
    final item = _itemsById[id];
    if (item == null || !_pendingReadIds.remove(id)) return;
    _itemsById[id] = item.copyWith(clearReadAt: true);
    _unreadCount++;
    _notify();
  }

  void markReadConfirmed(String id, {DateTime? readAt}) {
    final item = _itemsById[id];
    if (item == null) return;
    _itemsById[id] = item.copyWith(readAt: readAt ?? item.readAt);
    _pendingReadIds.remove(id);
    _notify();
  }

  void markAllReadOptimistic({DateTime? readAt}) {
    _readAllRollback = Map.of(_itemsById);
    final timestamp = readAt ?? DateTime.now().toUtc();
    for (final entry in _itemsById.entries) {
      if (entry.value.isUnread) {
        _itemsById[entry.key] = entry.value.copyWith(readAt: timestamp);
      }
    }
    _pendingReadIds.addAll(_itemsById.keys);
    _unreadCount = 0;
    _notify();
  }

  void rollbackReadAll() {
    if (_readAllRollback.isEmpty) return;
    _itemsById
      ..clear()
      ..addAll(_readAllRollback);
    _pendingReadIds.clear();
    _unreadCount = _itemsById.values.where((item) => item.isUnread).length;
    _readAllRollback = {};
    _notify();
  }

  void resetSession() {
    _itemsById.clear();
    _ids.clear();
    _pendingIds.clear();
    _pendingReadIds.clear();
    _readAllRollback = {};
    _nextCursor = null;
    _unreadCount = 0;
    _error = null;
    _sessionEpoch++;
    _notify();
  }

  Future<void> loadFirstPage() async {
    final client = apiClient;
    final token = accessToken;
    if (client == null || token == null) return;
    final epoch = _sessionEpoch;
    try {
      final page = await client.listTyped(accessToken: token);
      if (epoch != _sessionEpoch) return;
      mergePage(
        items: page.items,
        nextCursor: page.nextCursor,
        unreadCount: page.unreadCount,
      );
    } catch (error) {
      if (epoch == _sessionEpoch) {
        _error = error;
        _notify();
      }
    }
  }

  Future<int?> loadUnreadCount() async {
    final client = apiClient;
    final token = accessToken;
    if (client == null || token == null) return null;
    final epoch = _sessionEpoch;
    final count = await client.unreadCount(accessToken: token);
    if (epoch == _sessionEpoch) {
      _unreadCount = count;
      _notify();
    }
    return count;
  }

  void _sortIds() {
    _ids
      ..clear()
      ..addAll(_itemsById.keys);
    _ids.sort((a, b) {
      final byDate = _itemsById[b]!.createdAt.compareTo(_itemsById[a]!.createdAt);
      return byDate != 0 ? byDate : b.compareTo(a);
    });
  }

}
