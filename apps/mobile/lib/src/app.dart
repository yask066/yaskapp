import 'package:flutter/material.dart';

import 'features/auth/auth_api_client.dart';
import 'features/auth/auth_screen.dart';
import 'features/auth/auth_session.dart';
import 'features/auth/auth_session_store.dart';
import 'features/home/home_screen.dart';
import 'features/polls/polls_api_client.dart';

class YaskappApp extends StatefulWidget {
  const YaskappApp({
    super.key,
    this.authApiClient,
    this.authSessionStore,
    this.pollsApiClient,
  });

  final AuthApiClient? authApiClient;
  final AuthSessionStore? authSessionStore;
  final PollsApiClient? pollsApiClient;

  @override
  State<YaskappApp> createState() => _YaskappAppState();
}

class _YaskappAppState extends State<YaskappApp> {
  late final AuthApiClient _authApiClient;
  late final AuthSessionStore _authSessionStore;
  late final bool _ownsAuthApiClient;
  AuthSession? _session;
  var _isBootstrapping = true;

  @override
  void initState() {
    super.initState();
    _ownsAuthApiClient = widget.authApiClient == null;
    _authApiClient = widget.authApiClient ?? AuthApiClient();
    _authSessionStore =
        widget.authSessionStore ?? const SecureAuthSessionStore();
    _bootstrapSession();
  }

  @override
  void dispose() {
    if (_ownsAuthApiClient) {
      _authApiClient.close();
    }

    super.dispose();
  }

  Future<void> _bootstrapSession() async {
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

    if (!mounted) {
      return;
    }

    setState(() {
      _session = session;
    });
  }

  Future<void> _clearSession() async {
    await _authSessionStore.clear();

    if (!mounted) {
      return;
    }

    setState(() {
      _session = null;
    });
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
      home: _isBootstrapping
          ? const _AuthBootstrapScreen()
          : session == null
              ? AuthScreen(
                  authApiClient: _authApiClient,
                  onAuthenticated: _setSession,
                )
              : HomeScreen(
                  session: session,
                  authApiClient: _authApiClient,
                  onLogout: _clearSession,
                  onUserUpdated: _updateUser,
                  pollsApiClient: widget.pollsApiClient,
                ),
    );
  }
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
