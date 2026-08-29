import 'dart:async';

import 'package:flutter/material.dart';

import '../auth/auth_session.dart';
import '../realtime/realtime_client.dart';
import 'notifications_api_client.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen(
      {required this.session,
      this.apiClient,
      this.realtimeClient,
      this.onUnreadCountChanged,
      super.key});
  final AuthSession session;
  final NotificationsApiClient? apiClient;
  final RealtimeClient? realtimeClient;
  final ValueChanged<int>? onUnreadCountChanged;
  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  late final NotificationsApiClient _apiClient;
  late final RealtimeClient _realtimeClient;
  late final bool _ownsApiClient;
  late final bool _ownsRealtimeClient;
  final _items = <NotificationSummary>[];
  String? _nextCursor;
  Object? _error;
  bool _loading = true;
  bool _loadingMore = false;
  StreamSubscription<NotificationRealtimeEvent>? _realtimeSubscription;

  @override
  void initState() {
    super.initState();
    _ownsApiClient = widget.apiClient == null;
    _apiClient = widget.apiClient ?? NotificationsApiClient();
    _ownsRealtimeClient = widget.realtimeClient == null;
    _realtimeClient = widget.realtimeClient ??
        RealtimeClient(accessToken: widget.session.accessToken);
    _realtimeSubscription =
        _realtimeClient.notifications.listen(_handleRealtimeNotification);
    _realtimeClient.connect();
    unawaited(_load());
  }

  @override
  void dispose() {
    unawaited(_realtimeSubscription?.cancel());
    if (_ownsRealtimeClient) unawaited(_realtimeClient.close());
    if (_ownsApiClient) _apiClient.close();
    super.dispose();
  }

  Future<void> _load({bool append = false}) async {
    if (append ? _loadingMore : _loading) return;
    setState(() {
      if (append)
        _loadingMore = true;
      else {
        _loading = true;
        _error = null;
      }
    });
    try {
      final page = await _apiClient.list(
          accessToken: widget.session.accessToken,
          cursor: append ? _nextCursor : null);
      if (!mounted) return;
      setState(() {
        if (!append) _items.clear();
        final ids = _items.map((item) => item.id).toSet();
        _items.addAll(page.items.where((item) => ids.add(item.id)));
        _nextCursor = page.nextCursor;
        _loading = false;
        _loadingMore = false;
      });
      widget.onUnreadCountChanged?.call(page.unreadCount);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _loadingMore = false;
        _error = error;
      });
    }
  }

  void _handleRealtimeNotification(NotificationRealtimeEvent event) {
    final item = NotificationSummary.fromJson(event.payload);
    if (_items.every((existing) => existing.id != item.id))
      setState(() => _items.insert(0, item));
    widget.onUnreadCountChanged?.call(event.unreadCount);
  }

  Future<void> _markRead(NotificationSummary item) async {
    if (!item.isUnread) return;
    try {
      await _apiClient.markRead(
          accessToken: widget.session.accessToken, id: item.id);
      if (!mounted) return;
      setState(() {
        final index = _items.indexWhere((candidate) => candidate.id == item.id);
        if (index >= 0)
          _items[index] = NotificationSummary(
              id: item.id,
              type: item.type,
              actor: item.actor,
              pollId: item.pollId,
              commentId: item.commentId,
              readAt: DateTime.now(),
              createdAt: item.createdAt,
              isTargetAvailable: item.isTargetAvailable);
      });
      widget.onUnreadCountChanged
          ?.call(_items.where((candidate) => candidate.isUnread).length);
    } catch (_) {}
  }

  Future<void> _markAllRead() async {
    try {
      final count =
          await _apiClient.markAllRead(accessToken: widget.session.accessToken);
      if (!mounted) return;
      setState(() {
        for (var i = 0; i < _items.length; i++) {
          final item = _items[i];
          _items[i] = NotificationSummary(
              id: item.id,
              type: item.type,
              actor: item.actor,
              pollId: item.pollId,
              commentId: item.commentId,
              readAt: item.readAt ?? DateTime.now(),
              createdAt: item.createdAt,
              isTargetAvailable: item.isTargetAvailable);
        }
      });
      widget.onUnreadCountChanged?.call(count);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications'), actions: [
        TextButton(
            onPressed:
                _items.any((item) => item.isUnread) ? _markAllRead : null,
            child: const Text('Mark all read'))
      ]),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _ErrorState(onRetry: _load)
              : _items.isEmpty
                  ? const Center(child: Text('No notifications yet'))
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.builder(
                          itemCount:
                              _items.length + (_nextCursor == null ? 0 : 1),
                          itemBuilder: (context, index) {
                            if (index == _items.length) {
                              if (!_loadingMore) unawaited(_load(append: true));
                              return const Padding(
                                  padding: EdgeInsets.all(24),
                                  child: Center(
                                      child: CircularProgressIndicator()));
                            }
                            final item = _items[index];
                            return _NotificationTile(
                                item: item, onTap: () => _markRead(item));
                          })),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile({required this.item, required this.onTap});
  final NotificationSummary item;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final actor = item.actor?.displayName ?? 'Someone';
    final text = switch (item.type) {
      'poll_vote' => '$actor voted in your poll',
      'comment' => '$actor commented on your poll',
      'follow' => '$actor started following you',
      'like' => '$actor liked your poll',
      _ => 'You have a new notification'
    };
    return ListTile(
        onTap: onTap,
        tileColor: item.isUnread ? const Color(0xFFF4F6FF) : null,
        leading: CircleAvatar(
            child: Text(actor.isEmpty ? '?' : actor[0].toUpperCase())),
        title: Text(text),
        subtitle: Text(item.isTargetAvailable
            ? _time(item.createdAt)
            : 'Content unavailable'),
        trailing: item.isUnread
            ? const Icon(Icons.circle, size: 10, color: Color(0xFF566A9D))
            : null);
  }

  String _time(DateTime value) =>
      '${value.day.toString().padLeft(2, '0')}.${value.month.toString().padLeft(2, '0')}.${value.year}';
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.onRetry});
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Text('Could not load notifications'),
        const SizedBox(height: 12),
        FilledButton(onPressed: onRetry, child: const Text('Retry'))
      ]));
}
