import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';

import '../config/api_config.dart';

class UserAvatar extends StatelessWidget {
  const UserAvatar({
    required this.displayName,
    this.username,
    this.imageUrl,
    this.localImageBytes,
    this.radius = 24,
    super.key,
  });

  final String displayName;
  final String? username;
  final String? imageUrl;
  final Uint8List? localImageBytes;
  final double radius;

  String get _initial {
    final value = displayName.trim().isNotEmpty
        ? displayName.trim()
        : (username ?? '').trim();

    return value.isEmpty ? '?' : value.substring(0, 1).toUpperCase();
  }

  Uri? get _imageUri {
    final value = imageUrl?.trim();
    if (value == null || value.isEmpty) {
      return null;
    }

    final uri = Uri.tryParse(value);

    if (uri != null && (uri.scheme == 'http' || uri.scheme == 'https')) {
      return uri;
    }

    if (value.startsWith('/')) {
      return const ApiConfig().uri(value);
    }

    return null;
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

    final uri = _imageUri;

    if (localImageBytes != null) {
      return ClipOval(
        child: Image.memory(
          localImageBytes!,
          width: radius * 2,
          height: radius * 2,
          fit: BoxFit.cover,
          errorBuilder: (context, error, stackTrace) => fallback,
        ),
      );
    }

    if (uri == null) {
      return fallback;
    }

    return ClipOval(
      child: SizedBox.fromSize(
        size: Size.square(radius * 2),
        child: CachedNetworkImage(
          imageUrl: uri.toString(),
          fit: BoxFit.cover,
          placeholder: (context, url) => fallback,
          errorWidget: (context, url, error) => fallback,
        ),
      ),
    );
  }
}
