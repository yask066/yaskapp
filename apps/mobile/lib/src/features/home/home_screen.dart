import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/widgets/user_avatar.dart';
import '../auth/auth_api_client.dart';
import '../auth/auth_session.dart';
import '../feed/feed_screen.dart';
import '../polls/polls_api_client.dart';
import '../profile/profile_screen.dart';
import '../subscriptions/subscriptions_screen.dart';
import '../notifications/notifications_screen.dart';
import '../notifications/notifications_api_client.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({
    required this.session,
    required this.authApiClient,
    required this.onLogout,
    required this.onUserUpdated,
    super.key,
    PollsApiClient? pollsApiClient,
    NotificationsApiClient? notificationsApiClient,
  })  : _pollsApiClient = pollsApiClient,
        _notificationsApiClient = notificationsApiClient;

  final AuthSession session;
  final AuthApiClient authApiClient;
  final VoidCallback onLogout;
  final ValueChanged<AuthUser> onUserUpdated;
  final PollsApiClient? _pollsApiClient;
  final NotificationsApiClient? _notificationsApiClient;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  var _selectedIndex = 0;
  var _unreadNotifications = 0;
  var _notificationsViewed = false;
  late final PollsApiClient _pollsApiClient;
  late final bool _ownsPollsApiClient;
  late final NotificationsApiClient _notificationsApiClientInstance;
  late final bool _ownsNotificationsApiClient;
  final _feedKey = GlobalKey<FeedScreenState>();
  final _profileKey = GlobalKey<ProfileScreenState>();

  @override
  void initState() {
    super.initState();
    _ownsPollsApiClient = widget._pollsApiClient == null;
    _pollsApiClient = widget._pollsApiClient ?? PollsApiClient();
    _ownsNotificationsApiClient = widget._notificationsApiClient == null;
    _notificationsApiClientInstance =
        widget._notificationsApiClient ?? NotificationsApiClient();
    unawaited(_loadUnreadNotificationCount());
  }

  @override
  void dispose() {
    if (_ownsPollsApiClient) {
      _pollsApiClient.close();
    }
    if (_ownsNotificationsApiClient) {
      _notificationsApiClientInstance.close();
    }
    super.dispose();
  }

  Future<void> _loadUnreadNotificationCount() async {
    try {
      final page = await _notificationsApiClientInstance.list(
        accessToken: widget.session.accessToken,
        limit: 1,
      );
      if (!mounted || _notificationsViewed) return;
      setState(() => _unreadNotifications = page.unreadCount);
    } catch (_) {
      // The notification tab can retry the full request when opened.
    }
  }

  Future<void> _openCreatePoll() async {
    setState(() {
      _selectedIndex = 0;
    });

    await _feedKey.currentState?.openCreatePoll();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _selectedIndex,
        children: [
          FeedScreen(
            key: _feedKey,
            session: widget.session,
            pollsApiClient: _pollsApiClient,
            onPollCreated: (_) {
              unawaited(_profileKey.currentState?.refreshMyPolls());
            },
          ),
          SubscriptionsScreen(
            session: widget.session,
            pollsApiClient: _pollsApiClient,
          ),
          NotificationsScreen(
            session: widget.session,
            isActive: _selectedIndex == 2,
            apiClient: _notificationsApiClientInstance,
            onUnreadCountChanged: (count) =>
                setState(() => _unreadNotifications = count),
          ),
          ProfileScreen(
            key: _profileKey,
            user: widget.session.user,
            accessToken: widget.session.accessToken,
            authApiClient: widget.authApiClient,
            pollsApiClient: _pollsApiClient,
            onLogout: widget.onLogout,
            onUserUpdated: widget.onUserUpdated,
          ),
        ],
      ),
      bottomNavigationBar: MainBottomNavigation(
        user: widget.session.user,
        selectedIndex: _selectedIndex,
        onCreate: _openCreatePoll,
        unreadNotifications: _unreadNotifications,
        onNotificationsOpened: () {
          setState(() {
            _notificationsViewed = true;
            _unreadNotifications = 0;
          });
        },
        onSelected: (index) {
          setState(() {
            _selectedIndex = index;
          });

          if (index == 3) {
            unawaited(_profileKey.currentState?.refreshMyPolls());
          }
        },
      ),
    );
  }
}

class MainBottomNavigation extends StatelessWidget {
  const MainBottomNavigation({
    required this.user,
    required this.selectedIndex,
    required this.onSelected,
    required this.onCreate,
    this.onNotificationsOpened,
    this.unreadNotifications = 0,
  });

  final AuthUser user;
  final int selectedIndex;
  final ValueChanged<int> onSelected;
  final VoidCallback onCreate;
  final VoidCallback? onNotificationsOpened;
  final int unreadNotifications;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        height: 68,
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: Color(0xFFE4E7EC))),
        ),
        child: Row(
          children: [
            _NavItem(
              label: 'Home',
              icon: Icons.home_outlined,
              selectedIcon: Icons.home,
              selected: selectedIndex == 0,
              onTap: () => onSelected(0),
            ),
            _NavItem(
              label: 'Subscriptions',
              icon: Icons.people_outline,
              selectedIcon: Icons.people,
              selected: selectedIndex == 1,
              onTap: () => onSelected(1),
            ),
            Expanded(
              child: InkWell(
                onTap: onCreate,
                child: const Center(child: _CreateNavigationIcon()),
              ),
            ),
            _NavItem(
              label: 'Notifications',
              icon: Icons.notifications_none_outlined,
              selectedIcon: Icons.notifications,
              selected: selectedIndex == 2,
              onTap: () {
                onSelected(2);
                onNotificationsOpened?.call();
              },
              badgeCount: unreadNotifications,
            ),
            _NavItem(
              label: 'Profile',
              icon: Icons.person_outline,
              selectedIcon: Icons.person,
              customIcon: UserAvatar(
                displayName: user.profile.displayName,
                username: user.username,
                imageUrl: user.profile.avatarUrl,
                radius: 14,
              ),
              selected: selectedIndex == 3,
              onTap: () => onSelected(3),
            ),
          ],
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.label,
    required this.icon,
    required this.selectedIcon,
    required this.selected,
    required this.onTap,
    this.customIcon,
    this.badgeCount = 0,
  });

  final String label;
  final IconData icon;
  final IconData selectedIcon;
  final bool selected;
  final VoidCallback onTap;
  final Widget? customIcon;
  final int badgeCount;

  @override
  Widget build(BuildContext context) {
    const navy = Color(0xFF566A9D);
    const secondary = Color(0xFF475467);

    return Expanded(
      child: InkWell(
        onTap: onTap,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                customIcon ??
                    Icon(selected ? selectedIcon : icon,
                        color: selected ? navy : secondary,
                        size: selected ? 26 : 24),
                if (badgeCount > 0)
                  Positioned(
                    right: -12,
                    top: -8,
                    child: Container(
                      constraints:
                          const BoxConstraints(minWidth: 16, minHeight: 16),
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                      decoration: BoxDecoration(
                          color: const Color(0xFFD92D20),
                          borderRadius: BorderRadius.circular(10)),
                      child: Text(badgeCount > 99 ? '99+' : '$badgeCount',
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                              color: Colors.white,
                              fontSize: 9,
                              fontWeight: FontWeight.w700)),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 4),
            FittedBox(
              fit: BoxFit.scaleDown,
              child: Text(
                label,
                maxLines: 1,
                softWrap: false,
                style: TextStyle(
                  color: selected ? navy : secondary,
                  fontSize: 11,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CreateNavigationIcon extends StatelessWidget {
  const _CreateNavigationIcon();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 50,
      height: 50,
      decoration: BoxDecoration(
        color: const Color(0xFF566A9D),
        borderRadius: BorderRadius.circular(16),
      ),
      child: const Icon(Icons.add, color: Colors.white, size: 30),
    );
  }
}

class _SimplePlaceholderScreen extends StatelessWidget {
  const _SimplePlaceholderScreen({
    required this.title,
    required this.icon,
    required this.message,
  });

  final String title;
  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F8FC),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        title: Text(title),
      ),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 44, color: const Color(0xFF566A9D)),
            const SizedBox(height: 14),
            Text(message, style: const TextStyle(color: Color(0xFF667085))),
          ],
        ),
      ),
    );
  }
}
