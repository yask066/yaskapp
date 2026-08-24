import 'dart:async';

import 'package:flutter/material.dart';

import '../auth/auth_api_client.dart';
import '../auth/auth_session.dart';
import '../feed/feed_screen.dart';
import '../polls/polls_api_client.dart';
import '../profile/profile_screen.dart';
import '../subscriptions/subscriptions_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({
    required this.session,
    required this.authApiClient,
    required this.onLogout,
    required this.onUserUpdated,
    super.key,
    PollsApiClient? pollsApiClient,
  }) : _pollsApiClient = pollsApiClient;

  final AuthSession session;
  final AuthApiClient authApiClient;
  final VoidCallback onLogout;
  final ValueChanged<AuthUser> onUserUpdated;
  final PollsApiClient? _pollsApiClient;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  var _selectedIndex = 0;
  late final PollsApiClient _pollsApiClient;
  late final bool _ownsPollsApiClient;
  final _feedKey = GlobalKey<FeedScreenState>();
  final _profileKey = GlobalKey<ProfileScreenState>();

  @override
  void initState() {
    super.initState();
    _ownsPollsApiClient = widget._pollsApiClient == null;
    _pollsApiClient = widget._pollsApiClient ?? PollsApiClient();
  }

  @override
  void dispose() {
    if (_ownsPollsApiClient) {
      _pollsApiClient.close();
    }

    super.dispose();
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
          const SizedBox.shrink(),
          const _NotificationsPlaceholder(),
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
      bottomNavigationBar: _MainBottomNavigation(
        selectedIndex: _selectedIndex,
        onCreate: _openCreatePoll,
        onSelected: (index) {
          setState(() {
            _selectedIndex = index;
          });

          if (index == 4) {
            unawaited(_profileKey.currentState?.refreshMyPolls());
          }
        },
      ),
    );
  }
}

class _MainBottomNavigation extends StatelessWidget {
  const _MainBottomNavigation({
    required this.selectedIndex,
    required this.onSelected,
    required this.onCreate,
  });

  final int selectedIndex;
  final ValueChanged<int> onSelected;
  final VoidCallback onCreate;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        height: 76,
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
              selected: selectedIndex == 3,
              onTap: () => onSelected(3),
            ),
            _NavItem(
              label: 'Profile',
              icon: Icons.person_outline,
              selectedIcon: Icons.person,
              selected: selectedIndex == 4,
              onTap: () => onSelected(4),
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
  });

  final String label;
  final IconData icon;
  final IconData selectedIcon;
  final bool selected;
  final VoidCallback onTap;

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
            Icon(
              selected ? selectedIcon : icon,
              color: selected ? navy : secondary,
              size: selected ? 26 : 24,
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

class _NotificationsPlaceholder extends StatelessWidget {
  const _NotificationsPlaceholder();

  @override
  Widget build(BuildContext context) {
    return const _SimplePlaceholderScreen(
      title: 'Notifications',
      icon: Icons.notifications_none_outlined,
      message: 'Your notifications will appear here.',
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
