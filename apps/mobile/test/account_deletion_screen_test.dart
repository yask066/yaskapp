import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/features/account_deletion/account_deletion_screen.dart';
import 'package:yaskapp_mobile/src/features/account_deletion/account_deletion_api_client.dart';
import 'package:yaskapp_mobile/src/features/account_deletion/account_deletion_controller.dart';
import 'package:yaskapp_mobile/src/features/account_deletion/account_deletion_receipt_store.dart';
import 'package:yaskapp_mobile/src/features/profile/settings_screen.dart';

void main() {
  testWidgets('cancel closes the warning without making a request',
      (tester) async {
    var cancelled = false;
    await tester.pumpWidget(MaterialApp(
      home: AccountDeletionScreen(
        onCancel: () => cancelled = true,
      ),
    ));

    await tester.tap(find.text('Cancel'));
    await tester.pump();

    expect(cancelled, isTrue);
  });

  testWidgets('does not allow cancelling while password verification is active',
      (tester) async {
    final verification = Completer<AccountDeletionVerification>();
    final receiptStore = MemoryAccountDeletionReceiptStore();
    final controller = AccountDeletionController(
      api: _Api(onVerify: () => verification.future),
      receiptStore: receiptStore,
    );
    addTearDown(controller.dispose);
    var cancelled = false;
    await tester.pumpWidget(MaterialApp(
      home: AccountDeletionScreen(
        accessToken: 'session-token',
        controller: controller,
        onCancel: () => cancelled = true,
      ),
    ));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, 'secret');
    await tester.tap(find.byType(Checkbox));
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Delete account'));
    await tester.pump();

    expect(
      tester
          .widget<TextButton>(find.widgetWithText(TextButton, 'Cancel'))
          .onPressed,
      isNull,
    );
    expect(find.byType(IconButton), findsNothing);
    expect(cancelled, isFalse);

    verification.complete(AccountDeletionVerification(
      operationId: 'op-1',
      deletionToken: 'delete-token',
      statusToken: 'status-token',
      deletionTokenExpiresAt:
          DateTime.now().toUtc().add(const Duration(hours: 1)),
      statusTokenExpiresAt: DateTime.now().toUtc().add(const Duration(days: 1)),
    ));
    await tester.pump();
    await tester.pump();
    await tester.tap(find.text('Cancel'));
    await tester.pump();
    await tester.pump();

    expect(cancelled, isTrue);
    expect(await receiptStore.read(), isNull);
  });

  testWidgets(
      'requires password and explicit checkbox before enabling deletion',
      (tester) async {
    final controller = AccountDeletionController(
      api: _Api(),
      receiptStore: MemoryAccountDeletionReceiptStore(),
    );
    addTearDown(controller.dispose);
    await tester.pumpWidget(MaterialApp(
      home: AccountDeletionScreen(controller: controller),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Delete account'), findsWidgets);
    final deleteButton = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Delete account'),
    );
    expect(deleteButton.onPressed, isNull);
    await tester.enterText(find.byType(TextField).first, 'alice');
    await tester.enterText(find.byType(TextField).last, 'secret');
    await tester.pump();
    expect(
      tester
          .widget<FilledButton>(
            find.widgetWithText(FilledButton, 'Delete account'),
          )
          .onPressed,
      isNull,
    );
    await tester.tap(find.byType(Checkbox));
    await tester.pump();
    expect(
      tester
          .widget<FilledButton>(
            find.widgetWithText(FilledButton, 'Delete account'),
          )
          .onPressed,
      isNotNull,
    );
  });

  testWidgets('shows completion only when server status says completed',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: AccountDeletionScreen(completed: true),
    ));
    expect(find.text('Account deletion completed'), findsOneWidget);
  });

  testWidgets(
      'restored prepared receipt can be confirmed without signing in again',
      (tester) async {
    final controller = AccountDeletionController(
      api: _Api(),
      receiptStore: _ReceiptStore(),
    );
    await tester.pumpWidget(MaterialApp(
      home: AccountDeletionScreen(controller: controller),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Email or username'), findsNothing);
    expect(find.text('Current password'), findsNothing);
    expect(find.text('Confirm deletion'), findsOneWidget);
    controller.dispose();
  });

  testWidgets('prevents back navigation while acceptance result is unknown', (
    tester,
  ) async {
    final controller = AccountDeletionController(
      api: _OfflineApi(),
      receiptStore: _ReceiptStore(),
    );
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () => Navigator.of(context).push<void>(
              MaterialPageRoute<void>(
                builder: (_) => AccountDeletionScreen(controller: controller),
              ),
            ),
            child: const Text('Open deletion'),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('Open deletion'));
    await tester.pump();
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));

    expect(
      find.textContaining('Checking whether the server accepted your request.'),
      findsOneWidget,
    );
    expect(controller.state.acceptanceUncertain, isTrue);
    final navigator = tester.state<NavigatorState>(find.byType(Navigator));
    await navigator.maybePop();
    await tester.pump();
    expect(find.byType(AccountDeletionScreen), findsOneWidget);
    controller.dispose();
  });

  testWidgets('Settings exposes the deletion screen for the active session',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: SettingsScreen(
        accessToken: 'session-token',
        onLogout: () {},
      ),
    ));
    await tester.tap(find.text('Delete account'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.byType(AccountDeletionScreen), findsOneWidget);
    expect(find.text('Current password'), findsOneWidget);
    await tester.pageBack();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byType(SettingsScreen), findsOneWidget);
  });

  testWidgets('screen reader can identify the irreversible confirmation', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    final controller = AccountDeletionController(
      api: _Api(),
      receiptStore: MemoryAccountDeletionReceiptStore(),
    );
    addTearDown(controller.dispose);
    await tester.pumpWidget(MaterialApp(
      home: AccountDeletionScreen(controller: controller),
    ));
    await tester.pumpAndSettle();

    expect(
      find.bySemanticsLabel(
        'I understand that deleting my account is permanent.',
      ),
      findsOneWidget,
    );
    semantics.dispose();
  });
}

class _Api extends AccountDeletionApi {
  _Api({this.onVerify});

  final Future<AccountDeletionVerification> Function()? onVerify;

  @override
  Future<AccountDeletionVerification> verify({
    String? accessToken,
    String? login,
    required String password,
  }) async =>
      onVerify?.call() ?? (throw UnimplementedError());
  @override
  Future<AccountDeletionStatusResponse> deleteAccount({
    required String deletionToken,
  }) async =>
      throw UnimplementedError();
  @override
  Future<AccountDeletionStatusResponse> getStatus({
    required String statusToken,
  }) async =>
      const AccountDeletionStatusResponse(
        operationId: 'op-1',
        status: AccountDeletionStatus.notStarted,
        acceptedAt: null,
        deadlineAt: null,
        completedAt: null,
      );
}

class _OfflineApi extends _Api {
  @override
  Future<AccountDeletionStatusResponse> getStatus({
    required String statusToken,
  }) async =>
      throw Exception('offline');
}

class _ReceiptStore extends AccountDeletionReceiptStore {
  @override
  Future<AccountDeletionReceipt?> read() async => AccountDeletionReceipt(
        operationId: 'op-1',
        deletionToken: 'delete-token',
        statusToken: 'status-token',
        deletionTokenExpiresAt: DateTime.utc(2030, 10, 13, 12),
        statusTokenExpiresAt: DateTime.utc(2030, 10, 15, 12),
      );
  @override
  Future<void> save(AccountDeletionReceipt receipt) async {}
  @override
  Future<void> clear() async {}
}
