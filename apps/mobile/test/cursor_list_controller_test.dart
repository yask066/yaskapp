import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/core/pagination/cursor_page.dart';
import 'package:yaskapp_mobile/src/core/pagination/cursor_list_controller.dart';

class _Item {
  const _Item(this.id, this.value);

  final String id;
  final String value;
}

CursorPage<_Item> _page(
  String id, {
  String? nextCursor,
  bool paginationSupported = true,
}) =>
    CursorPage<_Item>(
      items: <_Item>[_Item(id, id)],
      nextCursor: nextCursor,
      paginationSupported: paginationSupported,
    );

void main() {
  test('deduplicates page IDs without deriving the server cursor from items',
      () async {
    final requests = <String?>[];
    final controller = CursorListController<_Item>(
      contextKey: 'feed:guest:newest',
      loader: ({cursor, required limit}) async {
        expect(limit, 20);
        requests.add(cursor);
        if (cursor == null) {
          return const CursorPage<_Item>(
            items: [_Item('poll-1', 'first')],
            nextCursor: 'cursor-1',
          );
        }
        return const CursorPage<_Item>(
          items: [_Item('poll-1', 'duplicate')],
          nextCursor: 'cursor-2',
        );
      },
      extractId: (item) => item.id,
    );

    await controller.loadInitial();
    await controller.loadMore();

    expect(requests, [null, 'cursor-1']);
    expect(controller.state.pages, hasLength(2));
    expect(controller.state.ids, ['poll-1']);
    expect(controller.state.items.map((item) => item.value), ['first']);
    expect(controller.state.nextCursor, 'cursor-2');
    expect(controller.state.paginationSupported, isTrue);
    expect(controller.state.append.pending, isFalse);
    controller.dispose();
  });

  test('allows one append at a time and clears pending when it completes',
      () async {
    final appendPage = Completer<CursorPage<_Item>>();
    final requests = <String?>[];
    final controller = CursorListController<_Item>(
      contextKey: 'feed:guest:newest',
      loader: ({cursor, required limit}) {
        requests.add(cursor);
        return cursor == null
            ? Future.value(_page('one', nextCursor: 'cursor-1'))
            : appendPage.future;
      },
      extractId: (item) => item.id,
    );

    await controller.loadInitial();
    final append = controller.loadMore();
    expect(controller.state.append.pending, isTrue);
    final duplicateAppend = controller.loadMore();
    expect(requests, [null, 'cursor-1']);

    appendPage.complete(_page('two', nextCursor: 'cursor-2'));
    await Future.wait([append, duplicateAppend]);

    expect(controller.state.append.pending, isFalse);
    expect(controller.state.ids, ['one', 'two']);
    controller.dispose();
  });

  test('rejects an A to A cursor without applying the repeated page', () async {
    var appendCalls = 0;
    final controller = CursorListController<_Item>(
      contextKey: 'roots:poll-1:newest',
      loader: ({cursor, required limit}) async {
        if (cursor == null) return _page('root-1', nextCursor: 'A');
        appendCalls++;
        return _page('root-duplicate', nextCursor: 'A');
      },
      extractId: (item) => item.id,
    );

    await controller.loadInitial();
    await controller.loadMore();

    expect(appendCalls, 1);
    expect(controller.state.pages, hasLength(1));
    expect(controller.state.ids, ['root-1']);
    expect(controller.state.nextCursor, 'A');
    expect(controller.state.append.error, isA<StateError>());
    expect(controller.state.append.pending, isFalse);
    controller.dispose();
  });

  test('rejects an A to B to A cursor cycle', () async {
    final requests = <String?>[];
    final controller = CursorListController<_Item>(
      contextKey: 'roots:poll-1:newest',
      loader: ({cursor, required limit}) async {
        requests.add(cursor);
        if (cursor == null) return _page('root-1', nextCursor: 'A');
        if (cursor == 'A') return _page('root-2', nextCursor: 'B');
        return _page('root-stale', nextCursor: 'A');
      },
      extractId: (item) => item.id,
    );

    await controller.loadInitial();
    await controller.loadMore();
    await controller.loadMore();

    expect(requests, [null, 'A', 'B']);
    expect(controller.state.pages, hasLength(2));
    expect(controller.state.ids, ['root-1', 'root-2']);
    expect(controller.state.nextCursor, 'B');
    expect(controller.state.append.error, isA<StateError>());
    expect(controller.state.append.pending, isFalse);
    controller.dispose();
  });

  test('keeps an empty page when its cursor advances', () async {
    final controller = CursorListController<_Item>(
      contextKey: 'popular:guest',
      loader: ({cursor, required limit}) async => cursor == null
          ? _page('poll-1', nextCursor: 'A')
          : const CursorPage<_Item>(items: [], nextCursor: 'B'),
      extractId: (item) => item.id,
    );

    await controller.loadInitial();
    await controller.loadMore();

    expect(controller.state.pages, hasLength(2));
    expect(controller.state.pages.last.items, isEmpty);
    expect(controller.state.ids, ['poll-1']);
    expect(controller.state.nextCursor, 'B');
    controller.dispose();
  });

  test('caps automatic appends at three until a manual load resets the budget',
      () async {
    final requests = <String?>[];
    var cursorNumber = 0;
    final controller = CursorListController<_Item>(
      contextKey: 'feed:guest:newest',
      loader: ({cursor, required limit}) async {
        requests.add(cursor);
        cursorNumber++;
        return _page('item-$cursorNumber', nextCursor: 'cursor-$cursorNumber');
      },
      extractId: (item) => item.id,
    );

    await controller.loadInitial();
    await controller.loadMore(automatic: true);
    await controller.loadMore(automatic: true);
    await controller.loadMore(automatic: true);
    await controller.loadMore(automatic: true);

    expect(requests, [null, 'cursor-1', 'cursor-2', 'cursor-3']);
    expect(controller.state.automaticLoadsUsed, 3);

    await controller.loadMore();
    expect(requests, [null, 'cursor-1', 'cursor-2', 'cursor-3', 'cursor-4']);
    expect(controller.state.automaticLoadsUsed, 0);
    controller.dispose();
  });

  test('refresh failure preserves the old cursor and permits a manual append',
      () async {
    final appendPage = Completer<CursorPage<_Item>>();
    final refreshPage = Completer<CursorPage<_Item>>();
    final requests = <String?>[];
    final controller = CursorListController<_Item>(
      contextKey: 'subscriptions:user-1',
      loader: ({cursor, required limit}) {
        requests.add(cursor);
        if (cursor == null && requests.length == 1) {
          return Future.value(_page('old-1', nextCursor: 'old-cursor'));
        }
        if (cursor == 'old-cursor' && requests.length == 2) {
          return appendPage.future;
        }
        if (cursor == null) return refreshPage.future;
        return Future.value(_page('old-2', nextCursor: 'old-next'));
      },
      extractId: (item) => item.id,
    );

    await controller.loadInitial();
    final append = controller.loadMore();
    final refresh = controller.refresh();
    expect(controller.state.generation, 1);
    expect(controller.state.pages, hasLength(1));

    appendPage.complete(_page('stale-append', nextCursor: 'bad-cursor'));
    await append;
    expect(controller.state.ids, ['old-1']);
    expect(controller.state.append.pending, isFalse);

    refreshPage.completeError(StateError('offline'));
    await refresh;
    expect(controller.state.refresh.error, isA<StateError>());
    expect(controller.state.pages, hasLength(1));
    expect(controller.state.nextCursor, 'old-cursor');
    expect(controller.state.append.pending, isFalse);

    await controller.loadMore();
    expect(requests, [null, 'old-cursor', null, 'old-cursor']);
    expect(controller.state.ids, ['old-1', 'old-2']);
    expect(controller.state.append.pending, isFalse);
    controller.dispose();
  });

  test('refresh success replaces pages before an old append completes',
      () async {
    final appendPage = Completer<CursorPage<_Item>>();
    var initialCalls = 0;
    final controller = CursorListController<_Item>(
      contextKey: 'comments:poll-1:newest',
      loader: ({cursor, required limit}) {
        if (cursor == null) {
          initialCalls++;
          return Future.value(
            initialCalls == 1
                ? _page('old-1', nextCursor: 'old-cursor')
                : _page('fresh-1', nextCursor: 'fresh-cursor'),
          );
        }
        return appendPage.future;
      },
      extractId: (item) => item.id,
    );

    await controller.loadInitial();
    final append = controller.loadMore();
    await controller.refresh();
    expect(controller.state.ids, ['fresh-1']);
    expect(controller.state.nextCursor, 'fresh-cursor');

    appendPage.complete(_page('stale-append', nextCursor: 'stale-cursor'));
    await append;

    expect(controller.state.ids, ['fresh-1']);
    expect(controller.state.nextCursor, 'fresh-cursor');
    expect(controller.state.append.pending, isFalse);
    controller.dispose();
  });

  test('dispose rejects a late page and clears pending read state', () async {
    final appendPage = Completer<CursorPage<_Item>>();
    final controller = CursorListController<_Item>(
      contextKey: 'feed:session-1:newest',
      loader: ({cursor, required limit}) => cursor == null
          ? Future.value(_page('one', nextCursor: 'cursor-1'))
          : appendPage.future,
      extractId: (item) => item.id,
    );

    await controller.loadInitial();
    final append = controller.loadMore();
    final generationBeforeDispose = controller.state.generation;
    controller.dispose();
    appendPage.complete(_page('late', nextCursor: 'cursor-2'));
    await append;

    expect(controller.state.generation, generationBeforeDispose + 1);
    expect(controller.state.pages, isEmpty);
    expect(controller.state.ids, isEmpty);
    expect(controller.state.nextCursor, isNull);
    expect(controller.state.append.pending, isFalse);
  });

  testWidgets(
      'clears inactive pages and notifies the owner after retention expires',
      (tester) async {
    var anchorCleared = false;
    final controller = CursorListController<_Item>(
      contextKey: 'feed:session-1:newest',
      inactiveRetention: const Duration(minutes: 5),
      onInactiveExpired: () => anchorCleared = true,
      loader: ({cursor, required limit}) async =>
          _page('one', nextCursor: 'cursor-1'),
      extractId: (item) => item.id,
    );
    await controller.loadInitial();
    expect(controller.state.ids, ['one']);

    controller.markInactive();
    await tester.pump(const Duration(minutes: 4, seconds: 59));
    expect(controller.state.ids, ['one']);
    await tester.pump(const Duration(seconds: 1));

    expect(controller.state.pages, isEmpty);
    expect(controller.state.nextCursor, isNull);
    expect(controller.state.generation, 1);
    expect(anchorCleared, isTrue);
    controller.dispose();
  });
  test('initial failure retries only the initial read', () async {
    var calls = 0;
    final controller = CursorListController<_Item>(
      contextKey: 'feed:session-1:newest',
      loader: ({cursor, required limit}) async {
        calls++;
        if (calls == 1) throw StateError('offline');
        return _page('one', nextCursor: 'cursor-1');
      },
      extractId: (item) => item.id,
    );

    await controller.loadInitial();
    expect(controller.state.initial.error, isA<StateError>());
    expect(controller.state.refresh.error, isNull);
    expect(controller.state.append.error, isNull);

    await controller.loadInitial();
    expect(calls, 2);
    expect(controller.state.initial.error, isNull);
    expect(controller.state.ids, ['one']);
    controller.dispose();
  });

  test('append error waits for a manual retry of the same cursor', () async {
    var appendCalls = 0;
    final requests = <String?>[];
    final controller = CursorListController<_Item>(
      contextKey: 'replies:root-1:session-1',
      loader: ({cursor, required limit}) async {
        requests.add(cursor);
        if (cursor == null) return _page('reply-1', nextCursor: 'cursor-1');
        appendCalls++;
        if (appendCalls == 1) throw StateError('offline');
        return _page('reply-2', nextCursor: null);
      },
      extractId: (item) => item.id,
    );

    await controller.loadInitial();
    await controller.loadMore(automatic: true);
    expect(controller.state.append.error, isA<StateError>());
    expect(controller.state.append.pending, isFalse);
    await controller.loadMore(automatic: true);
    expect(appendCalls, 1);

    await controller.loadMore();
    expect(requests, [null, 'cursor-1', 'cursor-1']);
    expect(controller.state.append.error, isNull);
    expect(controller.state.ids, ['reply-1', 'reply-2']);
    expect(controller.state.initial.error, isNull);
    expect(controller.state.refresh.error, isNull);
    controller.dispose();
  });

  test('failed refresh keeps an append failure paused until manual retry',
      () async {
    final requests = <String?>[];
    var appendCalls = 0;
    var refreshCalls = 0;
    final controller = CursorListController<_Item>(
      contextKey: 'feed:session-1:newest',
      loader: ({cursor, required limit}) async {
        requests.add(cursor);
        if (cursor == null) {
          refreshCalls++;
          if (refreshCalls == 1) {
            return _page('one', nextCursor: 'cursor-1');
          }
          throw StateError('refresh offline');
        }

        appendCalls++;
        if (appendCalls == 1) throw StateError('append offline');
        return _page('two');
      },
      extractId: (item) => item.id,
    );

    await controller.loadInitial();
    await controller.loadMore();
    expect(controller.state.append.error, isA<StateError>());
    expect(controller.state.automaticLoadPaused, isTrue);

    await controller.refresh();
    expect(controller.state.refresh.error, isA<StateError>());
    expect(controller.state.append.error, isA<StateError>());
    expect(controller.state.automaticLoadPaused, isTrue);

    await controller.loadMore(automatic: true);
    expect(requests, [null, 'cursor-1', null]);
    expect(appendCalls, 1);

    await controller.loadMore();
    expect(requests, [null, 'cursor-1', null, 'cursor-1']);
    expect(appendCalls, 2);
    expect(controller.state.append.error, isNull);
    expect(controller.state.ids, ['one', 'two']);
    controller.dispose();
  });

  test('refresh error preserves the chain and a refresh retry replaces it',
      () async {
    var firstPageCalls = 0;
    final controller = CursorListController<_Item>(
      contextKey: 'comments:poll-1:session-1',
      loader: ({cursor, required limit}) async {
        if (cursor != null) return _page('old-2', nextCursor: 'old-next');
        firstPageCalls++;
        if (firstPageCalls == 1) {
          return _page('old-1', nextCursor: 'old-cursor');
        }
        if (firstPageCalls == 2) throw StateError('offline');
        return _page('fresh-1', nextCursor: 'fresh-cursor');
      },
      extractId: (item) => item.id,
    );

    await controller.loadInitial();
    await controller.refresh();
    expect(controller.state.refresh.error, isA<StateError>());
    expect(controller.state.ids, ['old-1']);
    expect(controller.state.nextCursor, 'old-cursor');
    expect(controller.state.initial.error, isNull);
    expect(controller.state.append.error, isNull);

    await controller.refresh();
    expect(firstPageCalls, 3);
    expect(controller.state.refresh.error, isNull);
    expect(controller.state.ids, ['fresh-1']);
    expect(controller.state.nextCursor, 'fresh-cursor');
    controller.dispose();
  });

  test('state pages, IDs, items, and page contents are immutable', () async {
    final controller = CursorListController<_Item>(
      contextKey: 'feed:session-1:newest',
      loader: ({cursor, required limit}) async => _page('one'),
      extractId: (item) => item.id,
    );

    await controller.loadInitial();

    expect(() => controller.state.pages.clear(), throwsUnsupportedError);
    expect(() => controller.state.ids.add('two'), throwsUnsupportedError);
    expect(() => controller.state.items.clear(), throwsUnsupportedError);
    expect(() => controller.state.pages.first.items.clear(),
        throwsUnsupportedError);
    controller.dispose();
  });
  test('late append from before refresh cannot replace or clear a retry append',
      () async {
    final stalePage = Completer<CursorPage<_Item>>();
    final retryPage = Completer<CursorPage<_Item>>();
    final requests = <String?>[];
    var cursorCalls = 0;
    final controller = CursorListController<_Item>(
      contextKey: 'subscriptions:user-1:membership-7',
      loader: ({cursor, required limit}) {
        requests.add(cursor);
        if (cursor == null && requests.length == 1) {
          return Future.value(_page('old-1', nextCursor: 'old-cursor'));
        }
        if (cursor == null) return Future.error(StateError('offline'));
        cursorCalls++;
        return cursorCalls == 1 ? stalePage.future : retryPage.future;
      },
      extractId: (item) => item.id,
    );

    await controller.loadInitial();
    final staleAppend = controller.loadMore();
    await controller.refresh();
    expect(controller.state.refresh.error, isA<StateError>());

    final retryAppend = controller.loadMore();
    expect(controller.state.append.pending, isTrue);
    stalePage.complete(_page('stale', nextCursor: 'stale-cursor'));
    await staleAppend;
    expect(controller.state.ids, ['old-1']);
    expect(controller.state.append.pending, isTrue);

    retryPage.complete(_page('fresh-append', nextCursor: null));
    await retryAppend;
    expect(requests, [null, 'old-cursor', null, 'old-cursor']);
    expect(controller.state.ids, ['old-1', 'fresh-append']);
    expect(controller.state.append.pending, isFalse);
    controller.dispose();
  });

  test('rejects a controller page limit outside the API bounds', () {
    expect(
      () => CursorListController<_Item>(
        contextKey: 'feed:session-1:newest',
        limit: 0,
        loader: ({cursor, required limit}) async => _page('one'),
        extractId: (item) => item.id,
      ),
      throwsArgumentError,
    );
  });
  test(
      'legacy first page disables append without proving the list is exhausted',
      () async {
    final requests = <String?>[];
    final controller = CursorListController<_Item>(
      contextKey: 'feed:legacy-server',
      loader: ({cursor, required limit}) async {
        requests.add(cursor);
        return const CursorPage<_Item>(
          items: [_Item('one', 'one')],
          nextCursor: null,
          paginationSupported: false,
        );
      },
      extractId: (item) => item.id,
    );

    await controller.loadInitial();
    await controller.loadMore();

    expect(requests, [null]);
    expect(controller.state.paginationSupported, isFalse);
    expect(controller.state.canLoadMore, isFalse);
    expect(controller.state.nextCursor, isNull);
    controller.dispose();
  });

  test('supported null cursor marks exhaustion without relying on item count',
      () async {
    var calls = 0;
    final controller = CursorListController<_Item>(
      contextKey: 'feed:session-1:newest',
      loader: ({cursor, required limit}) async {
        calls++;
        return const CursorPage<_Item>(
          items: [_Item('one', 'one')],
          nextCursor: null,
        );
      },
      extractId: (item) => item.id,
    );

    await controller.loadInitial();
    await controller.loadMore();

    expect(calls, 1);
    expect(controller.state.paginationSupported, isTrue);
    expect(controller.state.canLoadMore, isFalse);
    expect(controller.state.ids, ['one']);
    controller.dispose();
  });
}
