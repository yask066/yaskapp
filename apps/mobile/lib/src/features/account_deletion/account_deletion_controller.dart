import 'dart:async';

import 'package:flutter/foundation.dart';

import 'account_deletion_api_client.dart';
import 'account_deletion_receipt_store.dart';

typedef AccountDeletionAccepted = Future<void> Function(
  AccountDeletionReceipt receipt,
);

class AccountDeletionState {
  const AccountDeletionState({
    this.receipt,
    this.status,
    this.error,
    this.message,
    this.isSubmitting = false,
    this.isLoading = false,
    this.acceptanceUncertain = false,
  });

  final AccountDeletionReceipt? receipt;
  final AccountDeletionStatusResponse? status;
  final String? error;
  final String? message;
  final bool isSubmitting;
  final bool isLoading;
  final bool acceptanceUncertain;

  bool get isAccepted =>
      status?.acceptedAt != null ||
      switch (status?.status) {
        AccountDeletionStatus.pending ||
        AccountDeletionStatus.processing ||
        AccountDeletionStatus.retrying ||
        AccountDeletionStatus.completed =>
          true,
        _ => false,
      };

  AccountDeletionState copyWith({
    AccountDeletionReceipt? receipt,
    bool clearReceipt = false,
    AccountDeletionStatusResponse? status,
    bool clearStatus = false,
    String? error,
    bool clearError = false,
    String? message,
    bool clearMessage = false,
    bool? isSubmitting,
    bool? isLoading,
    bool? acceptanceUncertain,
  }) =>
      AccountDeletionState(
        receipt: clearReceipt ? null : receipt ?? this.receipt,
        status: clearStatus ? null : status ?? this.status,
        error: clearError ? null : error ?? this.error,
        message: clearMessage ? null : message ?? this.message,
        isSubmitting: isSubmitting ?? this.isSubmitting,
        isLoading: isLoading ?? this.isLoading,
        acceptanceUncertain: acceptanceUncertain ?? this.acceptanceUncertain,
      );
}

class AccountDeletionController extends ChangeNotifier {
  AccountDeletionController({
    required AccountDeletionApi api,
    required AccountDeletionReceiptStore receiptStore,
    this.onAccepted,
  })  : _api = api,
        _receiptStore = receiptStore;

  final AccountDeletionApi _api;
  final AccountDeletionReceiptStore _receiptStore;
  final AccountDeletionAccepted? onAccepted;
  AccountDeletionState _state = const AccountDeletionState();
  bool _acceptedCallbackCalled = false;
  int _requestEpoch = 0;

  AccountDeletionState get state => _state;

  Future<void> verify({
    String? accessToken,
    String? login,
    required String password,
  }) async {
    if (_state.isSubmitting || password.isEmpty) return;
    _set(_state.copyWith(
      isSubmitting: true,
      clearError: true,
      clearMessage: true,
    ));
    try {
      final verification = await _api
          .verify(
            accessToken: accessToken,
            login: login,
            password: password,
          )
          .timeout(const Duration(seconds: 12));
      final receipt = AccountDeletionReceipt(
        operationId: verification.operationId,
        deletionToken: verification.deletionToken,
        statusToken: verification.statusToken,
        deletionTokenExpiresAt: verification.deletionTokenExpiresAt,
        statusTokenExpiresAt: verification.statusTokenExpiresAt,
      );
      await _receiptStore.save(receipt);
      if (_state.isSubmitting) {
        _set(_state.copyWith(
          receipt: receipt,
          status: const AccountDeletionStatusResponse(
            operationId: '',
            status: AccountDeletionStatus.notStarted,
            acceptedAt: null,
            deadlineAt: null,
            completedAt: null,
          ),
          clearStatus: true,
          isSubmitting: false,
          message: 'Identity verified. Confirm deletion to continue.',
        ));
      }
    } on AccountDeletionApiException catch (error) {
      _set(_state.copyWith(
        isSubmitting: false,
        error: error.code == 'invalid_credentials'
            ? 'The password is incorrect.'
            : error.message,
      ));
    } catch (_) {
      _set(_state.copyWith(
        isSubmitting: false,
        error: 'Could not verify your account. Please try again.',
      ));
    }
  }

  Future<void> acceptDeletion() async {
    final receipt = _state.receipt;
    if (_state.isSubmitting || receipt == null) return;
    if (!receipt.deletionTokenExpiresAt.isAfter(DateTime.now().toUtc())) {
      _set(_state.copyWith(
          error: 'Verification expired. Verify your password again.'));
      return;
    }
    final epoch = ++_requestEpoch;
    _set(_state.copyWith(
      isSubmitting: true,
      acceptanceUncertain: true,
      clearError: true,
      clearMessage: true,
    ));
    try {
      final response = await _api
          .deleteAccount(deletionToken: receipt.deletionToken)
          .timeout(const Duration(seconds: 12));
      if (epoch != _requestEpoch) return;
      await _applyStatus(response);
    } catch (_) {
      if (epoch != _requestEpoch) return;
      // A lost DELETE response is ambiguous; only the receipt status endpoint can
      // establish whether the server accepted the operation.
      await _checkStatus(receipt, epoch: epoch, submitting: true);
    }
  }

  Future<void> restoreReceipt() async {
    if (_state.isLoading) return;
    _set(_state.copyWith(isLoading: true, clearError: true));
    try {
      final receipt = await _receiptStore.read();
      if (receipt == null) {
        _set(_state.copyWith(
          clearReceipt: true,
          isLoading: false,
          message: 'No active deletion receipt was found.',
        ));
        return;
      }
      _set(_state.copyWith(
        receipt: receipt,
        isLoading: false,
        acceptanceUncertain: true,
      ));
      await refreshStatus();
    } catch (_) {
      _set(_state.copyWith(
        isLoading: false,
        error:
            'Secure storage is unavailable. Your deletion status is unknown.',
      ));
    }
  }

  Future<void> discardPreparedReceipt() async {
    final receipt = _state.receipt;
    if (receipt == null ||
        _state.isAccepted ||
        _state.acceptanceUncertain ||
        _state.isSubmitting ||
        _state.isLoading) {
      return;
    }
    ++_requestEpoch;
    await _receiptStore.clear();
    _set(_state.copyWith(
      clearReceipt: true,
      clearStatus: true,
      clearError: true,
      clearMessage: true,
    ));
  }

  Future<void> refreshStatus() async {
    if (_state.isLoading || _state.isSubmitting) return;
    final receipt = _state.receipt ?? await _receiptStore.read();
    if (receipt == null) return;
    _set(_state.copyWith(isLoading: true, clearError: true));
    if (!receipt.statusTokenExpiresAt.isAfter(DateTime.now().toUtc())) {
      await _receiptStore.clear();
      _set(_state.copyWith(
        clearReceipt: true,
        clearStatus: true,
        isLoading: false,
        acceptanceUncertain: false,
        message:
            'The deletion receipt expired. The server continues processing any accepted deletion.',
      ));
      return;
    }
    final epoch = ++_requestEpoch;
    await _checkStatus(receipt, epoch: epoch, submitting: false);
  }

  Future<void> _checkStatus(
    AccountDeletionReceipt receipt, {
    required int epoch,
    required bool submitting,
  }) async {
    try {
      final response = await _api
          .getStatus(statusToken: receipt.statusToken)
          .timeout(const Duration(seconds: 12));
      if (epoch != _requestEpoch) return;
      await _applyStatus(response, submitting: submitting);
    } on AccountDeletionApiException catch (error) {
      if (epoch != _requestEpoch) return;
      _set(_state.copyWith(
        isSubmitting: false,
        isLoading: false,
        error: error.code == 'unauthorized'
            ? 'Could not verify deletion status. Your receipt is saved.'
            : 'Could not check deletion status. Your receipt is saved.',
      ));
    } catch (_) {
      if (epoch != _requestEpoch) return;
      _set(_state.copyWith(
        isSubmitting: false,
        isLoading: false,
        error: 'Could not check deletion status. Your receipt is saved.',
      ));
    }
  }

  Future<void> _applyStatus(
    AccountDeletionStatusResponse response, {
    bool submitting = false,
  }) async {
    if (response.status == AccountDeletionStatus.completed) {
      await _receiptStore.clear();
      _set(_state.copyWith(
        status: response,
        clearReceipt: true,
        isSubmitting: false,
        isLoading: false,
        acceptanceUncertain: false,
        clearError: true,
      ));
      return;
    }
    _set(_state.copyWith(
      status: response,
      isSubmitting: false,
      isLoading: false,
      acceptanceUncertain: false,
      clearError: true,
      message: response.status == AccountDeletionStatus.notStarted
          ? null
          : 'Deletion is ${response.status.wireValue}. You can safely leave this screen.',
      clearMessage: response.status == AccountDeletionStatus.notStarted,
    ));
    final receipt = _state.receipt;
    if (_state.isAccepted && receipt != null && !_acceptedCallbackCalled) {
      _acceptedCallbackCalled = true;
      await onAccepted?.call(receipt);
    } else if (submitting && receipt != null && response.acceptedAt != null) {
      _acceptedCallbackCalled = true;
      await onAccepted?.call(receipt);
    }
  }

  void _set(AccountDeletionState state) {
    _state = state;
    notifyListeners();
  }
}
