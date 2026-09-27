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
    required this.isMarkAllPending,
    required this.readAllError,
    required this.isInboxAtTop,
    this.error,
  });

  final Map<String, NotificationItem> itemsById;
  final List<String> ids;
  final String? nextCursor;
  final int unreadCount;
  final List<String> pendingIds;
  final Set<String> pendingReadIds;
  final int sessionEpoch;
  final bool isMarkAllPending;
  final Object? readAllError;
  final bool isInboxAtTop;
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
  final Set<String> _readAllPendingIds = {};
  Map<String, NotificationItem> _readAllRollback = {};
  var _hasReadAllRollback = false;
  var _readAllPreviousUnreadCount = 0;
  DateTime? _readAllOptimisticReadAt;
  var _readAllHasAuthoritativeCountUpdate = false;
  var _readAllConcurrentUnreadDelta = 0;
  int _unreadCount = 0;
  String? _nextCursor;
  Object? _error;
  Object? _readAllError;
  bool _isMarkAllPending = false;
  bool _isInboxAtTop = true;
  Future<void>? _loadMoreFuture;
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
        isMarkAllPending: _isMarkAllPending,
        readAllError: _readAllError,
        isInboxAtTop: _isInboxAtTop,
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
    if (_isMarkAllPending && unreadCount != null) {
      _readAllHasAuthoritativeCountUpdate = true;
    }
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
    if (_isMarkAllPending) _readAllHasAuthoritativeCountUpdate = true;
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

  void setInboxAtTop(bool atTop) {
    _isInboxAtTop = atTop;
  }

  void receiveNew(NotificationItem item, {bool? atTop, int? unreadCount}) {
    if (_itemsById.containsKey(item.id)) return;
    _itemsById[item.id] = item;
    if (atTop ?? _isInboxAtTop) {
      _sortIds();
    } else {
      _pendingIds.add(item.id);
    }
    if (unreadCount != null) {
      if (_isMarkAllPending) _readAllHasAuthoritativeCountUpdate = true;
      _unreadCount = unreadCount;
    } else if (item.isUnread) {
      _unreadCount++;
      if (_isMarkAllPending) _readAllConcurrentUnreadDelta++;
    }
    _notify();
  }

  void materializePending() {
    _pendingIds.clear();
    _sortIds();
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
    _readAllRollback = {};
    _hasReadAllRollback = true;
    _readAllPreviousUnreadCount = _unreadCount;
    _readAllOptimisticReadAt = readAt ?? DateTime.now().toUtc();
    _readAllHasAuthoritativeCountUpdate = false;
    _readAllConcurrentUnreadDelta = 0;
    _readAllPendingIds.clear();
    for (final entry in _itemsById.entries) {
      if (entry.value.isUnread) {
        _readAllRollback[entry.key] = entry.value;
        _itemsById[entry.key] =
            entry.value.copyWith(readAt: _readAllOptimisticReadAt);
        _readAllPendingIds.add(entry.key);
        _pendingReadIds.add(entry.key);
      }
    }
    _unreadCount = 0;
    _notify();
  }

  Future<void> markRead(String id) async {
    final item = _itemsById[id];
    if (item == null || !item.isUnread) return;
    final client = apiClient;
    final token = accessToken;
    if (client == null || token == null) {
      _error = StateError('Notification API is unavailable.');
      _notify();
      return;
    }

    final epoch = _sessionEpoch;
    markReadOptimistic(id);
    try {
      final response = await client.markReadTyped(accessToken: token, id: id);
      if (epoch != _sessionEpoch) return;
      _unreadCount = response.unreadCount;
      markReadConfirmed(id, readAt: response.readAt);
    } catch (error) {
      if (epoch != _sessionEpoch) return;
      rollbackRead(id);
      _error = error;
      _notify();
    }
  }

  Future<void> markAllRead() async {
    if (_isMarkAllPending) return;
    final client = apiClient;
    final token = accessToken;
    if (client == null || token == null) {
      _readAllError = StateError('Notification API is unavailable.');
      _notify();
      return;
    }

    final epoch = _sessionEpoch;
    final unreadIds = _itemsById.values
        .where((item) => item.isUnread)
        .map((item) => item.id)
        .toList();
    _readAllError = null;
    _isMarkAllPending = true;
    markAllReadOptimistic();
    try {
      final response = await client.markAllReadTyped(accessToken: token);
      if (epoch != _sessionEpoch) return;
      for (final id in unreadIds) {
        final item = _itemsById[id];
        if (item != null) {
          _itemsById[id] = item.copyWith(readAt: response.readAt);
        }
        _pendingReadIds.remove(id);
      }
      _readAllPendingIds.clear();
      _unreadCount = response.unreadCount;
      _readAllRollback = {};
      _hasReadAllRollback = false;
      _readAllPreviousUnreadCount = 0;
      _readAllOptimisticReadAt = null;
      _readAllHasAuthoritativeCountUpdate = false;
      _readAllConcurrentUnreadDelta = 0;
      _isMarkAllPending = false;
      _notify();
    } catch (error) {
      if (epoch != _sessionEpoch) return;
      rollbackReadAll();
      _isMarkAllPending = false;
      _readAllError = error;
      _notify();
    }
  }

  void rollbackReadAll() {
    if (!_hasReadAllRollback) return;
    for (final entry in _readAllRollback.entries) {
      final current = _itemsById[entry.key];
      if (current?.readAt == _readAllOptimisticReadAt) {
        _itemsById[entry.key] = entry.value;
      }
      _pendingReadIds.remove(entry.key);
    }
    _readAllPendingIds.clear();
    _unreadCount = _readAllHasAuthoritativeCountUpdate
        ? _unreadCount
        : _readAllPreviousUnreadCount + _readAllConcurrentUnreadDelta;
    _readAllRollback = {};
    _hasReadAllRollback = false;
    _readAllPreviousUnreadCount = 0;
    _readAllOptimisticReadAt = null;
    _readAllHasAuthoritativeCountUpdate = false;
    _readAllConcurrentUnreadDelta = 0;
    _notify();
  }

  void resetSession() {
    _itemsById.clear();
    _ids.clear();
    _pendingIds.clear();
    _pendingReadIds.clear();
    _readAllPendingIds.clear();
    _readAllRollback = {};
    _hasReadAllRollback = false;
    _readAllPreviousUnreadCount = 0;
    _readAllOptimisticReadAt = null;
    _readAllHasAuthoritativeCountUpdate = false;
    _readAllConcurrentUnreadDelta = 0;
    _nextCursor = null;
    _unreadCount = 0;
    _error = null;
    _readAllError = null;
    _isMarkAllPending = false;
    _isInboxAtTop = true;
    _loadMoreFuture = null;
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

  Future<void> loadNextPage() {
    final activeLoad = _loadMoreFuture;
    if (activeLoad != null) return activeLoad;
    final client = apiClient;
    final token = accessToken;
    final cursor = _nextCursor;
    if (client == null || token == null || cursor == null) {
      return Future<void>.value();
    }

    final epoch = _sessionEpoch;
    final future = () async {
      try {
        final page = await client.listTyped(accessToken: token, cursor: cursor);
        if (epoch != _sessionEpoch) return;
        mergePage(
          items: page.items,
          nextCursor: page.nextCursor,
          unreadCount: page.unreadCount,
        );
      } catch (error) {
        if (epoch != _sessionEpoch) return;
        _error = error;
        _notify();
      } finally {
        if (epoch == _sessionEpoch) _loadMoreFuture = null;
      }
    }();
    _loadMoreFuture = future;
    return future;
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
      ..addAll(_itemsById.keys.where((id) => !_pendingIds.contains(id)));
    _ids.sort((a, b) {
      final byDate =
          _itemsById[b]!.createdAt.compareTo(_itemsById[a]!.createdAt);
      return byDate != 0 ? byDate : b.compareTo(a);
    });
  }
}
