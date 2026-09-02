import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

abstract class SearchHistoryStore {
  const SearchHistoryStore();

  Future<List<String>> read();

  Future<void> add(String query);

  Future<void> clear();
}

class SecureSearchHistoryStore extends SearchHistoryStore {
  const SecureSearchHistoryStore({
    required String userId,
    FlutterSecureStorage storage = const FlutterSecureStorage(),
  })  : _storage = storage,
        _historyKey = 'search.recentQueries.$userId';

  static const _maxEntries = 5;

  final FlutterSecureStorage _storage;
  final String _historyKey;

  @override
  Future<List<String>> read() async {
    final value = await _storage.read(key: _historyKey);
    if (value == null) return [];
    try {
      final decoded = jsonDecode(value);
      if (decoded is! List) return [];
      return decoded
          .whereType<String>()
          .map((query) => query.trim())
          .where((query) => query.isNotEmpty)
          .take(_maxEntries)
          .toList(growable: false);
    } on FormatException {
      return [];
    }
  }

  @override
  Future<void> add(String query) async {
    final normalized = query.trim().replaceAll(RegExp(r'\s+'), ' ');
    if (normalized.isEmpty) return;
    final history = await read();
    final updated = [normalized, ...history.where((item) => item != normalized)]
        .take(_maxEntries)
        .toList();
    await _storage.write(key: _historyKey, value: jsonEncode(updated));
  }

  @override
  Future<void> clear() => _storage.delete(key: _historyKey);
}

class MemorySearchHistoryStore extends SearchHistoryStore {
  static const _maxEntries = 5;
  final _queries = <String>[];

  @override
  Future<List<String>> read() async => List.unmodifiable(_queries);

  @override
  Future<void> add(String query) async {
    final normalized = query.trim().replaceAll(RegExp(r'\s+'), ' ');
    if (normalized.isEmpty) return;
    _queries
      ..remove(normalized)
      ..insert(0, normalized);
    if (_queries.length > _maxEntries) _queries.removeLast();
  }

  @override
  Future<void> clear() async => _queries.clear();
}
