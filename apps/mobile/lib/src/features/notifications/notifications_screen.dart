import 'dart:async';

import 'package:flutter/material.dart';

import '../auth/auth_session.dart';
import '../../core/widgets/user_avatar.dart';
import '../realtime/realtime_client.dart';
import 'notifications_api_client.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen(
      {required this.session,
      this.isActive = false,
      this.apiClient,
      this.realtimeClient,
      this.onUnreadCountChanged,
      super.key});
  final AuthSession session;
  final bool isActive;
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
    if (widget.isActive) {
      unawaited(_load());
    }
  }

  @override
  void didUpdateWidget(covariant NotificationsScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (shouldLoadNotifications(
        isActive: widget.isActive, wasActive: oldWidget.isActive)) {
      unawaited(_load());
    }
  }

  @override
  void dispose() {
    unawaited(_realtimeSubscription?.cancel());
    if (_ownsRealtimeClient) unawaited(_realtimeClient.close());
    if (_ownsApiClient) _apiClient.close();
    super.dispose();
  }

  Future<void> _load({bool append = false}) async {
    if (append && _loadingMore) return;
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
      if (!widget.isActive) return;
      widget.onUnreadCountChanged?.call(page.unreadCount);
      if (!append && page.unreadCount > 0) {
        await _markAllRead();
      }
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

  Future<void> _openDetails(NotificationSummary item) async {
    await _markRead(item);
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) => Padding(
        padding: const EdgeInsets.fromLTRB(24, 4, 24, 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                UserAvatar(
                  displayName: item.actor?.displayName ?? 'Someone',
                  username: item.actor?.username ?? 'unknown',
                  imageUrl: item.actor?.avatarUrl,
                  radius: 24,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(item.title,
                      style: Theme.of(context).textTheme.titleMedium),
                ),
              ],
            ),
            const SizedBox(height: 20),
            Text(item.detail),
            const SizedBox(height: 12),
            _DetailRow(label: 'Type', value: _typeLabel(item.type)),
            _DetailRow(label: 'Related to', value: item.targetLabel),
            _DetailRow(label: 'Created', value: _dateTime(item.createdAt)),
            if (!item.isTargetAvailable)
              const Padding(
                padding: EdgeInsets.only(top: 12),
                child: Text('The related content is no longer available.'),
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _ErrorState(onRetry: _load)
              : _items.isEmpty
                  ? const Center(child: Text('No notifications yet'))
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: NotificationListener<ScrollNotification>(
                        onNotification: (notification) {
                          if (notification.metrics.extentAfter < 240 &&
                              _nextCursor != null &&
                              !_loadingMore) {
                            unawaited(_load(append: true));
                          }
                          return false;
                        },
                        child: ListView(
                          padding: const EdgeInsets.only(bottom: 24),
                          children: [
                            if (_items.any((item) => item.isUnread))
                              _NotificationSection(
                                title: 'New',
                                items: _items
                                    .where((item) => item.isUnread)
                                    .toList(),
                                onTap: _openDetails,
                              ),
                            if (_items.any((item) => !item.isUnread))
                              _NotificationSection(
                                title: 'Earlier',
                                items: _items
                                    .where((item) => !item.isUnread)
                                    .toList(),
                                onTap: _openDetails,
                              ),
                            if (_loadingMore)
                              const Padding(
                                padding: EdgeInsets.all(24),
                                child:
                                    Center(child: CircularProgressIndicator()),
                              ),
                          ],
                        ),
                      ),
                    ),
    );
  }
}

bool shouldLoadNotifications(
        {required bool isActive, required bool wasActive}) =>
    isActive && !wasActive;

class _NotificationSection extends StatelessWidget {
  const _NotificationSection({
    required this.title,
    required this.items,
    required this.onTap,
  });

  final String title;
  final List<NotificationSummary> items;
  final ValueChanged<NotificationSummary> onTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
          child: Text(title,
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                  )),
        ),
        ...items.map((item) => _NotificationTile(
              item: item,
              onTap: () => onTap(item),
            )),
      ],
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
    return ListTile(
        onTap: onTap,
        tileColor: item.isUnread ? const Color(0xFFF4F6FF) : null,
        contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 6),
        leading: UserAvatar(
          displayName: actor,
          username: item.actor?.username ?? 'unknown',
          imageUrl: item.actor?.avatarUrl,
          radius: 22,
        ),
        title: Text(item.title,
            style: TextStyle(
                fontWeight: item.isUnread ? FontWeight.w700 : FontWeight.w500)),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text('${item.detail} · ${_time(item.createdAt)}'),
        ),
        trailing: item.isUnread
            ? const Icon(Icons.circle, size: 10, color: Color(0xFF566A9D))
            : null);
  }

  String _time(DateTime value) =>
      '${value.day.toString().padLeft(2, '0')}.${value.month.toString().padLeft(2, '0')}.${value.year}';
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(width: 92, child: Text(label)),
            Expanded(child: Text(value)),
          ],
        ),
      );
}

String _typeLabel(String type) => switch (type) {
      'poll_vote' => 'Poll vote',
      'comment' => 'Comment',
      'comment_reply' => 'Comment reply',
      'follow' => 'New follower',
      'like' => 'Like',
      _ => 'Activity',
    };

String _dateTime(DateTime value) =>
    '${value.day.toString().padLeft(2, '0')}.${value.month.toString().padLeft(2, '0')}.${value.year} '
    '${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';

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
