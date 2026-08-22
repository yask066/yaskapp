import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/widgets/user_avatar.dart';
import '../auth/auth_api_client.dart';
import '../auth/auth_session.dart';
import '../auth/country_selector.dart';

class EditProfileScreen extends StatefulWidget {
  const EditProfileScreen({
    required this.user,
    required this.accessToken,
    required this.authApiClient,
    required this.onLogout,
    this.onUserChanged,
    super.key,
  });

  final AuthUser user;
  final String accessToken;
  final AuthApiClient authApiClient;
  final VoidCallback onLogout;
  final ValueChanged<AuthUser>? onUserChanged;

  @override
  State<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends State<EditProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _displayNameController;
  late final TextEditingController _bioController;
  String? _countryCode;
  var _isSubmitting = false;
  String? _errorMessage;
  AuthUser? _avatarUser;
  Uint8List? _localAvatarBytes;
  var _isAvatarSubmitting = false;
  final _imagePicker = ImagePicker();

  @override
  void initState() {
    super.initState();
    _displayNameController = TextEditingController(
      text: widget.user.profile.displayName,
    );
    _bioController = TextEditingController(text: widget.user.profile.bio ?? '');
    _countryCode = widget.user.profile.countryCode;
    _avatarUser = widget.user;
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
        countryCode: _countryCode,
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

  Future<void> _pickAvatar() async {
    if (_isSubmitting || _isAvatarSubmitting) {
      return;
    }

    final file = await _imagePicker.pickImage(
      source: ImageSource.gallery,
      maxWidth: 2048,
      maxHeight: 2048,
      imageQuality: 90,
    );

    if (file == null || !mounted) {
      return;
    }

    final contentType = _contentTypeFor(file);
    if (contentType == null) {
      setState(() {
        _errorMessage = 'Choose a JPEG, PNG, or WebP image.';
      });
      return;
    }

    final bytes = await file.readAsBytes();
    if (!mounted) {
      return;
    }

    if (bytes.length > 5 * 1024 * 1024) {
      setState(() {
        _errorMessage = 'Avatar must be 5 MB or smaller.';
      });
      return;
    }

    setState(() {
      _localAvatarBytes = bytes;
      _isAvatarSubmitting = true;
      _errorMessage = null;
    });

    try {
      final updatedUser = await widget.authApiClient.uploadAvatar(
        accessToken: widget.accessToken,
        bytes: bytes,
        filename: file.name,
        contentType: contentType,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _avatarUser = updatedUser;
        _localAvatarBytes = null;
      });
      widget.onUserChanged?.call(updatedUser);
    } on AuthApiException catch (error) {
      if (mounted) {
        setState(() {
          _errorMessage = error.message;
          _localAvatarBytes = null;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _errorMessage = 'Could not upload avatar.';
          _localAvatarBytes = null;
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          _isAvatarSubmitting = false;
        });
      }
    }
  }

  Future<void> _removeAvatar() async {
    if (_isSubmitting || _isAvatarSubmitting || !_hasAvatar) {
      return;
    }

    setState(() {
      _isAvatarSubmitting = true;
      _errorMessage = null;
    });

    try {
      final updatedUser = await widget.authApiClient.deleteAvatar(
        accessToken: widget.accessToken,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _avatarUser = updatedUser;
      });
      widget.onUserChanged?.call(updatedUser);
    } on AuthApiException catch (error) {
      if (mounted) {
        setState(() {
          _errorMessage = error.message;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _errorMessage = 'Could not remove avatar.';
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          _isAvatarSubmitting = false;
        });
      }
    }
  }

  String? _contentTypeFor(XFile file) {
    final mimeType = file.mimeType?.toLowerCase();
    if (mimeType == 'image/jpeg' ||
        mimeType == 'image/png' ||
        mimeType == 'image/webp') {
      return mimeType;
    }

    final extension = file.name.split('.').last.toLowerCase();
    return switch (extension) {
      'jpg' || 'jpeg' => 'image/jpeg',
      'png' => 'image/png',
      'webp' => 'image/webp',
      _ => null,
    };
  }

  bool get _hasAvatar =>
      _localAvatarBytes != null || _avatarUser?.profile.avatarUrl != null;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    const navy = Color(0xFF566A9D);
    final avatarUser = _avatarUser ?? widget.user;
    final avatarBusy = _isSubmitting || _isAvatarSubmitting;

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
                    onPressed: _isSubmitting || _isAvatarSubmitting
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
                    onPressed: _isSubmitting || _isAvatarSubmitting ? null : _submit,
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
                      displayName: avatarUser.profile.displayName,
                      username: avatarUser.username,
                      imageUrl: avatarUser.profile.avatarUrl,
                      localImageBytes: _localAvatarBytes,
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
                          onPressed: avatarBusy ? null : _pickAvatar,
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
              if (_hasAvatar) ...[
                const SizedBox(height: 8),
                TextButton(
                  onPressed: avatarBusy ? null : _removeAvatar,
                  child: const Text('Remove photo'),
                ),
              ],
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
              CountrySelectorField(
                value: _countryCode,
                decoration: _fieldDecoration('Country'),
                emptyLabel: 'Not selected',
                onChanged: (value) {
                  setState(() {
                    _countryCode = value;
                  });
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
                onPressed: _isSubmitting || _isAvatarSubmitting
                    ? null
                    : widget.onLogout,
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
        borderSide: const BorderSide(color: Color(0xFF566A9D), width: 1.5),
      ),
    );
  }
}
