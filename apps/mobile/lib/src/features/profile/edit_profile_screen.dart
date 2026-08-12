import 'package:flutter/material.dart';

import '../../core/widgets/user_avatar.dart';
import '../auth/auth_api_client.dart';
import '../auth/auth_session.dart';

class EditProfileScreen extends StatefulWidget {
  const EditProfileScreen({
    required this.user,
    required this.accessToken,
    required this.authApiClient,
    required this.onLogout,
    super.key,
  });

  final AuthUser user;
  final String accessToken;
  final AuthApiClient authApiClient;
  final VoidCallback onLogout;

  @override
  State<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends State<EditProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _displayNameController;
  late final TextEditingController _bioController;
  var _isSubmitting = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _displayNameController = TextEditingController(
      text: widget.user.profile.displayName,
    );
    _bioController = TextEditingController(text: widget.user.profile.bio ?? '');
  }

  @override
  void dispose() {
    _displayNameController.dispose();
    _bioController.dispose();
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
      final updatedUser = await widget.authApiClient.updateProfile(
        accessToken: widget.accessToken,
        displayName: _displayNameController.text.trim(),
        bio: _bioController.text.trim().isEmpty
            ? null
            : _bioController.text.trim(),
      );

      if (!mounted) {
        return;
      }

      Navigator.of(context).pop<AuthUser>(updatedUser);
    } on AuthApiException catch (error) {
      setState(() {
        _errorMessage = error.message;
      });
    } catch (_) {
      setState(() {
        _errorMessage = 'Could not update profile.';
      });
    } finally {
      if (mounted) {
        setState(() {
          _isSubmitting = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    const navy = Color(0xFF05008A);

    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 10, 20, 32),
            children: [
              Row(
                children: [
                  IconButton(
                    tooltip: 'Back',
                    onPressed: _isSubmitting
                        ? null
                        : () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.arrow_back_ios_new),
                  ),
                  const Expanded(
                    child: Center(
                      child: Text(
                        'Edit profile',
                        style: TextStyle(
                          color: Color(0xFF101828),
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ),
                  TextButton(
                    onPressed: _isSubmitting ? null : _submit,
                    child: const Text('Save'),
                  ),
                ],
              ),
              const SizedBox(height: 24),
              Center(
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    UserAvatar(
                      displayName: widget.user.profile.displayName,
                      username: widget.user.username,
                      imageUrl: widget.user.profile.avatarObjectKey,
                      radius: 56,
                    ),
                    Positioned(
                      right: -2,
                      bottom: -2,
                      child: Material(
                        color: Colors.white,
                        shape: const CircleBorder(),
                        elevation: 2,
                        child: IconButton(
                          tooltip: 'Change photo',
                          onPressed: () {},
                          icon: const Icon(Icons.camera_alt_outlined),
                          color: navy,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 18),
              const Center(
                child: Text(
                  'Change photo',
                  style: TextStyle(
                    color: navy,
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(height: 38),
              TextFormField(
                controller: _displayNameController,
                maxLength: 80,
                textCapitalization: TextCapitalization.words,
                decoration: _fieldDecoration('Display name'),
                validator: (value) {
                  if (value == null || value.trim().isEmpty) {
                    return 'Required';
                  }

                  return null;
                },
              ),
              const SizedBox(height: 16),
              TextFormField(
                initialValue: widget.user.username,
                readOnly: true,
                decoration: _fieldDecoration('Username'),
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _bioController,
                maxLength: 160,
                minLines: 3,
                maxLines: 5,
                textCapitalization: TextCapitalization.sentences,
                decoration: _fieldDecoration('Bio').copyWith(
                  alignLabelWithHint: true,
                ),
              ),
              const SizedBox(height: 16),
              TextFormField(
                initialValue: widget.user.email,
                readOnly: true,
                decoration: _fieldDecoration('Email').copyWith(
                  suffixIcon: const Icon(Icons.chevron_right),
                ),
              ),
              if (_errorMessage != null) ...[
                const SizedBox(height: 14),
                Text(
                  _errorMessage!,
                  style: TextStyle(color: colors.error),
                ),
              ],
              const SizedBox(height: 42),
              TextButton(
                onPressed: _isSubmitting ? null : widget.onLogout,
                style: TextButton.styleFrom(
                  foregroundColor: Colors.red,
                  textStyle: const TextStyle(fontSize: 17),
                ),
                child: const Text('Log out'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  InputDecoration _fieldDecoration(String label) {
    return InputDecoration(
      labelText: label,
      floatingLabelBehavior: FloatingLabelBehavior.always,
      contentPadding: const EdgeInsets.fromLTRB(18, 20, 18, 16),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: Color(0xFFE4E7EC)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: Color(0xFFE4E7EC)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: Color(0xFF05008A), width: 1.5),
      ),
    );
  }
}
