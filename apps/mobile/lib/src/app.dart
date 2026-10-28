import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_cache_manager/flutter_cache_manager.dart';

import 'core/motion/motion_settings.dart';
import 'features/auth/auth_api_client.dart';
import 'features/auth/auth_screen.dart';
import 'features/auth/auth_session.dart';
import 'features/auth/auth_session_store.dart';
import 'features/home/home_screen.dart';
import 'features/notifications/firebase_push_service.dart';
import 'features/notifications/notification_devices_api_client.dart';
import 'features/polls/polls_api_client.dart';
import 'features/realtime/realtime_session.dart';
import 'features/realtime/realtime_client.dart';
import 'features/polls/poll_state_store.dart';
import 'features/polls/poll_state_scope.dart';
import 'features/account_deletion/account_deletion_receipt_store.dart';
import 'features/account_deletion/account_deletion_screen.dart';
import 'features/search/search_history.dart';

class YaskappApp extends StatefulWidget {
  const YaskappApp({
    super.key,
    this.authApiClient,
    this.authSessionStore,
    this.accountDeletionReceiptStore,
    this.pollsApiClient,
    this.reactionsMotion = false,
    this.entryMotion = false,
    this.feedPaginationEnabled = true,
  });

  final AuthApiClient? authApiClient;
  final AuthSessionStore? authSessionStore;
  final AccountDeletionReceiptStore? accountDeletionReceiptStore;
  final PollsApiClient? pollsApiClient;
  final bool reactionsMotion;
  final bool entryMotion;
  final bool feedPaginationEnabled;

  @override
  State<YaskappApp> createState() => _YaskappAppState();
}

class _YaskappAppState extends State<YaskappApp> with WidgetsBindingObserver {
  late final AuthApiClient _authApiClient;
  late final AuthSessionStore _authSessionStore;
  late final AccountDeletionReceiptStore _accountDeletionReceiptStore;
  late final NotificationDevicesApiClient _notificationDevicesApiClient;
  late final FirebasePushService _firebasePushService;
  StreamSubscription<String>? _pushTokenSubscription;
  String? _latestPushToken;
  late final bool _ownsAuthApiClient;
  AuthSession? _session;
  late final RealtimeSession _realtimeSession;
  late final PollStateStore _pollStateStore;
  StreamSubscription<AccountDeletedRealtimeEvent>? _accountDeletedSubscription;
  Timer? _sessionValidationTimer;
  var _sessionValidationInFlight = false;
  var _sessionGeneration = 0;
  var _isBootstrapping = true;
  var _deletionOnly = false;
  var _remoteDeletionCleanupPending = false;
  var _receiptStorageFailed = false;
  Future<void>? _accountCleanupFuture;
  var _completionPending = false;
  var _navigationEpoch = 0;
  String? _deletionCleanupError;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _ownsAuthApiClient = widget.authApiClient == null;
    _authApiClient = widget.authApiClient ?? AuthApiClient();
    _authSessionStore =
        widget.authSessionStore ?? const SecureAuthSessionStore();
    _accountDeletionReceiptStore = widget.accountDeletionReceiptStore ??
        const SecureAccountDeletionReceiptStore();
    _notificationDevicesApiClient = NotificationDevicesApiClient();
    _firebasePushService = FirebasePushService();
    _pollStateStore = PollStateStore(viewerId: null);
    _realtimeSession = RealtimeSession(
      reconcilePolls: _pollStateStore.reconcileLoadedPolls,
    );
    _accountDeletedSubscription =
        _realtimeSession.accountDeletedEvents.listen((_) {
      unawaited(_handleRemoteAccountDeleted());
    });
    _initializePushRegistration();
    _bootstrapSession();
  }

  @override
  void dispose() {
    if (_ownsAuthApiClient) {
      _authApiClient.close();
    }
    _pushTokenSubscription?.cancel();
    _accountDeletedSubscription?.cancel();
    _sessionValidationTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _notificationDevicesApiClient.close();
    unawaited(_realtimeSession.close());
    _pollStateStore.dispose();

    super.dispose();
  }

  Future<void> _bootstrapSession() async {
    try {
      final receipt = await _accountDeletionReceiptStore
          .read()
          .timeout(const Duration(seconds: 5));
      if (receipt != null) {
        if (mounted) {
          setState(() {
            _deletionOnly = true;
            _isBootstrapping = false;
          });
        }
        return;
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _receiptStorageFailed = true;
          _isBootstrapping = false;
        });
      }
      return;
    }

    try {
      final accessToken = await _authSessionStore
          .readAccessToken()
          .timeout(const Duration(seconds: 5));

      if (accessToken == null || accessToken.isEmpty) {
        return;
      }

      final user = await _authApiClient
          .me(accessToken: accessToken)
          .timeout(const Duration(seconds: 8));

      if (!mounted) {
        return;
      }

      setState(() {
        _session = AuthSession(
          user: user,
          accessToken: accessToken,
          tokenType: 'Bearer',
          expiresIn: 'persisted',
        );
      });
      _pollStateStore.clear(viewerId: user.id);
      unawaited(_realtimeSession.start(_session!));
      _startSessionValidation();
      unawaited(_registerPushToken(accessToken));
    } on AuthApiException catch (error) {
      if (error.statusCode == 401) {
        await _handleRemoteAccountDeleted();
      } else {
        await _authSessionStore.clear();
      }
    } catch (_) {
      await _authSessionStore.clear();
    } finally {
      if (mounted) {
        setState(() {
          _isBootstrapping = false;
        });
      }
    }
  }

  Future<void> _setSession(AuthSession session) async {
    await _authSessionStore.saveAccessToken(session.accessToken);
    _pollStateStore.clear(viewerId: session.user.id);

    if (!mounted) {
      return;
    }

    setState(() {
      _session = session;
      _navigationEpoch++;
      _sessionGeneration++;
    });
    unawaited(_realtimeSession.start(session));
    _startSessionValidation();
    unawaited(_registerPushToken(session.accessToken));
  }

  void _startSessionValidation() {
    _sessionValidationTimer?.cancel();
    _sessionValidationTimer = Timer.periodic(const Duration(minutes: 1), (_) {
      unawaited(_validateActiveSession());
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(_validateActiveSession());
    }
  }

  Future<void> _validateActiveSession() async {
    final session = _session;
    final sessionGeneration = _sessionGeneration;
    if (session == null ||
        _deletionOnly ||
        _sessionValidationInFlight ||
        !mounted) {
      return;
    }
    _sessionValidationInFlight = true;
    try {
      await _authApiClient
          .me(accessToken: session.accessToken)
          .timeout(const Duration(seconds: 8));
    } on AuthApiException catch (error) {
      if (error.statusCode == 401 &&
          identical(_session?.accessToken, session.accessToken) &&
          _sessionGeneration == sessionGeneration) {
        await _handleRemoteAccountDeleted();
      }
    } catch (_) {
      // A network failure does not establish that the account was deleted.
    } finally {
      _sessionValidationInFlight = false;
    }
  }

  Future<void> _clearSession() async {
    _sessionGeneration++;
    _sessionValidationTimer?.cancel();
    _sessionValidationTimer = null;
    final token = _latestPushToken;
    if (token != null) {
      try {
        await _notificationDevicesApiClient.revoke(
          accessToken: _session?.accessToken ?? '',
          token: token,
        );
      } catch (_) {
        // Logout must still succeed if the API is temporarily unavailable.
      }
    }
    await _authSessionStore.clear();
    await _realtimeSession.stop();
    _pollStateStore.clear();

    if (!mounted) {
      return;
    }

    setState(() {
      _session = null;
      _navigationEpoch++;
    });
  }

  Future<void> _handleDeletionAccepted(AccountDeletionReceipt receipt) async {
    if (!mounted) return;
    setState(() {
      _session = null;
      _deletionOnly = true;
      _deletionCleanupError = null;
      _navigationEpoch++;
    });
    await _clearAccountData();
  }

  Future<void> _handleDeletionCompleted() async {
    await _clearAccountData();
    if (!mounted) return;
    if (_deletionCleanupError != null) {
      _completionPending = true;
      return;
    }
    _leaveDeletionOnlyMode();
  }

  Future<void> _retryDeletionCleanup() async {
    await _clearAccountData();
    if (mounted &&
        _remoteDeletionCleanupPending &&
        _deletionCleanupError == null) {
      _remoteDeletionCleanupPending = false;
      _leaveDeletionOnlyMode();
      return;
    }
    if (mounted && _completionPending && _deletionCleanupError == null) {
      _leaveDeletionOnlyMode();
    }
  }

  Future<void> _clearAccountData() async {
    final activeCleanup = _accountCleanupFuture;
    if (activeCleanup != null) return activeCleanup;
    final cleanup = _performAccountDataCleanup();
    _accountCleanupFuture = cleanup;
    try {
      await cleanup;
    } finally {
      if (identical(_accountCleanupFuture, cleanup)) {
        _accountCleanupFuture = null;
      }
    }
  }

  Future<void> _performAccountDataCleanup() async {
    final failures = <String>[];
    Future<void> attempt(String label, Future<void> Function() clear) async {
      try {
        await clear();
      } catch (_) {
        failures.add(label);
      }
    }

    // Revoke access in memory and clear the private navigation root before any
    // asynchronous local cleanup can fail or complete out of order.
    _pollStateStore.clear();
    await attempt('secure authentication token', _authSessionStore.clear);
    await attempt('realtime notification state', _realtimeSession.stop);
    await attempt(
      'search history',
      SecureSearchHistoryStore.clearAll,
    );
    await attempt('cached media', () async {
      await DefaultCacheManager().emptyCache();
      PaintingBinding.instance.imageCache.clear();
      PaintingBinding.instance.imageCache.clearLiveImages();
    });
    _latestPushToken = null;
    if (!mounted) return;
    setState(() {
      _deletionCleanupError = failures.isEmpty
          ? null
          : 'Secure cleanup could not finish: ${failures.join(', ')}. The server deletion remains active.';
    });
  }

  void _leaveDeletionOnlyMode() {
    setState(() {
      _deletionOnly = false;
      _receiptStorageFailed = false;
      _deletionCleanupError = null;
      _session = null;
      _completionPending = false;
      _navigationEpoch++;
    });
  }

  Future<void> _handleRemoteAccountDeleted() async {
    _sessionGeneration++;
    _sessionValidationTimer?.cancel();
    _sessionValidationTimer = null;
    if (mounted) {
      setState(() {
        _session = null;
        _deletionOnly = true;
        _remoteDeletionCleanupPending = true;
        _navigationEpoch++;
      });
    }
    await _clearAccountData();
    if (mounted && _deletionCleanupError == null) {
      _remoteDeletionCleanupPending = false;
      _leaveDeletionOnlyMode();
    }
  }

  void _initializePushRegistration() {
    try {
      _pushTokenSubscription = _firebasePushService.onTokenRefresh.listen(
        (token) {
          _latestPushToken = token;
          final accessToken = _session?.accessToken;
          if (accessToken != null) {
            unawaited(_registerPushToken(accessToken, token));
          }
        },
      );
    } catch (_) {
      // Firebase may be unavailable in local widget tests or unsupported builds.
    }
  }

  Future<void> _registerPushToken(String accessToken, [String? token]) async {
    try {
      final pushToken = token ?? await _firebasePushService.getToken();
      if (pushToken == null ||
          pushToken.isEmpty ||
          !Platform.isAndroid && !Platform.isIOS) {
        return;
      }
      _latestPushToken = pushToken;
      await _notificationDevicesApiClient.register(
        accessToken: accessToken,
        token: pushToken,
        platform: Platform.isIOS ? 'ios' : 'android',
      );
    } catch (_) {
      // Token registration is best-effort and will retry on the next refresh/login.
    }
  }

  void _updateUser(AuthUser user) {
    final session = _session;

    if (session == null) {
      return;
    }

    setState(() {
      _session = session.copyWith(user: user);
    });
  }

  @override
  Widget build(BuildContext context) {
    final session = _session;
    const brandColor = Color(0xFF566A9D);

    return MaterialApp(
      key: ValueKey(_navigationEpoch),
      title: 'Yaskapp',
      theme: ThemeData(
        colorScheme: const ColorScheme.light(
          primary: brandColor,
          onPrimary: Colors.white,
          primaryContainer: brandColor,
          onPrimaryContainer: Colors.white,
          secondary: brandColor,
          onSecondary: Colors.white,
          secondaryContainer: brandColor,
          onSecondaryContainer: Colors.white,
          tertiary: brandColor,
          onTertiary: Colors.white,
          tertiaryContainer: brandColor,
          onTertiaryContainer: Colors.white,
        ),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            backgroundColor: brandColor,
            foregroundColor: Colors.white,
          ),
        ),
        outlinedButtonTheme: OutlinedButtonThemeData(
          style: OutlinedButton.styleFrom(
            foregroundColor: brandColor,
            side: const BorderSide(color: brandColor),
          ),
        ),
        scaffoldBackgroundColor: const Color(0xFFF7F8FA),
        useMaterial3: true,
      ),
      debugShowCheckedModeBanner: false,
      builder: (context, child) => MotionSettingsScope(
        reactionsMotion: widget.reactionsMotion,
        entryMotion: widget.entryMotion,
        child: PollStateScope(
          store: _pollStateStore,
          child: child ?? const SizedBox.shrink(),
        ),
      ),
      home: _receiptStorageFailed
          ? _ReceiptRecoveryError(onRetry: () {
              setState(() {
                _receiptStorageFailed = false;
                _isBootstrapping = true;
              });
              unawaited(_bootstrapSession());
            })
          : _isBootstrapping
              ? const _AuthBootstrapScreen()
              : _deletionOnly
                  ? _remoteDeletionCleanupPending
                      ? _RemoteDeletionLockScreen(
                          error: _deletionCleanupError,
                          onRetry: _retryDeletionCleanup,
                        )
                      : AccountDeletionScreen(
                          receiptStore: _accountDeletionReceiptStore,
                          onAccepted: _handleDeletionAccepted,
                          onCompleted: () =>
                              unawaited(_handleDeletionCompleted()),
                          localCleanupError: _deletionCleanupError,
                          onRetryLocalCleanup: _retryDeletionCleanup,
                        )
                  : session == null
                      ? AuthScreen(
                          authApiClient: _authApiClient,
                          onAuthenticated: _setSession,
                          onAccountDeletionAccepted: _handleDeletionAccepted,
                          onAccountDeletionCompleted: () =>
                              unawaited(_handleDeletionCompleted()),
                        )
                      : HomeScreen(
                          session: session,
                          authApiClient: _authApiClient,
                          onLogout: _clearSession,
                          onUserUpdated: _updateUser,
                          pollsApiClient: widget.pollsApiClient,
                          realtimeSession: _realtimeSession,
                          pollStateStore: _pollStateStore,
                          onAccountDeletionAccepted: _handleDeletionAccepted,
                          onAccountDeletionCompleted: () =>
                              unawaited(_handleDeletionCompleted()),
                          feedPaginationEnabled: widget.feedPaginationEnabled,
                        ),
    );
  }
}

class _ReceiptRecoveryError extends StatelessWidget {
  const _ReceiptRecoveryError({required this.onRetry});
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'Secure deletion status is unavailable. Your account data stays locked until recovery is checked.',
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 16),
                FilledButton(onPressed: onRetry, child: const Text('Retry')),
              ],
            ),
          ),
        ),
      );
}

class _RemoteDeletionLockScreen extends StatelessWidget {
  const _RemoteDeletionLockScreen({
    required this.error,
    required this.onRetry,
  });

  final String? error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'This account was closed on another device. Secure local cleanup must finish before sign in.',
                  textAlign: TextAlign.center,
                ),
                if (error != null) ...[
                  const SizedBox(height: 12),
                  Text(error!, textAlign: TextAlign.center),
                ],
                const SizedBox(height: 16),
                FilledButton(
                    onPressed: onRetry, child: const Text('Retry cleanup')),
              ],
            ),
          ),
        ),
      );
}

class _AuthBootstrapScreen extends StatelessWidget {
  const _AuthBootstrapScreen();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: SafeArea(
        child: Center(
          child: SizedBox.square(
            dimension: 32,
            child: CircularProgressIndicator(strokeWidth: 3),
          ),
        ),
      ),
    );
  }
}
