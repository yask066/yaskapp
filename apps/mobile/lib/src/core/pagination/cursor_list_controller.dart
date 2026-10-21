import 'dart:async';

import 'package:flutter/foundation.dart';

import 'cursor_page.dart';

typedef CursorPageLoader<T> = Future<CursorPage<T>> Function({
  required int limit,
  String? cursor,
});

/// One independent cursor chain. Include session/surface/sort/poll/root in
/// [contextKey]; include Following membership generation there only for a
/// Following list. Replace and dispose a controller when its identity changes.
///
/// The controller guards late completions with its generation and request
/// tokens. Transport cancellation remains the loader owner's responsibility.
class CursorListController<T> extends ChangeNotifier {
  CursorListController({
    required this.contextKey,
    required this.loader,
    required this.extractId,
    this.limit = 20,
    this.inactiveRetention = const Duration(minutes: 5),
    this.onInactiveExpired,
  }) : _state = CursorListState<T>._(
          pages: const [],
          extractId: extractId,
          generation: 0,
          initial: const CursorReadState(),
          refresh: const CursorReadState(),
          append: const CursorReadState(),
          automaticLoadsUsed: 0,
          automaticLoadPaused: false,
        ) {
    if (limit < 1 || limit > 50) {
      throw ArgumentError.value(limit, 'limit', 'Must be between 1 and 50.');
    }
    if (inactiveRetention.isNegative) {
      throw ArgumentError.value(
        inactiveRetention,
        'inactiveRetention',
        'Must not be negative.',
      );
    }
  }

  /// Composite identity owned by the feature, including the session epoch.
  final Object contextKey;
  final CursorPageLoader<T> loader;
  final String Function(T item) extractId;
  final int limit;
  final Duration inactiveRetention;

  /// Lets the owning feature clear its scroll anchor when retained pages expire.
  final VoidCallback? onInactiveExpired;

  CursorListState<T> _state;
  CursorListState<T> get state => _state;

  bool _disposed = false;
  bool _inactive = false;
  Timer? _inactiveTimer;
  final Set<String> _usedCursors = <String>{};

  /// Fetches the first page. A failed initial read can be retried by calling it
  /// again; only one initial read may be pending at a time.
  Future<void> loadInitial() async {
    if (_disposed ||
        _state.pages.isNotEmpty ||
        _state.initial.pending ||
        _state.refresh.pending) {
      return;
    }
    markActive();

    final generation = _state.generation;
    _publish(_state.copyWith(
      initial: const CursorReadState(pending: true),
      automaticLoadsUsed: 0,
      automaticLoadPaused: false,
    ));

    try {
      final page = await loader(limit: limit);
      if (!_isCurrent(generation)) return;
      _usedCursors.clear();
      _publish(_state.copyWith(
        pages: <CursorPage<T>>[page],
        initial: const CursorReadState(),
        append: const CursorReadState(),
      ));
    } catch (error) {
      if (!_isCurrent(generation)) return;
      _publish(_state.copyWith(initial: CursorReadState(error: error)));
    }
  }

  /// Appends one server page. Automatic requests are limited to three
  /// consecutive successful pages; a manual request resets that budget.
  Future<void> loadMore({bool automatic = false}) async {
    final cursor = _state.nextCursor;
    if (_disposed ||
        cursor == null ||
        !_state.paginationSupported ||
        _state.initial.pending ||
        _state.refresh.pending ||
        _state.append.pending ||
        (automatic &&
            (_state.automaticLoadPaused || _state.automaticLoadsUsed >= 3))) {
      return;
    }
    markActive();

    if (!automatic) {
      _state = _state.copyWith(
        automaticLoadsUsed: 0,
        automaticLoadPaused: false,
      );
    }
    final generation = _state.generation;
    _publish(_state.copyWith(append: const CursorReadState(pending: true)));

    try {
      final page = await loader(limit: limit, cursor: cursor);
      if (!_isCurrent(generation)) return;
      final nextCursor = page.nextCursor;
      if (page.paginationSupported &&
          nextCursor != null &&
          (nextCursor == cursor || _usedCursors.contains(nextCursor))) {
        _publish(_state.copyWith(
          append: CursorReadState(error: StateError('Cursor repeated.')),
          automaticLoadPaused: true,
        ));
        return;
      }

      _usedCursors.add(cursor);
      _publish(_state.copyWith(
        pages: <CursorPage<T>>[..._state.pages, page],
        append: const CursorReadState(),
        automaticLoadsUsed: automatic ? _state.automaticLoadsUsed + 1 : 0,
      ));
    } catch (error) {
      if (!_isCurrent(generation)) return;
      _publish(_state.copyWith(
        append: CursorReadState(error: error),
        automaticLoadPaused: true,
      ));
    }
  }

  /// Starts a new generation while retaining the visible pages until the first
  /// page succeeds. A failed refresh keeps the previous cursor usable.
  Future<void> refresh() async {
    if (_disposed || _state.refresh.pending) return;
    markActive();

    final generation = _state.generation + 1;
    _publish(_state.copyWith(
      generation: generation,
      initial: const CursorReadState(),
      refresh: const CursorReadState(pending: true),
      append: const CursorReadState(),
      automaticLoadsUsed: 0,
      automaticLoadPaused: false,
    ));

    try {
      final page = await loader(limit: limit);
      if (!_isCurrent(generation)) return;
      _usedCursors.clear();
      _publish(_state.copyWith(
        pages: <CursorPage<T>>[page],
        refresh: const CursorReadState(),
        append: const CursorReadState(),
      ));
    } catch (error) {
      if (!_isCurrent(generation)) return;
      _publish(_state.copyWith(refresh: CursorReadState(error: error)));
    }
  }

  /// Marks a hidden list as inactive. Its pages and owner-managed anchor remain
  /// available for [inactiveRetention], then expire as one new generation.
  void markInactive() {
    if (_disposed || _inactive) return;
    _inactive = true;
    _inactiveTimer?.cancel();
    _inactiveTimer = Timer(inactiveRetention, _expireInactiveState);
  }

  /// Cancels pending retention expiry when the owning surface becomes visible.
  void markActive() {
    if (_disposed) return;
    _inactive = false;
    _inactiveTimer?.cancel();
    _inactiveTimer = null;
  }

  void _expireInactiveState() {
    if (_disposed || !_inactive) return;
    _inactive = false;
    _inactiveTimer = null;
    _usedCursors.clear();
    _publish(_state.copyWith(
      pages: <CursorPage<T>>[],
      generation: _state.generation + 1,
      initial: const CursorReadState(),
      refresh: const CursorReadState(),
      append: const CursorReadState(),
      automaticLoadsUsed: 0,
      automaticLoadPaused: false,
    ));
    onInactiveExpired?.call();
  }

  bool _isCurrent(int generation) =>
      !_disposed && _state.generation == generation;

  void _publish(CursorListState<T> next) {
    if (_disposed) return;
    _state = next;
    notifyListeners();
  }

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _inactive = false;
    _inactiveTimer?.cancel();
    _inactiveTimer = null;
    _usedCursors.clear();
    _state = _state.copyWith(
      pages: <CursorPage<T>>[],
      generation: _state.generation + 1,
      initial: const CursorReadState(),
      refresh: const CursorReadState(),
      append: const CursorReadState(),
      automaticLoadsUsed: 0,
      automaticLoadPaused: false,
    );
    super.dispose();
  }
}

@immutable
class CursorReadState {
  const CursorReadState({this.pending = false, this.error});

  final bool pending;
  final Object? error;
}

@immutable
class CursorListState<T> {
  factory CursorListState._({
    required List<CursorPage<T>> pages,
    required String Function(T item) extractId,
    required int generation,
    required CursorReadState initial,
    required CursorReadState refresh,
    required CursorReadState append,
    required int automaticLoadsUsed,
    required bool automaticLoadPaused,
  }) {
    final stablePages = List<CursorPage<T>>.unmodifiable(
      pages.map((page) => CursorPage<T>(
            items: List<T>.unmodifiable(page.items),
            nextCursor: page.nextCursor,
            paginationSupported: page.paginationSupported,
          )),
    );
    final itemsById = <String, T>{};
    for (final page in stablePages) {
      for (final item in page.items) {
        itemsById.putIfAbsent(extractId(item), () => item);
      }
    }

    return CursorListState._internal(
      pages: stablePages,
      ids: List<String>.unmodifiable(itemsById.keys),
      items: List<T>.unmodifiable(itemsById.values),
      generation: generation,
      initial: initial,
      refresh: refresh,
      append: append,
      automaticLoadsUsed: automaticLoadsUsed,
      automaticLoadPaused: automaticLoadPaused,
      nextCursor: stablePages.isEmpty ? null : stablePages.last.nextCursor,
      paginationSupported:
          stablePages.isNotEmpty && stablePages.last.paginationSupported,
      extractId: extractId,
    );
  }

  const CursorListState._internal({
    required this.pages,
    required this.ids,
    required this.items,
    required this.generation,
    required this.initial,
    required this.refresh,
    required this.append,
    required this.automaticLoadsUsed,
    required this.automaticLoadPaused,
    required this.nextCursor,
    required this.paginationSupported,
    required String Function(T item) extractId,
  }) : _extractId = extractId;

  final List<CursorPage<T>> pages;
  final List<String> ids;
  final List<T> items;
  final String? nextCursor;
  final bool paginationSupported;
  final int generation;
  final CursorReadState initial;
  final CursorReadState refresh;
  final CursorReadState append;
  final int automaticLoadsUsed;
  final bool automaticLoadPaused;

  bool get canLoadMore => paginationSupported && nextCursor != null;
  final String Function(T item) _extractId;

  CursorListState<T> copyWith({
    List<CursorPage<T>>? pages,
    int? generation,
    CursorReadState? initial,
    CursorReadState? refresh,
    CursorReadState? append,
    int? automaticLoadsUsed,
    bool? automaticLoadPaused,
  }) =>
      CursorListState<T>._(
        pages: pages ?? this.pages,
        extractId: _extractId,
        generation: generation ?? this.generation,
        initial: initial ?? this.initial,
        refresh: refresh ?? this.refresh,
        append: append ?? this.append,
        automaticLoadsUsed: automaticLoadsUsed ?? this.automaticLoadsUsed,
        automaticLoadPaused: automaticLoadPaused ?? this.automaticLoadPaused,
      );
}
