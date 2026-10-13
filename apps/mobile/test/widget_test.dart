import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:yaskapp_mobile/src/app.dart';
import 'package:yaskapp_mobile/src/core/config/api_config.dart';
import 'package:yaskapp_mobile/src/features/auth/auth_api_client.dart';
import 'package:yaskapp_mobile/src/features/auth/auth_session_store.dart';
import 'package:yaskapp_mobile/src/features/auth/auth_session.dart';
import 'package:yaskapp_mobile/src/features/home/home_screen.dart';
import 'package:yaskapp_mobile/src/features/account_deletion/account_deletion_receipt_store.dart';

void main() {
  testWidgets(
      'cleans account data when bootstrap session validation returns 401',
      (tester) async {
    tester.view.physicalSize = const Size(412, 915);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    var meCalls = 0;
    final sessionStore = _PreloadedAuthSessionStore('access-token');
    final authApiClient = AuthApiClient(
      config: const ApiConfig(baseUrl: 'http://api.test'),
      httpClient: MockClient((request) async {
        if (request.url.path == '/auth/me') {
          meCalls++;
          return http.Response('{"message":"Unauthorized"}', 401);
        }
        return http.Response('{}', 503);
      }),
    );

    await tester.pumpWidget(YaskappApp(
      authApiClient: authApiClient,
      authSessionStore: sessionStore,
      accountDeletionReceiptStore: MemoryAccountDeletionReceiptStore(),
    ));
    for (var i = 0; i < 20; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }

    expect(meCalls, 1);
    expect(find.byType(HomeScreen), findsNothing);
    expect(sessionStore.token, isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('shows auth entry point', (tester) async {
    tester.view.physicalSize = const Size(412, 915);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      YaskappApp(
        authSessionStore: MemoryAuthSessionStore(),
        accountDeletionReceiptStore: MemoryAccountDeletionReceiptStore(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.bySemanticsLabel('Yaskapp'), findsOneWidget);
    expect(find.text('LOGIN'), findsNWidgets(2));
    expect(find.text('Sign Up'), findsOneWidget);

    await tester.ensureVisible(find.text('Sign Up'));
    await tester.tap(find.text('Sign Up'));
    await tester.pumpAndSettle();

    expect(find.text('REGISTER'), findsNWidgets(2));
    expect(find.text('Email'), findsOneWidget);
    expect(find.text('Username'), findsOneWidget);
    expect(find.text('Display name'), findsOneWidget);
    expect(find.text('Password'), findsOneWidget);
    expect(find.text('Back to Login'), findsOneWidget);

    await tester.ensureVisible(find.text('Back to Login'));
    await tester.tap(find.text('Back to Login'));
    await tester.pumpAndSettle();

    expect(find.text('LOGIN'), findsNWidgets(2));
    expect(find.text('Sign Up'), findsOneWidget);
  });

  testWidgets('opening notifications does not clear the store badge',
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
        bottomNavigationBar: MainBottomNavigation(
          user: user,
          selectedIndex: 0,
          unreadNotifications: 7,
          onCreate: () {},
          onSelected: (_) {},
        ),
      ),
    ));

    expect(find.text('7'), findsOneWidget);
    await tester.tap(find.text('Notifications'));
    await tester.pump();
    expect(find.text('7'), findsOneWidget);
  });
}

class _PreloadedAuthSessionStore extends MemoryAuthSessionStore {
  _PreloadedAuthSessionStore(this.token);

  String? token;

  @override
  Future<String?> readAccessToken() async => token;

  @override
  Future<void> clear() async => token = null;
}
