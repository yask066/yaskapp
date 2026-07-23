import 'package:flutter/material.dart';

import 'auth_api_client.dart';
import 'auth_session.dart';

enum _AuthMode { login, register }

class AuthScreen extends StatefulWidget {
  const AuthScreen({
    required this.onAuthenticated,
    super.key,
    AuthApiClient? authApiClient,
  }) : _authApiClient = authApiClient;

  final ValueChanged<AuthSession> onAuthenticated;
  final AuthApiClient? _authApiClient;

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _usernameController = TextEditingController();
  final _loginController = TextEditingController();
  final _displayNameController = TextEditingController();
  final _passwordController = TextEditingController();

  late final AuthApiClient _authApiClient;
  late final bool _ownsAuthApiClient;
  var _mode = _AuthMode.login;
  var _isSubmitting = false;
  String? _errorMessage;

  bool get _isRegistering => _mode == _AuthMode.register;

  @override
  void initState() {
    super.initState();
    _ownsAuthApiClient = widget._authApiClient == null;
    _authApiClient = widget._authApiClient ?? AuthApiClient();
  }

  @override
  void dispose() {
    _emailController.dispose();
    _usernameController.dispose();
    _loginController.dispose();
    _displayNameController.dispose();
    _passwordController.dispose();

    if (_ownsAuthApiClient) {
      _authApiClient.close();
    }

    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    try {
      final session = _isRegistering
          ? await _authApiClient.register(
              email: _emailController.text.trim(),
              username: _usernameController.text.trim(),
              password: _passwordController.text,
              displayName: _displayNameController.text,
            )
          : await _authApiClient.login(
              login: _loginController.text.trim(),
              password: _passwordController.text,
            );

      if (!mounted) {
        return;
      }

      widget.onAuthenticated(session);
    } on AuthApiException catch (error) {
      setState(() {
        _errorMessage = error.message;
      });
    } catch (_) {
      setState(() {
        _errorMessage = 'Could not connect to the API.';
      });
    } finally {
      if (mounted) {
        setState(() {
          _isSubmitting = false;
        });
      }
    }
  }

  void _setMode(_AuthMode mode) {
    setState(() {
      _mode = mode;
      _errorMessage = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Icon(Icons.how_to_vote, color: colors.primary, size: 44),
                  const SizedBox(height: 16),
                  Text(
                    'Yaskapp',
                    textAlign: TextAlign.center,
                    style: Theme.of(context)
                        .textTheme
                        .headlineMedium
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Sign in to vote and create polls.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: colors.onSurfaceVariant),
                  ),
                  const SizedBox(height: 24),
                  SegmentedButton<_AuthMode>(
                    segments: const [
                      ButtonSegment(
                        value: _AuthMode.login,
                        icon: Icon(Icons.login),
                        label: Text('Login'),
                      ),
                      ButtonSegment(
                        value: _AuthMode.register,
                        icon: Icon(Icons.person_add_alt),
                        label: Text('Register'),
                      ),
                    ],
                    selected: {_mode},
                    onSelectionChanged: (selection) {
                      _setMode(selection.first);
                    },
                  ),
                  const SizedBox(height: 20),
                  Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (_isRegistering) ...[
                          TextFormField(
                            controller: _emailController,
                            keyboardType: TextInputType.emailAddress,
                            autofillHints: const [AutofillHints.email],
                            decoration: const InputDecoration(
                              labelText: 'Email',
                              prefixIcon: Icon(Icons.mail_outline),
                              border: OutlineInputBorder(),
                            ),
                            validator: _required,
                          ),
                          const SizedBox(height: 12),
                          TextFormField(
                            controller: _usernameController,
                            autofillHints: const [AutofillHints.username],
                            decoration: const InputDecoration(
                              labelText: 'Username',
                              prefixIcon: Icon(Icons.alternate_email),
                              border: OutlineInputBorder(),
                            ),
                            validator: _required,
                          ),
                          const SizedBox(height: 12),
                          TextFormField(
                            controller: _displayNameController,
                            decoration: const InputDecoration(
                              labelText: 'Display name',
                              prefixIcon: Icon(Icons.badge_outlined),
                              border: OutlineInputBorder(),
                            ),
                          ),
                        ] else ...[
                          TextFormField(
                            controller: _loginController,
                            autofillHints: const [
                              AutofillHints.username,
                              AutofillHints.email,
                            ],
                            decoration: const InputDecoration(
                              labelText: 'Email or username',
                              prefixIcon: Icon(Icons.person_outline),
                              border: OutlineInputBorder(),
                            ),
                            validator: _required,
                          ),
                        ],
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _passwordController,
                          obscureText: true,
                          autofillHints: const [AutofillHints.password],
                          decoration: const InputDecoration(
                            labelText: 'Password',
                            prefixIcon: Icon(Icons.lock_outline),
                            border: OutlineInputBorder(),
                          ),
                          validator: (value) {
                            if (value == null || value.isEmpty) {
                              return 'Required';
                            }

                            if (_isRegistering && value.length < 8) {
                              return 'Use at least 8 characters';
                            }

                            return null;
                          },
                        ),
                        if (_errorMessage != null) ...[
                          const SizedBox(height: 12),
                          Text(
                            _errorMessage!,
                            style: TextStyle(color: colors.error),
                          ),
                        ],
                        const SizedBox(height: 18),
                        FilledButton.icon(
                          onPressed: _isSubmitting ? null : _submit,
                          icon: _isSubmitting
                              ? const SizedBox.square(
                                  dimension: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : Icon(
                                  _isRegistering
                                      ? Icons.person_add_alt
                                      : Icons.login,
                                ),
                          label: Text(_isRegistering ? 'Register' : 'Login'),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

String? _required(String? value) {
  if (value == null || value.trim().isEmpty) {
    return 'Required';
  }

  return null;
}
