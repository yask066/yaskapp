import 'package:flutter_secure_storage/flutter_secure_storage.dart';

abstract class AuthSessionStore {
  const AuthSessionStore();

  Future<String?> readAccessToken();

  Future<void> saveAccessToken(String accessToken);

  Future<void> clear();
}

class SecureAuthSessionStore extends AuthSessionStore {
  const SecureAuthSessionStore({
    FlutterSecureStorage storage = const FlutterSecureStorage(),
  }) : _storage = storage;

  static const _accessTokenKey = 'auth.accessToken';

  final FlutterSecureStorage _storage;

  @override
  Future<String?> readAccessToken() {
    return _storage.read(key: _accessTokenKey);
  }

  @override
  Future<void> saveAccessToken(String accessToken) {
    return _storage.write(key: _accessTokenKey, value: accessToken);
  }

  @override
  Future<void> clear() {
    return _storage.delete(key: _accessTokenKey);
  }
}

class MemoryAuthSessionStore extends AuthSessionStore {
  String? _accessToken;

  @override
  Future<String?> readAccessToken() async {
    return _accessToken;
  }

  @override
  Future<void> saveAccessToken(String accessToken) async {
    _accessToken = accessToken;
  }

  @override
  Future<void> clear() async {
    _accessToken = null;
  }
}
