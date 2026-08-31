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
      backgroundColor: const Color(0xFFF7F8FC),
      body: SafeArea(
        bottom: false,
        child: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _ErrorState(onRetry: _load)
              : _items.isEmpty
                  ? const _EmptyState()
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
                          padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
                          children: [
                            _NotificationsHeader(onMarkAllRead: _markAllRead),
                            const SizedBox(height: 28),
                            for (final section in _groupedSections()) ...[
                              _NotificationSection(
                                title: section.$1,
                                items: section.$2,
                                onTap: _openDetails,
                              ),
                              const SizedBox(height: 24),
                            ],
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
      ),
    );
  }

  List<(String, List<NotificationSummary>)> _groupedSections() {
    final now = DateTime.now();
    final today = <NotificationSummary>[];
    final yesterday = <NotificationSummary>[];
    final earlier = <NotificationSummary>[];
    for (final item in _items) {
      final date = item.createdAt;
      final difference = DateTime(now.year, now.month, now.day)
          .difference(DateTime(date.year, date.month, date.day))
          .inDays;
      if (difference == 0) {
        today.add(item);
      } else if (difference == 1) {
        yesterday.add(item);
      } else {
        earlier.add(item);
      }
    }
    return [
      if (today.isNotEmpty) ('Today', today),
      if (yesterday.isNotEmpty) ('Yesterday', yesterday),
      if (earlier.isNotEmpty) ('Earlier', earlier),
    ];
  }
}

bool shouldLoadNotifications(
        {required bool isActive, required bool wasActive}) =>
    isActive && !wasActive;

String notificationAgeLabel(DateTime value, {DateTime? now}) {
  final seconds = (now ?? DateTime.now()).difference(value).inSeconds;
  final ageInSeconds = seconds < 0 ? 0 : seconds;

  if (ageInSeconds < 60) {
    return _ageLabel(ageInSeconds, 'second');
  }

  final minutes = ageInSeconds ~/ 60;
  if (minutes < 60) {
    return _ageLabel(minutes, 'minute');
  }

  final hours = minutes ~/ 60;
  if (hours < 24) {
    return _ageLabel(hours, 'hour');
  }

  final days = hours ~/ 24;
  if (days < 7) {
    return _ageLabel(days, 'day');
  }

  if (days < 30) {
    return _ageLabel(days ~/ 7, 'week');
  }

  if (days < 365) {
    return _ageLabel(days ~/ 30, 'month');
  }

  return _ageLabel(days ~/ 365, 'year');
}

String _ageLabel(int value, String unit) =>
    '$value $unit${value == 1 ? '' : 's'} ago';

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
          padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
          child: Text(title,
              style: const TextStyle(
                color: Color(0xFF344054),
                fontSize: 17,
                fontWeight: FontWeight.w700,
              )),
        ),
        Container(
          decoration: BoxDecoration(
            color: Colors.white,
            border: Border.all(color: const Color(0xFFE5E7EB)),
            borderRadius: BorderRadius.circular(16),
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: [
              for (var index = 0; index < items.length; index++) ...[
                _NotificationTile(item: items[index], onTap: () => onTap(items[index])),
                if (index < items.length - 1)
                  const Divider(height: 1, indent: 84, endIndent: 16),
              ],
            ],
          ),
        ),
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
    final accent = _notificationAccent(item.type);
    return InkWell(
      key: ValueKey('notification-card-${item.id}'),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                UserAvatar(
                  displayName: actor,
                  username: item.actor?.username ?? 'unknown',
                  imageUrl: item.actor?.avatarUrl,
                  key: ValueKey('notification-avatar-${item.id}'),
                  radius: 26,
                ),
                Positioned(
                  right: -7,
                  bottom: -5,
                  child: Container(
                    key: ValueKey('notification-event-${item.type}'),
                    width: 28,
                    height: 28,
                    decoration: BoxDecoration(
                      color: accent,
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 2),
                    ),
                    child: Icon(_notificationIcon(item.type), color: Colors.white, size: 16),
                  ),
                ),
              ],
            ),
            const SizedBox(width: 22),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: const Color(0xFF101828),
                        fontSize: 16,
                        height: 1.25,
                        fontWeight: item.isUnread ? FontWeight.w700 : FontWeight.w500,
                      )),
                  const SizedBox(height: 7),
                  Text(item.detail,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: Color(0xFF667085), fontSize: 14, height: 1.25)),
                  const SizedBox(height: 8),
                  Text(notificationAgeLabel(item.createdAt),
                      style: const TextStyle(color: Color(0xFF667085), fontSize: 13)),
                ],
              ),
            ),
            const SizedBox(width: 10),
            _PollPreview(item: item),
            if (item.isUnread) ...[
              const SizedBox(width: 9),
              const Icon(Icons.circle, size: 10, color: Color(0xFF2F6FED)),
            ],
          ],
        ),
      ),
    );
  }

}

class _NotificationsHeader extends StatelessWidget {
  const _NotificationsHeader({required this.onMarkAllRead});
  final VoidCallback onMarkAllRead;

  @override
  Widget build(BuildContext context) => Container(
        key: const ValueKey('notifications-header'),
        height: 68,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: const Color(0xFFF0F1F4)),
        ),
        child: Row(
          children: [
            IconButton(onPressed: () => Navigator.maybePop(context), icon: const Icon(Icons.arrow_back, size: 30, color: Color(0xFF101828))),
            const SizedBox(width: 12),
            const Expanded(child: Text('Notifications', style: TextStyle(color: Color(0xFF101828), fontSize: 22, fontWeight: FontWeight.w700))),
            PopupMenuButton<String>(
              icon: const Icon(Icons.more_vert, size: 28, color: Color(0xFF101828)),
              onSelected: (_) => onMarkAllRead(),
              itemBuilder: (_) => const [PopupMenuItem(value: 'read', child: Text('Mark all as read'))],
            ),
          ],
        ),
      );
}

class _PollPreview extends StatelessWidget {
  const _PollPreview({required this.item});
  final NotificationSummary item;
  @override
  Widget build(BuildContext context) => Container(
        key: ValueKey('notification-preview-${item.id}'),
        width: 68,
        height: 68,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(10),
          gradient: LinearGradient(
            colors: [_notificationAccent(item.type).withValues(alpha: .9), const Color(0xFF172B4D)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        padding: const EdgeInsets.all(8),
        alignment: Alignment.bottomLeft,
        child: Text(
          item.pollId == null ? 'Profile' : item.type == 'like' ? 'Your poll' : 'Poll',
          maxLines: 2,
          style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700),
        ),
      );
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();
  @override
  Widget build(BuildContext context) => const Center(child: Text('No notifications yet', style: TextStyle(color: Color(0xFF667085))));
}

Color _notificationAccent(String type) => switch (type) {
      'comment' || 'comment_reply' => const Color(0xFF2F6FED),
      'like' => const Color(0xFFF45B69),
      'poll_vote' => const Color(0xFF55C98B),
      _ => const Color(0xFF667085),
    };

IconData _notificationIcon(String type) => switch (type) {
      'comment' || 'comment_reply' => Icons.chat_bubble,
      'like' => Icons.favorite,
      'poll_vote' => Icons.check,
      'follow' => Icons.person_add,
      _ => Icons.notifications,
    };

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
