import 'package:flutter/material.dart';

class UserAvatar extends StatelessWidget {
  const UserAvatar({
    required this.displayName,
    this.username,
    this.imageUrl,
    this.radius = 24,
    super.key,
  });

  final String displayName;
  final String? username;
  final String? imageUrl;
  final double radius;

  String get _initial {
    final value = displayName.trim().isNotEmpty
        ? displayName.trim()
        : (username ?? '').trim();

    return value.isEmpty ? '?' : value.substring(0, 1).toUpperCase();
  }

  bool get _hasRemoteImage {
    final value = imageUrl?.trim();
    final uri = value == null ? null : Uri.tryParse(value);

    return uri != null && (uri.scheme == 'http' || uri.scheme == 'https');
  }

  @override
  Widget build(BuildContext context) {
    final fallback = CircleAvatar(
      radius: radius,
      backgroundColor: const Color(0xFF566A9D),
      child: Text(
        _initial,
        style: TextStyle(
          color: Colors.white,
          fontSize: radius * 0.72,
          fontWeight: FontWeight.w700,
        ),
      ),
    );

    if (!_hasRemoteImage) {
      return fallback;
    }

    return ClipOval(
      child: SizedBox.fromSize(
        size: Size.square(radius * 2),
        child: Image.network(
          imageUrl!,
          fit: BoxFit.cover,
          errorBuilder: (context, error, stackTrace) => fallback,
        ),
      ),
    );
  }
}
