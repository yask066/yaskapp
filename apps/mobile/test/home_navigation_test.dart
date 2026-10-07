import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/core/widgets/user_avatar.dart';
import 'package:yaskapp_mobile/src/features/auth/auth_session.dart';
import 'package:yaskapp_mobile/src/features/home/home_screen.dart';

void main() {
  testWidgets('uses the current user avatar for the Profile navigation item',
      (tester) async {
    const user = AuthUser(
      id: 'user-1',
      email: 'user@example.com',
      username: 'user',
      status: 'active',
      profile: AuthUserProfile(
        displayName: 'User',
        pollsCount: 0,
        followersCount: 0,
        followingCount: 0,
        avatarUrl: '/media/avatars/user-1',
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: MainBottomNavigation(
            user: user,
            selectedIndex: 3,
            onCreate: () {},
            onSelected: (_) {},
          ),
        ),
      ),
    );

    final avatar = tester.widget<UserAvatar>(find.byType(UserAvatar));
    expect(avatar.imageUrl, '/media/avatars/user-1');
    expect(avatar.radius, 14);
    expect(find.byIcon(Icons.person), findsNothing);
  });

  testWidgets('notifies Home when the Notifications tab is opened',
      (tester) async {
    var opened = false;
    const user = AuthUser(
      id: 'user-1',
      email: 'user@example.com',
      username: 'user',
      status: 'active',
      profile: AuthUserProfile(
        displayName: 'User',
        pollsCount: 0,
        followersCount: 0,
        followingCount: 0,
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: MainBottomNavigation(
            user: user,
            selectedIndex: 0,
            unreadNotifications: 3,
            onCreate: () {},
            onSelected: (_) {},
            onNotificationsOpened: () => opened = true,
          ),
        ),
      ),
    );

    await tester.tap(find.text('Notifications'));
    expect(opened, isTrue);
  });

  testWidgets('caps large notification badges with an accessible 99 plus label',
      (tester) async {
    const user = AuthUser(
      id: 'user-1',
      email: 'user@example.com',
      username: 'user',
      status: 'active',
      profile: AuthUserProfile(
        displayName: 'User',
        pollsCount: 0,
        followersCount: 0,
        followingCount: 0,
      ),
    );

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: MainBottomNavigation(
          user: user,
          selectedIndex: 0,
          unreadNotifications: 100,
          onCreate: () {},
          onSelected: (_) {},
        ),
      ),
    ));

    expect(find.text('99+'), findsOneWidget);
    final badgeSemantics = tester.widget<Semantics>(
      find.byKey(const ValueKey('notification-badge-semantics')),
    );
    expect(badgeSemantics.properties.label, '99+ unread notifications');
    expect(find.text('100'), findsNothing);
  });

  testWidgets('labels the central create action for screen readers', (
    tester,
  ) async {
    const user = AuthUser(
      id: 'user-1',
      email: 'user@example.com',
      username: 'user',
      status: 'active',
      profile: AuthUserProfile(
        displayName: 'User',
        pollsCount: 0,
        followersCount: 0,
        followingCount: 0,
      ),
    );
    final semantics = tester.ensureSemantics();

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: MainBottomNavigation(
          user: user,
          selectedIndex: 0,
          onCreate: () {},
          onSelected: (_) {},
        ),
      ),
    ));

    expect(find.bySemanticsLabel('Create poll'), findsOneWidget);
    semantics.dispose();
  });
}
