import 'dart:async';

import 'package:flutter/material.dart';

import 'account_deletion_api_client.dart';
import 'account_deletion_controller.dart';
import 'account_deletion_receipt_store.dart';

class AccountDeletionScreen extends StatefulWidget {
  const AccountDeletionScreen({
    super.key,
    this.accessToken,
    this.controller,
    this.receiptStore,
    this.onCancel,
    this.onAccepted,
    this.onCompleted,
    this.localCleanupError,
    this.onRetryLocalCleanup,
    this.completed = false,
  });

  final String? accessToken;
  final AccountDeletionController? controller;
  final AccountDeletionReceiptStore? receiptStore;
  final VoidCallback? onCancel;
  final AccountDeletionAccepted? onAccepted;
  final VoidCallback? onCompleted;
  final String? localCleanupError;
  final VoidCallback? onRetryLocalCleanup;
  final bool completed;

  @override
  State<AccountDeletionScreen> createState() => _AccountDeletionScreenState();
}

class _AccountDeletionScreenState extends State<AccountDeletionScreen> {
  final _loginController = TextEditingController();
  final _passwordController = TextEditingController();
  AccountDeletionApiClient? _api;
  late final bool _ownsApi;
  late final AccountDeletionController _controller;
  late final bool _ownsController;
  var _confirmed = false;
  var _completedCallbackCalled = false;
  Timer? _pollTimer;
  var _pollDelaySeconds = 2;

  bool get _deletionOnly => widget.accessToken == null;

  @override
  void initState() {
    super.initState();
    _ownsController = widget.controller == null;
    _ownsApi = widget.controller == null;
    if (_ownsApi) _api = AccountDeletionApiClient();
    _controller = widget.controller ??
        AccountDeletionController(
          api: _api!,
          receiptStore:
              widget.receiptStore ?? const SecureAccountDeletionReceiptStore(),
          onAccepted: widget.onAccepted,
        );
    _controller.addListener(_onStateChanged);
    _loginController.addListener(_onFormChanged);
    _passwordController.addListener(_onFormChanged);
    if (widget.completed) {
      _completedCallbackCalled = true;
    } else {
      unawaited(_controller.restoreReceipt());
    }
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _controller.removeListener(_onStateChanged);
    _loginController.removeListener(_onFormChanged);
    _passwordController.removeListener(_onFormChanged);
    if (_ownsController) _controller.dispose();
    if (_ownsApi) _api!.close();
    _loginController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  void _onFormChanged() {
    if (mounted) setState(() {});
  }

  void _onStateChanged() {
    final state = _controller.state;
    if ((state.isAccepted || state.acceptanceUncertain) &&
        state.status?.status != AccountDeletionStatus.completed) {
      _scheduleStatusCheck();
    } else {
      _pollTimer?.cancel();
      _pollTimer = null;
    }
    if (state.status?.status == AccountDeletionStatus.completed &&
        !_completedCallbackCalled) {
      _completedCallbackCalled = true;
      widget.onCompleted?.call();
    }
    if (mounted) setState(() {});
  }

  void _scheduleStatusCheck() {
    if (_pollTimer != null) return;
    _pollTimer = Timer(Duration(seconds: _pollDelaySeconds), () {
      _pollTimer = null;
      _pollDelaySeconds = (_pollDelaySeconds * 2).clamp(2, 30);
      unawaited(_controller.refreshStatus());
    });
  }

  Future<void> _submit() async {
    if (!_confirmed) return;
    final state = _controller.state;
    if (state.receipt != null &&
        !state.isAccepted &&
        state.receipt!.deletionTokenExpiresAt.isAfter(DateTime.now().toUtc())) {
      await _controller.acceptDeletion();
      return;
    }
    if (_passwordController.text.isEmpty) return;
    await _controller.verify(
      accessToken: widget.accessToken,
      login: _deletionOnly ? _loginController.text.trim() : null,
      password: _passwordController.text,
    );
    _passwordController.clear();
    if (!mounted) return;
    if (_controller.state.message ==
        'Identity verified. Confirm deletion to continue.') {
      await _controller.acceptDeletion();
    }
  }

  Future<void> _cancel() async {
    await _controller.discardPreparedReceipt();
    if (!mounted) return;
    if (widget.onCancel != null) {
      widget.onCancel!();
    } else {
      Navigator.of(context).maybePop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = _controller.state;
    final isCompleted = widget.completed ||
        state.status?.status == AccountDeletionStatus.completed;
    final receiptPending = state.isAccepted || state.acceptanceUncertain;
    final validPreparedReceipt = state.receipt != null &&
        !state.isAccepted &&
        state.receipt!.deletionTokenExpiresAt.isAfter(DateTime.now().toUtc());
    final showForm = !receiptPending && !isCompleted;

    return PopScope<void>(
      canPop: !receiptPending && !state.isSubmitting,
      child: Scaffold(
        backgroundColor: const Color(0xFFF7F8FC),
        appBar: AppBar(
          title: const Text('Delete account'),
          backgroundColor: Colors.white,
          surfaceTintColor: Colors.transparent,
          elevation: 0,
          leading: receiptPending ||
                  state.isSubmitting ||
                  widget.onCancel == null && !Navigator.of(context).canPop()
              ? null
              : IconButton(
                  tooltip: 'Back',
                  icon: const Icon(Icons.arrow_back),
                  onPressed: _cancel,
                ),
        ),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              if (widget.localCleanupError != null) ...[
                _MessageCard(
                  message: widget.localCleanupError!,
                  isError: true,
                ),
                if (widget.onRetryLocalCleanup != null)
                  TextButton(
                    onPressed: widget.onRetryLocalCleanup,
                    child: const Text('Retry secure cleanup'),
                  ),
              ],
              if (isCompleted) ...[
                const Icon(Icons.check_circle_outline,
                    size: 54, color: Color(0xFF16803C)),
                const SizedBox(height: 16),
                Text(
                  'Account deletion completed',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 12),
                const Text(
                  'Your account and its active data have been deleted.',
                  textAlign: TextAlign.center,
                ),
              ] else if (receiptPending) ...[
                _MessageCard(
                  message: state.isAccepted
                      ? 'Your account is closed. Deletion is being processed. '
                          'You can safely leave this screen; this receipt works after restart.'
                      : 'Checking whether the server accepted your request. '
                          'Your receipt is saved. Keep account data locked until status is confirmed.',
                ),
                if (state.status != null)
                  Text('Status: ${state.status!.status.wireValue}',
                      textAlign: TextAlign.center),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: state.isLoading || state.isSubmitting
                      ? null
                      : () => unawaited(_controller.refreshStatus()),
                  icon: const Icon(Icons.refresh),
                  label: const Text('Check status'),
                ),
              ] else if (showForm) ...[
                const Text(
                  'Your profile, avatar, polls, comments, votes, likes, subscriptions, '
                  'and notification settings will be deleted. Discussions and actions '
                  'by other people inside polls you created will be deleted too. '
                  'This action cannot be undone.',
                  style: TextStyle(fontSize: 16, height: 1.5),
                ),
                const SizedBox(height: 20),
                if (_deletionOnly && !validPreparedReceipt) ...[
                  TextField(
                    controller: _loginController,
                    enabled: !state.isSubmitting,
                    keyboardType: TextInputType.emailAddress,
                    autofillHints: const [AutofillHints.username],
                    decoration: const InputDecoration(
                      labelText: 'Email or username',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                ],
                if (!validPreparedReceipt)
                  TextField(
                    controller: _passwordController,
                    enabled: !state.isSubmitting,
                    obscureText: true,
                    autofillHints: const [AutofillHints.password],
                    decoration: const InputDecoration(
                      labelText: 'Current password',
                      border: OutlineInputBorder(),
                    ),
                  ),
                const SizedBox(height: 12),
                CheckboxListTile(
                  value: _confirmed,
                  onChanged: state.isSubmitting
                      ? null
                      : (value) => setState(() => _confirmed = value ?? false),
                  controlAffinity: ListTileControlAffinity.leading,
                  contentPadding: EdgeInsets.zero,
                  title: const Text(
                    'I understand that deleting my account is permanent.',
                  ),
                ),
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: state.isSubmitting ||
                          state.isLoading ||
                          !_confirmed ||
                          (!validPreparedReceipt &&
                              _passwordController.text.isEmpty) ||
                          (_deletionOnly &&
                              !validPreparedReceipt &&
                              _loginController.text.trim().isEmpty)
                      ? null
                      : () => unawaited(_submit()),
                  child: state.isSubmitting
                      ? const SizedBox.square(
                          dimension: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(validPreparedReceipt
                          ? 'Confirm deletion'
                          : 'Delete account'),
                ),
                TextButton(
                  onPressed: state.isSubmitting ? null : _cancel,
                  child: const Text('Cancel'),
                ),
              ],
              if (state.isLoading) ...[
                const SizedBox(height: 20),
                Center(
                  child: Semantics(
                    label: 'Checking deletion status',
                    liveRegion: true,
                    child: const CircularProgressIndicator(),
                  ),
                ),
              ],
              if (state.error != null) ...[
                const SizedBox(height: 16),
                _MessageCard(message: state.error!, isError: true),
              ],
              if (state.message != null && !receiptPending) ...[
                const SizedBox(height: 16),
                _MessageCard(message: state.message!),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _MessageCard extends StatelessWidget {
  const _MessageCard({required this.message, this.isError = false});

  final String message;
  final bool isError;

  @override
  Widget build(BuildContext context) {
    final color = isError ? const Color(0xFFB42318) : const Color(0xFF344054);
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: isError ? const Color(0xFFFEF3F2) : Colors.white,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(message, style: TextStyle(color: color, height: 1.4)),
      ),
    );
  }
}
