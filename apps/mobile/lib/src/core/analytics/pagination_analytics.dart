import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';

enum PaginationSurface { feed, subscriptions, comments, replies }

const _paginationEventNames = {
  'pagination.start',
  'pagination.success',
  'pagination.failure',
  'pagination.retry',
  'pagination.refresh',
  'pagination.cursor_anomaly',
  'pagination.deduplication',
  'pagination.snapshot_storage',
  'pagination.snapshot_expiry',
};

const _paginationRequestIdPattern =
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

typedef PaginationAnalyticsSink = void Function(Map<String, Object?> event);

class PaginationAnalyticsEvent {
  const PaginationAnalyticsEvent({
    required this.event,
    required this.surface,
    required this.sort,
    required this.pageNumber,
    required this.durationMs,
    required this.itemCount,
    required this.errorCode,
    required this.requestId,
    this.deduplicatedCount,
    this.storedItemCount,
    this.activeSnapshotCount,
    this.deletedSnapshotCount,
    this.snapshotLifetimeSeconds,
  });

  final String event;
  final PaginationSurface surface;
  final String? sort;
  final int? pageNumber;
  final int? durationMs;
  final int? itemCount;
  final String? errorCode;
  final String requestId;
  final int? deduplicatedCount;
  final int? storedItemCount;
  final int? activeSnapshotCount;
  final int? deletedSnapshotCount;
  final int? snapshotLifetimeSeconds;

  Map<String, Object?> toJson() {
    final safePageNumber = pageNumber;
    final safeDurationMs = durationMs;
    final safeItemCount = itemCount;
    final safeErrorCode = errorCode;
    final safeDeduplicatedCount = deduplicatedCount;
    final safeStoredItemCount = storedItemCount;
    final safeActiveSnapshotCount = activeSnapshotCount;
    final safeDeletedSnapshotCount = deletedSnapshotCount;
    final safeSnapshotLifetimeSeconds = snapshotLifetimeSeconds;
    return Map.unmodifiable({
      'event':
          _paginationEventNames.contains(event) ? event : 'pagination.failure',
      'surface': surface.name,
      'sort': sort == 'newest' || sort == 'oldest' || sort == 'popular'
          ? sort
          : null,
      'pageNumber':
          safePageNumber != null && safePageNumber > 0 ? safePageNumber : null,
      'durationMs':
          safeDurationMs != null && safeDurationMs >= 0 ? safeDurationMs : null,
      'itemCount':
          safeItemCount != null && safeItemCount >= 0 ? safeItemCount : null,
      'errorCode': safeErrorCode == null
          ? null
          : RegExp(r'^[a-z][a-z0-9_-]{0,63}$').hasMatch(safeErrorCode)
              ? safeErrorCode
              : 'request_failed',
      'requestId': RegExp(_paginationRequestIdPattern, caseSensitive: false)
              .hasMatch(requestId)
          ? requestId
          : createPaginationRequestId(),
      if (safeDeduplicatedCount != null && safeDeduplicatedCount >= 0)
        'deduplicatedCount': safeDeduplicatedCount,
      if (safeStoredItemCount != null && safeStoredItemCount >= 0)
        'storedItemCount': safeStoredItemCount,
      if (safeActiveSnapshotCount != null && safeActiveSnapshotCount >= 0)
        'activeSnapshotCount': safeActiveSnapshotCount,
      if (safeDeletedSnapshotCount != null && safeDeletedSnapshotCount >= 0)
        'deletedSnapshotCount': safeDeletedSnapshotCount,
      if (safeSnapshotLifetimeSeconds != null &&
          safeSnapshotLifetimeSeconds >= 0)
        'snapshotLifetimeSeconds': safeSnapshotLifetimeSeconds,
    });
  }
}

class PaginationAnalytics {
  PaginationAnalytics({PaginationAnalyticsSink? sink})
      : _sink = sink ?? _debugPrintSink;

  final PaginationAnalyticsSink _sink;

  void emit(PaginationAnalyticsEvent event) {
    _sink(event.toJson());
  }

  static void _debugPrintSink(Map<String, Object?> event) {
    debugPrint(jsonEncode(event));
  }
}

final Random _secureRandom = Random.secure();

String createPaginationRequestId() {
  final bytes = List<int>.generate(16, (_) => _secureRandom.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex =
      bytes.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
      '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}
