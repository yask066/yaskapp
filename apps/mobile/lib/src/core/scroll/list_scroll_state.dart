import 'package:flutter/material.dart';

const _unchanged = Object();

/// Identifies a list whose position should be restored independently of its
/// route's other lists and the active account.
@immutable
class ListScrollContext {
  const ListScrollContext({
    required this.userId,
    required this.route,
    required this.list,
    required this.query,
    required this.filter,
    required this.sort,
  });

  final String? userId;
  final String route;
  final String list;
  final String query;
  final String filter;
  final String sort;

  ListScrollContext copyWith({
    Object? userId = _unchanged,
    String? route,
    String? list,
    String? query,
    String? filter,
    String? sort,
  }) =>
      ListScrollContext(
        userId: identical(userId, _unchanged) ? this.userId : userId as String?,
        route: route ?? this.route,
        list: list ?? this.list,
        query: query ?? this.query,
        filter: filter ?? this.filter,
        sort: sort ?? this.sort,
      );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ListScrollContext &&
          userId == other.userId &&
          route == other.route &&
          list == other.list &&
          query == other.query &&
          filter == other.filter &&
          sort == other.sort;

  @override
  int get hashCode => Object.hash(userId, route, list, query, filter, sort);
}

@immutable
class ListAnchor {
  const ListAnchor({
    required this.id,
    required this.top,
    this.hasMeasuredTop = true,
  });

  final String id;
  final double top;

  /// False when this is a surviving fallback for which no prior viewport
  /// coordinate was captured. Restoration must not pretend it shares the
  /// deleted anchor's coordinate.
  final bool hasMeasuredTop;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ListAnchor &&
          id == other.id &&
          top == other.top &&
          hasMeasuredTop == other.hasMeasuredTop;

  @override
  int get hashCode => Object.hash(id, top, hasMeasuredTop);
}

class _SavedListState {
  _SavedListState({
    required this.anchor,
    required this.visibleAnchors,
    required this.itemIds,
    required this.revision,
  });

  final ListAnchor anchor;
  final List<ListAnchor> visibleAnchors;
  final List<String> itemIds;
  final int revision;
}

/// In-memory anchor storage. It deliberately owns no scroll controllers;
/// each screen owns and disposes the controller attached to its list.
class ListScrollStateStore {
  final Map<ListScrollContext, _SavedListState> _states = {};
  int _nextRevision = 0;

  int? revisionFor(ListScrollContext context) => _states[context]?.revision;

  void capture(
    ListScrollContext context,
    ListAnchor anchor, {
    Iterable<ListAnchor> visibleAnchors = const [],
    Iterable<String>? itemIds,
  }) {
    _nextRevision++;
    final anchors = List<ListAnchor>.of(visibleAnchors);
    if (!anchors.any((candidate) => candidate.id == anchor.id)) {
      anchors.insert(0, anchor);
    }

    final ids =
        itemIds?.toList() ?? anchors.map((candidate) => candidate.id).toList();
    if (!ids.contains(anchor.id)) ids.insert(0, anchor.id);

    _states[context] = _SavedListState(
      anchor: anchor,
      visibleAnchors: List.unmodifiable(anchors),
      itemIds: List.unmodifiable(ids),
      revision: _nextRevision,
    );
  }

  ListAnchor? read(
    ListScrollContext context, {
    List<String>? currentItemIds,
  }) {
    final saved = _states[context];
    if (saved == null) return null;
    if (currentItemIds == null) return saved.anchor;
    if (currentItemIds.contains(saved.anchor.id)) return saved.anchor;
    if (currentItemIds.isEmpty) return null;

    final available = currentItemIds.toSet();
    final oldAnchorIndex = saved.itemIds.indexOf(saved.anchor.id);
    String? next;
    for (var index = oldAnchorIndex + 1;
        index < saved.itemIds.length;
        index++) {
      final candidate = saved.itemIds[index];
      if (available.contains(candidate)) {
        next = candidate;
        break;
      }
    }

    String? previous;
    for (var index = oldAnchorIndex - 1; index >= 0; index--) {
      final candidate = saved.itemIds[index];
      if (available.contains(candidate)) {
        previous = candidate;
        break;
      }
    }
    final fallbackId = next ?? previous ?? currentItemIds.first;
    final visible = saved.visibleAnchors.where((item) => item.id == fallbackId);
    if (visible.isNotEmpty) return visible.first;

    return ListAnchor(
      id: fallbackId,
      top: saved.anchor.top,
      hasMeasuredTop: false,
    );
  }

  void clearForUser(String userId) {
    _states.removeWhere((context, _) => context.userId == userId);
  }

  void clear() => _states.clear();
}

/// Applies a saved anchor after the next layout using a screen-owned
/// [ScrollController]. The [anchorTop] callback must return the item's top in
/// viewport coordinates, or null when that item is not mounted.
abstract final class ListScrollRestoration {
  static Future<bool> restoreAfterLayout({
    required ListScrollStateStore store,
    required ListScrollContext context,
    required List<String> currentItemIds,
    required ScrollController controller,
    required double? Function(String id) anchorTop,
    bool hasExplicitTarget = false,
    bool Function()? isExplicitTargetActive,
  }) async {
    if (hasExplicitTarget) return false;

    final revision = store.revisionFor(context);
    if (revision == null) return false;
    final anchor = store.read(context, currentItemIds: currentItemIds);
    if (anchor == null || !anchor.hasMeasuredTop) return false;

    await WidgetsBinding.instance.endOfFrame;
    if (!controller.hasClients || store.revisionFor(context) != revision) {
      return false;
    }
    if (isExplicitTargetActive?.call() ?? false) return false;

    final currentAnchor = store.read(context, currentItemIds: currentItemIds);
    if (currentAnchor == null || currentAnchor != anchor) return false;

    final currentTop = anchorTop(anchor.id);
    if (currentTop == null) return false;

    final position = controller.position;
    final targetOffset = correctedOffset(
      currentOffset: controller.offset,
      currentAnchorTop: currentTop,
      savedAnchor: anchor,
      minScrollExtent: position.minScrollExtent,
      maxScrollExtent: position.maxScrollExtent,
    );
    if (targetOffset != controller.offset) controller.jumpTo(targetOffset);
    return true;
  }

  static double correctedOffset({
    required double currentOffset,
    required double currentAnchorTop,
    required ListAnchor savedAnchor,
    required double minScrollExtent,
    required double maxScrollExtent,
  }) =>
      (currentOffset + currentAnchorTop - savedAnchor.top)
          .clamp(minScrollExtent, maxScrollExtent)
          .toDouble();
}
