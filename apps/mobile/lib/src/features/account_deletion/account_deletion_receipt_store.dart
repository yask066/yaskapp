import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AccountDeletionReceipt {
  const AccountDeletionReceipt({
    required this.operationId,
    required this.deletionToken,
    required this.statusToken,
    required this.deletionTokenExpiresAt,
    required this.statusTokenExpiresAt,
  });

  final String operationId;
  final String deletionToken;
  final String statusToken;
  final DateTime deletionTokenExpiresAt;
  final DateTime statusTokenExpiresAt;

  Map<String, Object?> toJson() => {
        'operationId': operationId,
        'deletionToken': deletionToken,
        'statusToken': statusToken,
        'deletionTokenExpiresAt':
            deletionTokenExpiresAt.toUtc().toIso8601String(),
        'statusTokenExpiresAt': statusTokenExpiresAt.toUtc().toIso8601String(),
      };

  factory AccountDeletionReceipt.fromJson(Map<String, dynamic> json) {
    DateTime parseDate(String key) {
      final parsed = DateTime.tryParse(json[key] as String? ?? '');
      if (parsed == null) throw const FormatException('Invalid receipt date.');
      return parsed.toUtc();
    }

    String parseString(String key) {
      final value = json[key];
      if (value is! String || value.isEmpty) {
        throw const FormatException('Invalid receipt value.');
      }
      return value;
    }

    return AccountDeletionReceipt(
      operationId: parseString('operationId'),
      deletionToken: parseString('deletionToken'),
      statusToken: parseString('statusToken'),
      deletionTokenExpiresAt: parseDate('deletionTokenExpiresAt'),
      statusTokenExpiresAt: parseDate('statusTokenExpiresAt'),
    );
  }
}

abstract class AccountDeletionReceiptStore {
  const AccountDeletionReceiptStore();

  Future<AccountDeletionReceipt?> read();
  Future<void> save(AccountDeletionReceipt receipt);
  Future<void> clear();
}

class SecureAccountDeletionReceiptStore extends AccountDeletionReceiptStore {
  const SecureAccountDeletionReceiptStore({
    FlutterSecureStorage storage = const FlutterSecureStorage(),
    DateTime Function()? now,
  })  : _storage = storage,
        _now = now;

  static const _receiptKey = 'accountDeletion.receipt';
  final FlutterSecureStorage _storage;
  final DateTime Function()? _now;

  @override
  Future<AccountDeletionReceipt?> read() async {
    final value = await _storage.read(key: _receiptKey);
    if (value == null) return null;
    try {
      final decoded = jsonDecode(value);
      if (decoded is! Map<String, dynamic>) throw const FormatException();
      final receipt = AccountDeletionReceipt.fromJson(decoded);
      if (!receipt.statusTokenExpiresAt
          .isAfter((_now ?? DateTime.now)().toUtc())) {
        await clear();
        return null;
      }
      return receipt;
    } on FormatException {
      await clear();
      return null;
    }
  }

  @override
  Future<void> save(AccountDeletionReceipt receipt) =>
      _storage.write(key: _receiptKey, value: jsonEncode(receipt.toJson()));

  @override
  Future<void> clear() => _storage.delete(key: _receiptKey);
}

class MemoryAccountDeletionReceiptStore extends AccountDeletionReceiptStore {
  AccountDeletionReceipt? _receipt;

  @override
  Future<AccountDeletionReceipt?> read() async => _receipt;
  @override
  Future<void> save(AccountDeletionReceipt receipt) async => _receipt = receipt;
  @override
  Future<void> clear() async => _receipt = null;
}
