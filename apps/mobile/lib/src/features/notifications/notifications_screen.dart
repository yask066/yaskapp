import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/motion/entry_motion.dart';
import '../../core/scroll/list_scroll_anchor_host.dart';
import '../../core/scroll/list_scroll_state.dart';
import '../../core/widgets/content_skeleton.dart';
import '../../core/widgets/user_avatar.dart';
import 'notification_model.dart';
import 'notification_navigator.dart';
import 'notification_store.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({
    required this.notificationStore,
    this.isActive = false,
    this.userId,
    super.key,
  });

  final NotificationStore notificationStore;
  final bool isActive;
  final String? userId;

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  final _scrollController = ScrollController();
  bool _loading = false;
  bool _loadingMore = false;
  bool _unreadOnly = false;
  bool _requestedFirstPage = false;
  bool _retryFirstPage = false;
  bool _fillingUnreadPages = false;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_handleScroll);
    widget.notificationStore.addListener(_handleStoreChanged);
    widget.notificationStore.setInboxAtTop(true);
    if (widget.isActive) unawaited(_loadFirstPage());
  }

  @override
  void didUpdateWidget(covariant NotificationsScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.notificationStore != widget.notificationStore) {
      oldWidget.notificationStore.removeListener(_handleStoreChanged);
      widget.notificationStore.addListener(_handleStoreChanged);
      widget.notificationStore.setInboxAtTop(
        !_scrollController.hasClients || _scrollController.offset <= 1,
      );
      _requestedFirstPage = false;
    }
    if (shouldLoadNotifications(
      isActive: widget.isActive,
      wasActive: oldWidget.isActive,
    )) {
      unawaited(_loadFirstPage());
    }
  }

  @override
  void dispose() {
    widget.notificationStore.removeListener(_handleStoreChanged);
    _scrollController.dispose();
    super.dispose();
  }

  void _handleStoreChanged() {
    if (!mounted) return;
    setState(() {});
    _resumeUnreadFill();
  }

  Future<void> _loadFirstPage({bool refresh = false}) async {
    if (_loading) return;
    final store = widget.notificationStore;
    if (!refresh && _requestedFirstPage) return;
    if (!refresh && store.state.ids.isNotEmpty) {
      _requestedFirstPage = true;
      return;
    }

    _requestedFirstPage = true;
    setState(() => _loading = true);
    await store.loadFirstPage();
    if (!mounted) return;
    setState(() {
      _loading = false;
      _retryFirstPage = refresh && store.state.error != null;
    });
    _resumeUnreadFill();
  }

  Future<void> _loadNextPage() async {
    final store = widget.notificationStore;
    if (store.state.nextCursor == null) return;
    if (!_loadingMore) setState(() => _loadingMore = true);
    try {
      await store.loadNextPage();
    } finally {
      if (mounted && _loadingMore) {
        setState(() {
          _loadingMore = false;
          _retryFirstPage = false;
        });
      }
      _resumeUnreadFill();
    }
  }

  void _setUnreadFilter(bool unreadOnly) {
    setState(() => _unreadOnly = unreadOnly);
    _resumeUnreadFill();
  }

  void _resumeUnreadFill() {
    final store = widget.notificationStore;
    if (_unreadOnly &&
        !_loading &&
        !_loadingMore &&
        _visibleItems(store.state).isEmpty &&
        store.state.unreadCount > 0 &&
        store.state.nextCursor != null &&
        store.state.error == null) {
      unawaited(_loadUnreadUntilFound());
    }
  }

  Future<void> _loadUnreadUntilFound() async {
    if (_fillingUnreadPages) return;
    final store = widget.notificationStore;
    _fillingUnreadPages = true;
    try {
      while (mounted &&
          _unreadOnly &&
          _visibleItems(store.state).isEmpty &&
          store.state.unreadCount > 0 &&
          store.state.nextCursor != null &&
          store.state.error == null) {
        await _loadNextPage();
      }
    } finally {
      _fillingUnreadPages = false;
      if (mounted) setState(() {});
    }
  }

  void _handleScroll() {
    if (!_scrollController.hasClients) return;
    final position = _scrollController.position;
    widget.notificationStore.setInboxAtTop(position.pixels <= 1);
    if (position.extentAfter < 240 &&
        widget.notificationStore.state.nextCursor != null &&
        !_loadingMore) {
      unawaited(_loadNextPage());
    }
  }

  Future<void> _materializePendingAtTop() async {
    if (_scrollController.hasClients) {
      if (MediaQuery.disableAnimationsOf(context)) {
        _scrollController.jumpTo(0);
      } else {
        await _scrollController.animateTo(
          0,
          duration: const Duration(milliseconds: 240),
          curve: Curves.easeOut,
        );
      }
    }
    widget.notificationStore.materializePending();
  }

  void _markAllRead() {
    unawaited(widget.notificationStore.markAllRead());
  }

  Future<void> _openNotification(NotificationItem item) async {
    if (item.isUnread) {
      unawaited(widget.notificationStore.markRead(item.id));
    }
    await openNotificationTarget(context, item);
  }

  List<NotificationItem> _visibleItems(NotificationStoreState state) =>
      state.ids
          .map((id) => state.itemsById[id])
          .whereType<NotificationItem>()
          .where((item) => !_unreadOnly || item.isUnread)
          .toList(growable: false);

  @override
  Widget build(BuildContext context) {
    final state = widget.notificationStore.state;
    final visibleItems = _visibleItems(state);
    final sections = _groupedSections(visibleItems);
    final isInitialLoading = _loading && state.ids.isEmpty;
    final isInitialError =
        state.error != null && state.ids.isEmpty && !_loading;

    return Scaffold(
      backgroundColor: const Color(0xFFF7F8FC),
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
              child: _NotificationsHeader(
                onMarkAllRead: _markAllRead,
                canMarkAllRead: state.unreadCount > 0,
                isMarkAllPending: state.isMarkAllPending,
              ),
            ),
            if (state.isMarkAllPending)
              const Padding(
                padding: EdgeInsets.fromLTRB(16, 12, 16, 0),
                child: LinearProgressIndicator(
                  key: ValueKey('read-all-pending'),
                  minHeight: 3,
                  semanticsLabel: 'Marking all notifications read',
                ),
              ),
            if (state.readAllError != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                child: _ReadAllError(onRetry: _markAllRead),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
              child: _NotificationFilters(
                unreadOnly: _unreadOnly,
                onChanged: _setUnreadFilter,
              ),
            ),
            if (_loadingMore)
              const Padding(
                padding: EdgeInsets.fromLTRB(16, 12, 16, 0),
                child: LinearProgressIndicator(
                  key: ValueKey('notifications-loading-more'),
                  minHeight: 3,
                  semanticsLabel: 'Loading more notifications',
                ),
              ),
            if (state.pendingIds.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                child: _PendingNotificationsBanner(
                  count: state.pendingIds.length,
                  onTap: _materializePendingAtTop,
                ),
              ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: () => _loadFirstPage(refresh: true),
                child: ListScrollAnchorHost(
                  context: ListScrollContext(
                    userId: widget.userId,
                    route: '/notifications',
                    list: 'inbox',
                    query: '',
                    filter: _unreadOnly ? 'unread' : 'all',
                    sort: 'createdAt-desc',
                  ),
                  store: listScrollStateStore,
                  controller: _scrollController,
                  itemIds: visibleItems
                      .map((item) => 'notification-${item.id}')
                      .toList(),
                  child: EntryMotionRegistryScope(
                    contextKey:
                        'notifications:${widget.userId ?? 'anonymous'}:${_unreadOnly ? 'unread' : 'all'}',
                    child: ListView(
                      controller: _scrollController,
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.fromLTRB(16, 24, 16, 32),
                      children: [
                        if (isInitialLoading)
                          const _NotificationsLoading()
                        else if (isInitialError)
                          _ErrorState(
                              onRetry: () => _loadFirstPage(refresh: true))
                        else if (state.ids.isEmpty)
                          const _EmptyState()
                        else if (visibleItems.isEmpty &&
                            _unreadOnly &&
                            state.unreadCount > 0 &&
                            state.nextCursor != null)
                          _UnreadSearchState(isError: state.error != null)
                        else if (visibleItems.isEmpty)
                          const _FilteredEmptyState()
                        else
                          for (var sectionIndex = 0;
                              sectionIndex < sections.length;
                              sectionIndex++) ...[
                            _NotificationSection(
                              title: sections[sectionIndex].$1,
                              items: sections[sectionIndex].$2,
                              contextKey:
                                  'notifications:${widget.userId ?? 'anonymous'}:${_unreadOnly ? 'unread' : 'all'}',
                              indexOffset: sections
                                  .take(sectionIndex)
                                  .fold<int>(
                                      0,
                                      (total, section) =>
                                          total + section.$2.length),
                              onTap: _openNotification,
                            ),
                            const SizedBox(height: 24),
                          ],
                        if (state.error != null && state.ids.isNotEmpty)
                          _PageError(onRetry: _retryData),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _retryData() {
    return _retryFirstPage || widget.notificationStore.state.nextCursor == null
        ? _loadFirstPage(refresh: true)
        : _loadNextPage();
  }

  List<(String, List<NotificationItem>)> _groupedSections(
      List<NotificationItem> items) {
    final now = DateTime.now();
    final today = <NotificationItem>[];
    final yesterday = <NotificationItem>[];
    final earlier = <NotificationItem>[];
    for (final item in items) {
      final date = item.createdAt.toLocal();
      final difference =
          DateUtils.dateOnly(now).difference(DateUtils.dateOnly(date)).inDays;
      if (difference <= 0) {
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

  if (ageInSeconds < 60) return _ageLabel(ageInSeconds, 'second');
  final minutes = ageInSeconds ~/ 60;
  if (minutes < 60) return _ageLabel(minutes, 'minute');
  final hours = minutes ~/ 60;
  if (hours < 24) return _ageLabel(hours, 'hour');
  final days = hours ~/ 24;
  if (days < 7) return _ageLabel(days, 'day');
  if (days < 30) return _ageLabel(days ~/ 7, 'week');
  if (days < 365) return _ageLabel(days ~/ 30, 'month');
  return _ageLabel(days ~/ 365, 'year');
}

String _ageLabel(int value, String unit) =>
    '$value $unit${value == 1 ? '' : 's'} ago';

class _NotificationSection extends StatelessWidget {
  const _NotificationSection({
    required this.title,
    required this.items,
    required this.contextKey,
    required this.indexOffset,
    required this.onTap,
  });

  final String title;
  final List<NotificationItem> items;
  final String contextKey;
  final int indexOffset;
  final ValueChanged<NotificationItem> onTap;

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
                ListScrollAnchorItem(
                  id: 'notification-${items[index].id}',
                  child: EntryMotion(
                    key: ValueKey('entry-notification-${items[index].id}'),
                    contextKey: contextKey,
                    itemId: items[index].id,
                    visible: true,
                    indexInBatch: indexOffset + index,
                    child: _NotificationTile(
                      item: items[index],
                      onTap: () => onTap(items[index]),
                    ),
                  ),
                ),
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

  final NotificationItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final actor = item.actor?.displayName ?? 'Someone';
    final accent = _notificationAccent(item.type.wireName);
    final background = item.isUnread ? const Color(0xFFEEF4FF) : Colors.white;
    return Semantics(
      key: ValueKey('notification-card-semantics-${item.id}'),
      container: true,
      button: true,
      label: '${item.title}${item.isUnread ? ', unread notification' : ''}',
      child: InkWell(
        key: ValueKey('notification-card-${item.id}'),
        onTap: onTap,
        child: Container(
          key: ValueKey('notification-card-background-${item.id}'),
          decoration: BoxDecoration(color: background),
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
                      key: ValueKey('notification-event-${item.type.wireName}'),
                      width: 28,
                      height: 28,
                      decoration: BoxDecoration(
                        color: accent,
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white, width: 2),
                      ),
                      child: Icon(
                        _notificationIcon(item.type.wireName),
                        color: Colors.white,
                        size: 16,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(width: 22),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _NotificationTitle(item: item),
                    const SizedBox(height: 7),
                    Text(
                      item.detail,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFF475467),
                        fontSize: 14,
                        height: 1.25,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Tooltip(
                      message: _dateTime(item.createdAt.toLocal()),
                      child: Text(
                        notificationAgeLabel(item.createdAt.toLocal()),
                        key: ValueKey('notification-age-${item.id}'),
                        style: const TextStyle(
                          color: Color(0xFF475467),
                          fontSize: 13,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              if (item.isUnread)
                Semantics(
                  label: 'Unread notification',
                  child: const Icon(
                    Icons.circle,
                    key: ValueKey('notification-unread-marker'),
                    size: 10,
                    color: Color(0xFF2F6FED),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NotificationTitle extends StatelessWidget {
  const _NotificationTitle({required this.item});

  final NotificationItem item;

  @override
  Widget build(BuildContext context) {
    final actorName = item.actor?.displayName ?? 'Someone';
    final titleStyle = TextStyle(
      color: const Color(0xFF101828),
      fontSize: 16,
      height: 1.25,
      fontWeight: item.isUnread ? FontWeight.w700 : FontWeight.w500,
    );
    final actorIndex = item.title.indexOf(actorName);
    if (actorIndex < 0) {
      return Text(
        item.title,
        key: ValueKey('notification-title-${item.id}'),
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: titleStyle,
      );
    }

    final actorEnd = actorIndex + actorName.length;
    final accent = _notificationAccent(item.type.wireName);
    return RichText(
      key: ValueKey('notification-title-${item.id}'),
      maxLines: 2,
      overflow: TextOverflow.ellipsis,
      text: TextSpan(
        style: titleStyle,
        children: [
          TextSpan(text: item.title.substring(0, actorIndex)),
          WidgetSpan(
            alignment: PlaceholderAlignment.middle,
            child: Container(
              key: ValueKey('notification-actor-chip-${item.id}'),
              padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 1),
              decoration: BoxDecoration(
                border: Border.all(color: accent, width: 1.5),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                actorName,
                key: ValueKey('notification-actor-${item.id}'),
                style: titleStyle.copyWith(
                  color: const Color(0xFF101828),
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
          TextSpan(text: item.title.substring(actorEnd)),
        ],
      ),
    );
  }
}

class _NotificationsHeader extends StatelessWidget {
  const _NotificationsHeader({
    required this.onMarkAllRead,
    required this.canMarkAllRead,
    required this.isMarkAllPending,
  });

  final VoidCallback onMarkAllRead;
  final bool canMarkAllRead;
  final bool isMarkAllPending;

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
            const Expanded(
              child: Text(
                'Notifications',
                style: TextStyle(
                  color: Color(0xFF101828),
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            PopupMenuButton<String>(
              enabled: canMarkAllRead && !isMarkAllPending,
              icon: const Icon(Icons.more_vert,
                  size: 28, color: Color(0xFF101828)),
              onSelected: (_) => onMarkAllRead(),
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'read', child: Text('Mark all as read')),
              ],
            ),
          ],
        ),
      );
}

class _NotificationFilters extends StatelessWidget {
  const _NotificationFilters({
    required this.unreadOnly,
    required this.onChanged,
  });

  final bool unreadOnly;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) => Wrap(
        spacing: 8,
        children: [
          ChoiceChip(
            label: const Text('All'),
            selected: !unreadOnly,
            onSelected: (_) => onChanged(false),
          ),
          ChoiceChip(
            label: const Text('Unread'),
            selected: unreadOnly,
            onSelected: (_) => onChanged(true),
          ),
        ],
      );
}

class _PendingNotificationsBanner extends StatelessWidget {
  const _PendingNotificationsBanner({
    required this.count,
    required this.onTap,
  });

  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
        color: const Color(0xFFEAF1FF),
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 48),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.arrow_upward, size: 18),
                  const SizedBox(width: 8),
                  Text('New notifications ($count)'),
                ],
              ),
            ),
          ),
        ),
      );
}

class _NotificationsLoading extends StatelessWidget {
  const _NotificationsLoading();

  @override
  Widget build(BuildContext context) => const DelayedContentSkeleton(
        key: ValueKey('notifications-loading'),
        semanticsKey: ValueKey('notifications-loading-semantics'),
        kind: ContentSkeletonKind.notification,
        rows: 2,
      );
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) => const SizedBox(
        height: 240,
        child: Center(
          child: Text(
            'No notifications yet',
            style: TextStyle(color: Color(0xFF475467)),
          ),
        ),
      );
}

class _FilteredEmptyState extends StatelessWidget {
  const _FilteredEmptyState();

  @override
  Widget build(BuildContext context) => const SizedBox(
        height: 200,
        child: Center(
          child: Text(
            'No unread notifications',
            style: TextStyle(color: Color(0xFF475467)),
          ),
        ),
      );
}

class _UnreadSearchState extends StatelessWidget {
  const _UnreadSearchState({required this.isError});

  final bool isError;

  @override
  Widget build(BuildContext context) => SizedBox(
        height: 180,
        child: Center(
          child: isError
              ? const Text('Could not load unread notifications')
              : Semantics(
                  label: 'Loading unread notifications',
                  liveRegion: true,
                  child: const Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      CircularProgressIndicator(),
                      SizedBox(height: 12),
                      Text('Looking for unread notifications'),
                    ],
                  ),
                ),
        ),
      );
}

class _ReadAllError extends StatelessWidget {
  const _ReadAllError({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => MaterialBanner(
        content: const Text('Could not mark all as read'),
        actions: [TextButton(onPressed: onRetry, child: const Text('Retry'))],
      );
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => SizedBox(
        height: 240,
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Could not load notifications'),
              const SizedBox(height: 12),
              FilledButton(onPressed: onRetry, child: const Text('Retry')),
            ],
          ),
        ),
      );
}

class _PageError extends StatelessWidget {
  const _PageError({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            const Expanded(child: Text('Could not load notifications')),
            TextButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ),
      );
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

String _dateTime(DateTime value) =>
    '${value.day.toString().padLeft(2, '0')}.${value.month.toString().padLeft(2, '0')}.${value.year} '
    '${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';
