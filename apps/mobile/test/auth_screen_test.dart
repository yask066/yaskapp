import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:yaskapp_mobile/src/core/config/api_config.dart';
import 'package:yaskapp_mobile/src/features/auth/auth_api_client.dart';
import 'package:yaskapp_mobile/src/features/auth/auth_screen.dart';

void main() {
  testWidgets('does not select a country by default', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: AuthScreen(
          authApiClient: AuthApiClient(
            config: const ApiConfig(baseUrl: 'http://api.test'),
            httpClient: MockClient((_) async => http.Response('{}', 500)),
          ),
          onAuthenticated: (_) {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Sign Up'));
    await tester.pumpAndSettle();

    expect(find.text('Select your country'), findsOneWidget);
    expect(
      tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'REGISTER'),
      ).onPressed,
      isNull,
    );
  });

  testWidgets('keeps selected country after registration error',
      (tester) async {
    tester.view.physicalSize = const Size(800, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    final client = AuthApiClient(
      config: const ApiConfig(baseUrl: 'http://api.test'),
      httpClient: MockClient((request) async {
        return http.Response(
          jsonEncode({
            'error': 'conflict',
            'message': 'Email or username is already taken.',
          }),
          409,
        );
      }),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: AuthScreen(
          authApiClient: client,
          onAuthenticated: (_) {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Sign Up'));
    await tester.pumpAndSettle();

    await tester.drag(
      find.byType(SingleChildScrollView),
      const Offset(0, -400),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Select your country').first);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ListTile, 'Belarus'));
    await tester.pumpAndSettle();

    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), 'user@example.com');
    await tester.enterText(fields.at(1), 'user_123');
    await tester.enterText(fields.at(2), 'Test User');
    await tester.enterText(fields.at(3), 'password123');
    await tester.tap(find.widgetWithText(FilledButton, 'REGISTER'));
    await tester.pumpAndSettle();

    expect(find.text('Email or username is already taken.'), findsOneWidget);
    expect(find.text('Belarus'), findsOneWidget);
  });
}
