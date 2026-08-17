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
      final session = await (_isRegistering
              ? _authApiClient.register(
                  email: _emailController.text.trim(),
                  username: _usernameController.text.trim(),
                  password: _passwordController.text,
                  displayName: _displayNameController.text,
                )
              : _authApiClient.login(
                  login: _loginController.text.trim(),
                  password: _passwordController.text,
                ))
          .timeout(const Duration(seconds: 10));

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

  void _showUnavailable(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    const accentColor = Color(0xFF566A9D);
    const fieldFillColor = Color(0xFFE8EDF3);

    return Scaffold(
      backgroundColor: const Color(0xFFEFF3F8),
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            return SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(24, 18, 24, 28),
              child: Center(
                child: ConstrainedBox(
                  constraints: BoxConstraints(
                    minHeight: constraints.maxHeight - 46,
                    maxWidth: 520,
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                    Semantics(
                      label: 'Yaskapp',
                      image: true,
                      child: Image.asset(
                        'assets/branding/yaskapp_logo.png',
                        width: 210,
                        height: 112,
                        fit: BoxFit.contain,
                      ),
                    ),
                    const SizedBox(height: 22),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.fromLTRB(32, 34, 32, 30),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(30),
                        boxShadow: const [
                          BoxShadow(
                            color: Color(0x22000000),
                            blurRadius: 24,
                            offset: Offset(0, 12),
                          ),
                        ],
                      ),
                      child: Form(
                        key: _formKey,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(
                              _isRegistering ? 'REGISTER' : 'LOGIN',
                              textAlign: TextAlign.center,
                              style: Theme.of(context)
                                  .textTheme
                                  .headlineMedium
                                  ?.copyWith(
                                    color: accentColor,
                                    fontWeight: FontWeight.w700,
                                    letterSpacing: 1.2,
                                  ),
                            ),
                            const SizedBox(height: 28),
                            if (_isRegistering) ...[
                              TextFormField(
                                controller: _emailController,
                                keyboardType: TextInputType.emailAddress,
                                autofillHints: const [AutofillHints.email],
                                decoration: _fieldDecoration(
                                  'Email',
                                  Icons.mail_outline,
                                  fieldFillColor,
                                ),
                                validator: _required,
                              ),
                              const SizedBox(height: 14),
                              TextFormField(
                                controller: _usernameController,
                                autofillHints: const [AutofillHints.username],
                                decoration: _fieldDecoration(
                                  'Username',
                                  Icons.alternate_email,
                                  fieldFillColor,
                                ),
                                validator: _required,
                              ),
                              const SizedBox(height: 14),
                              TextFormField(
                                controller: _displayNameController,
                                decoration: _fieldDecoration(
                                  'Display name',
                                  Icons.badge_outlined,
                                  fieldFillColor,
                                ),
                              ),
                            ] else ...[
                              TextFormField(
                                controller: _loginController,
                                autofillHints: const [
                                  AutofillHints.username,
                                  AutofillHints.email,
                                ],
                                decoration: _fieldDecoration(
                                  'Email or username',
                                  Icons.person_outline,
                                  fieldFillColor,
                                ),
                                validator: _required,
                              ),
                            ],
                            const SizedBox(height: 14),
                            TextFormField(
                              controller: _passwordController,
                              obscureText: true,
                              autofillHints: const [AutofillHints.password],
                              decoration: _fieldDecoration(
                                'Password',
                                Icons.lock_outline,
                                fieldFillColor,
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
                            if (!_isRegistering)
                              Align(
                                alignment: Alignment.centerRight,
                                child: TextButton(
                                  onPressed: () => _showUnavailable(
                                    'Password recovery is not available yet.',
                                  ),
                                  style: TextButton.styleFrom(
                                    foregroundColor: const Color(0xFF566A9D),
                                    padding: const EdgeInsets.symmetric(
                                      vertical: 10,
                                    ),
                                  ),
                                  child: const Text('Forgot password?'),
                                ),
                              ),
                            if (_errorMessage != null) ...[
                              const SizedBox(height: 4),
                              Text(
                                _errorMessage!,
                                textAlign: TextAlign.center,
                                style: TextStyle(color: colors.error),
                              ),
                            ],
                            if (_isRegistering) ...[
                              const SizedBox(height: 12),
                              Text(
                                'Log in with',
                                textAlign: TextAlign.center,
                                style: Theme.of(context).textTheme.bodyLarge,
                              ),
                              const SizedBox(height: 12),
                              const _SocialButtons(),
                              const SizedBox(height: 20),
                            ],
                            const SizedBox(height: 12),
                            SizedBox(
                              height: 56,
                              child: FilledButton(
                                onPressed: _isSubmitting ? null : _submit,
                                style: FilledButton.styleFrom(
                                  backgroundColor: accentColor,
                                  foregroundColor: Colors.white,
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(28),
                                  ),
                                  textStyle: const TextStyle(
                                    fontSize: 18,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                child: _isSubmitting
                                    ? const SizedBox.square(
                                        dimension: 22,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                          color: Colors.white,
                                        ),
                                      )
                                    : _isRegistering
                                        ? const Row(
                                            mainAxisAlignment:
                                                MainAxisAlignment.center,
                                            children: [
                                              Icon(Icons.person_add_alt),
                                              SizedBox(width: 8),
                                              Text('REGISTER'),
                                            ],
                                          )
                                        : const Text('LOGIN'),
                              ),
                            ),
                            if (!_isRegistering)
                              Padding(
                                padding: const EdgeInsets.only(top: 28),
                                child: Column(
                                  children: [
                                    Text(
                                      'Log in with',
                                      textAlign: TextAlign.center,
                                      style: Theme.of(context)
                                          .textTheme
                                          .bodyLarge,
                                    ),
                                    const SizedBox(height: 12),
                                    const _SocialButtons(),
                                  ],
                                ),
                              ),
                            const SizedBox(height: 20),
                            TextButton(
                              onPressed: () {
                                _setMode(
                                  _isRegistering
                                      ? _AuthMode.login
                                      : _AuthMode.register,
                                );
                              },
                              style: TextButton.styleFrom(
                                foregroundColor: Colors.black87,
                              ),
                              child: Text(
                                _isRegistering ? 'Back to Login' : 'Sign Up',
                                style: const TextStyle(fontSize: 18),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

InputDecoration _fieldDecoration(
  String label,
  IconData icon,
  Color fillColor,
) {
  final border = OutlineInputBorder(
    borderRadius: BorderRadius.circular(28),
    borderSide: BorderSide.none,
  );

  return InputDecoration(
    labelText: label,
    filled: true,
    fillColor: fillColor,
    prefixIcon: Icon(icon, color: Colors.black87),
    contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
    border: border,
    enabledBorder: border,
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(28),
      borderSide: const BorderSide(color: Color(0xFF566A9D), width: 1.5),
    ),
    errorBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(28),
      borderSide: const BorderSide(color: Colors.redAccent),
    ),
    focusedErrorBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(28),
      borderSide: const BorderSide(color: Colors.redAccent, width: 1.5),
    ),
  );
}

class _SocialButtons extends StatelessWidget {
  const _SocialButtons();

  @override
  Widget build(BuildContext context) {
    final showUnavailable = () {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Social login is not available yet.')),
      );
    };

    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        _SocialPlaceholder(
          icon: Icons.facebook,
          tooltip: 'Continue with Facebook',
          onTap: showUnavailable,
        ),
        const SizedBox(width: 16),
        _SocialPlaceholder(
          icon: Icons.close,
          tooltip: 'Continue with X',
          backgroundColor: Colors.black,
          foregroundColor: Colors.white,
          onTap: showUnavailable,
        ),
        const SizedBox(width: 16),
        _SocialPlaceholder(
          icon: Icons.g_mobiledata,
          tooltip: 'Continue with Google',
          onTap: showUnavailable,
        ),
      ],
    );
  }
}

class _SocialPlaceholder extends StatelessWidget {
  const _SocialPlaceholder({
    required this.icon,
    required this.tooltip,
    required this.onTap,
    this.backgroundColor = const Color(0xFFE3E8EF),
    this.foregroundColor = const Color(0xFF9AA5B1),
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;
  final Color backgroundColor;
  final Color foregroundColor;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      onPressed: onTap,
      tooltip: tooltip,
      style: IconButton.styleFrom(
        backgroundColor: backgroundColor,
        foregroundColor: foregroundColor,
        fixedSize: const Size(56, 56),
      ),
      icon: Icon(icon, size: 28),
    );
  }
}

String? _required(String? value) {
  if (value == null || value.trim().isEmpty) {
    return 'Required';
  }

  return null;
}
