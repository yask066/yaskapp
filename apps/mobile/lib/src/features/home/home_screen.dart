import 'package:flutter/material.dart';

import '../auth/auth_api_client.dart';
import '../auth/auth_session.dart';
import '../explore/explore_screen.dart';
import '../feed/feed_screen.dart';
import '../polls/polls_api_client.dart';
import '../profile/profile_screen.dart';

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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _selectedIndex,
        children: [
          FeedScreen(
            session: widget.session,
            pollsApiClient: widget._pollsApiClient,
          ),
          const ExploreScreen(),
          ProfileScreen(
            user: widget.session.user,
            accessToken: widget.session.accessToken,
            authApiClient: widget.authApiClient,
            pollsApiClient: widget._pollsApiClient,
            onLogout: widget.onLogout,
            onUserUpdated: widget.onUserUpdated,
          ),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedIndex,
        onDestinationSelected: (index) {
          setState(() {
            _selectedIndex = index;
          });
        },
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: 'Home',
          ),
          NavigationDestination(
            icon: Icon(Icons.explore_outlined),
            selectedIcon: Icon(Icons.explore),
            label: 'Explore',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: 'Profile',
          ),
        ],
      ),
    );
  }
}
