import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/features/account_deletion/account_deletion_api_client.dart';
import 'package:yaskapp_mobile/src/features/account_deletion/account_deletion_controller.dart';
import 'package:yaskapp_mobile/src/features/account_deletion/account_deletion_receipt_store.dart';

void main() {
  test('persists receipt before acceptance request', () async {
    final store = _RecordingReceiptStore();
    final api = _FakeApi(
      onDelete: () async {
        expect(store.receipt, isNotNull);
        return _status(AccountDeletionStatus.pending);
      },
    );
    final controller = AccountDeletionController(api: api, receiptStore: store);
    addTearDown(controller.dispose);

    await controller.verify(login: 'alice', password: 'secret');
    await controller.acceptDeletion();

    expect(store.receipt?.statusToken, 'status-token');
    expect(controller.state.status?.status, AccountDeletionStatus.pending);
  });

  test(
      'timeout after acceptance checks receipt status and never treats 401 as complete',
      () async {
    final store = _RecordingReceiptStore();
    final api = _FakeApi(
      onDelete: () => throw TimeoutException('response lost'),
      onStatus: () async => _status(AccountDeletionStatus.processing),
    );
    final controller = AccountDeletionController(api: api, receiptStore: store);
    addTearDown(controller.dispose);

    await controller.verify(login: 'alice', password: 'secret');
    await controller.acceptDeletion();

    expect(api.statusCalls, 1);
    expect(controller.state.status?.status, AccountDeletionStatus.processing);
    expect(store.clearCalls, 0);
  });

  test('keeps receipt on status 401 and network failure', () async {
    final store = _RecordingReceiptStore();
    final api = _FakeApi(
        onStatus: () => throw const AccountDeletionApiException('Unauthorized',
            statusCode: 401, code: 'unauthorized'));
    final controller = AccountDeletionController(api: api, receiptStore: store);
    addTearDown(controller.dispose);

    await controller.restoreReceipt();

    expect(controller.state.receipt, isNotNull);
    expect(controller.state.error, isNotNull);
    expect(controller.state.acceptanceUncertain, isTrue);
    expect(store.clearCalls, 0);
  });

  test('keeps receipt when acceptance and its status check both time out',
      () async {
    final store = _RecordingReceiptStore();
    final api = _FakeApi(
      onDelete: () => throw TimeoutException('response lost'),
      onStatus: () => throw TimeoutException('status offline'),
    );
    final controller = AccountDeletionController(api: api, receiptStore: store);
    addTearDown(controller.dispose);

    await controller.verify(login: 'alice', password: 'secret');
    await controller.acceptDeletion();

    expect(controller.state.receipt, isNotNull);
    expect(controller.state.error, contains('receipt is saved'));
    expect(controller.state.acceptanceUncertain, isTrue);
    expect(store.clearCalls, 0);
  });

  test('removes receipt only after verified completed status', () async {
    final store = _RecordingReceiptStore();
    final api = _FakeApi(
        onStatus: () async => _status(AccountDeletionStatus.completed));
    final controller = AccountDeletionController(api: api, receiptStore: store);
    addTearDown(controller.dispose);

    await controller.restoreReceipt();

    expect(store.clearCalls, 1);
    expect(controller.state.status?.status, AccountDeletionStatus.completed);
  });

  test('restores a persisted receipt after restart and checks status',
      () async {
    final store = _RecordingReceiptStore();
    final api =
        _FakeApi(onStatus: () async => _status(AccountDeletionStatus.retrying));
    final controller = AccountDeletionController(api: api, receiptStore: store);
    addTearDown(controller.dispose);

    await controller.restoreReceipt();

    expect(controller.state.receipt?.operationId, 'op-1');
    expect(controller.state.status?.status, AccountDeletionStatus.retrying);
    expect(store.clearCalls, 0);
  });

  test('discarding an unaccepted receipt removes it without deleting',
      () async {
    final store = _RecordingReceiptStore();
    final api = _FakeApi();
    final controller = AccountDeletionController(api: api, receiptStore: store);
    addTearDown(controller.dispose);

    await controller.restoreReceipt();
    expect(controller.state.status?.status, AccountDeletionStatus.notStarted);

    await controller.discardPreparedReceipt();

    expect(store.receipt, isNull);
    expect(store.clearCalls, 1);
    expect(controller.state.receipt, isNull);
  });

  test('ignores repeated acceptance while a request is in flight', () async {
    final store = _RecordingReceiptStore();
    final request = Completer<AccountDeletionStatusResponse>();
    var deleteCalls = 0;
    final api = _FakeApi(onDelete: () {
      deleteCalls++;
      return request.future;
    });
    final controller = AccountDeletionController(api: api, receiptStore: store);
    addTearDown(controller.dispose);

    await controller.verify(login: 'alice', password: 'secret');
    final first = controller.acceptDeletion();
    final second = controller.acceptDeletion();
    request.complete(_status(AccountDeletionStatus.pending));
    await Future.wait([first, second]);

    expect(deleteCalls, 1);
  });
}

AccountDeletionStatusResponse _status(AccountDeletionStatus status) =>
    AccountDeletionStatusResponse(
      operationId: 'op-1',
      status: status,
      acceptedAt: status == AccountDeletionStatus.notStarted
          ? null
          : DateTime.utc(2026, 10, 13),
      deadlineAt: DateTime.utc(2026, 10, 14),
      completedAt: status == AccountDeletionStatus.completed
          ? DateTime.utc(2026, 10, 13, 0, 5)
          : null,
    );

class _RecordingReceiptStore extends AccountDeletionReceiptStore {
  AccountDeletionReceipt? receipt = AccountDeletionReceipt(
    operationId: 'op-1',
    deletionToken: 'delete-token',
    statusToken: 'status-token',
    deletionTokenExpiresAt: DateTime.utc(2030, 10, 13, 12),
    statusTokenExpiresAt: DateTime.utc(2030, 10, 15, 12),
  );
  int clearCalls = 0;

  @override
  Future<AccountDeletionReceipt?> read() async => receipt;
  @override
  Future<void> save(AccountDeletionReceipt value) async => receipt = value;
  @override
  Future<void> clear() async {
    clearCalls++;
    receipt = null;
  }
}

class _FakeApi extends AccountDeletionApi {
  _FakeApi({this.onDelete, this.onStatus});
  final Future<AccountDeletionStatusResponse> Function()? onDelete;
  final Future<AccountDeletionStatusResponse> Function()? onStatus;
  int statusCalls = 0;

  @override
  Future<AccountDeletionVerification> verify({
    String? accessToken,
    String? login,
    required String password,
  }) async =>
      AccountDeletionVerification(
        operationId: 'op-1',
        deletionToken: 'delete-token',
        statusToken: 'status-token',
        deletionTokenExpiresAt: DateTime.utc(2030, 10, 13, 12),
        statusTokenExpiresAt: DateTime.utc(2030, 10, 15, 12),
      );

  @override
  Future<AccountDeletionStatusResponse> deleteAccount({
    required String deletionToken,
  }) async =>
      onDelete?.call() ?? _status(AccountDeletionStatus.pending);

  @override
  Future<AccountDeletionStatusResponse> getStatus({
    required String statusToken,
  }) {
    statusCalls++;
    return onStatus?.call() ??
        Future.value(_status(AccountDeletionStatus.notStarted));
  }
}
