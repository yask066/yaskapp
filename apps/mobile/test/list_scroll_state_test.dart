import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/core/scroll/list_scroll_state.dart';

void main() {
  const context = ListScrollContext(
    userId: 'user-1',
    route: '/search',
    list: 'poll-results',
    query: 'motion',
    filter: 'polls',
    sort: 'newest',
  );

  group('ListScrollStateStore', () {
    test('isolates saved anchors by route, query, filter, sort, and user', () {
      final store = ListScrollStateStore();
      store.capture(context, const ListAnchor(id: 'poll-1', top: 84));

      expect(store.read(context), const ListAnchor(id: 'poll-1', top: 84));
      expect(store.read(context.copyWith(query: 'scroll')), isNull);
      expect(store.read(context.copyWith(filter: 'users')), isNull);
      expect(store.read(context.copyWith(sort: 'popular')), isNull);
      expect(store.read(context.copyWith(route: '/profile')), isNull);
      expect(store.read(context.copyWith(userId: 'user-2')), isNull);
      expect(
        context.copyWith(userId: null),
        const ListScrollContext(
          userId: null,
          route: '/search',
          list: 'poll-results',
          query: 'motion',
          filter: 'polls',
          sort: 'newest',
        ),
      );
    });

    test('clears all saved contexts for a logged-out user', () {
      final store = ListScrollStateStore();
      store.capture(context, const ListAnchor(id: 'poll-1', top: 84));
      store.capture(
        context.copyWith(list: 'people'),
        const ListAnchor(id: 'user-1', top: 22),
      );
      store.capture(
        context.copyWith(userId: 'user-2'),
        const ListAnchor(id: 'poll-2', top: 15),
      );

      store.clearForUser('user-1');

      expect(store.read(context), isNull);
      expect(store.read(context.copyWith(list: 'people')), isNull);
      expect(
        store.read(context.copyWith(userId: 'user-2')),
        const ListAnchor(id: 'poll-2', top: 15),
      );
    });

    test('keeps the anchor through append and falls forward after deletion',
        () {
      final store = ListScrollStateStore();
      store.capture(
        context,
        const ListAnchor(id: 'poll-2', top: 64),
        visibleAnchors: const [
          ListAnchor(id: 'poll-2', top: 64),
          ListAnchor(id: 'poll-3', top: 240),
          ListAnchor(id: 'poll-4', top: 416),
        ],
        itemIds: const ['poll-1', 'poll-2', 'poll-3', 'poll-4'],
      );

      expect(
        store.read(context, currentItemIds: const [
          'poll-0',
          'poll-1',
          'poll-2',
          'poll-3',
          'poll-4',
        ]),
        const ListAnchor(id: 'poll-2', top: 64),
      );
      expect(
        store.read(context,
            currentItemIds: const ['poll-1', 'poll-3', 'poll-4']),
        const ListAnchor(id: 'poll-3', top: 240),
      );
    });

    test(
        'preserves a surviving anchor after multiple preceding items are removed',
        () {
      final store = ListScrollStateStore();
      store.capture(
        context,
        const ListAnchor(id: 'poll-4', top: 72),
        visibleAnchors: const [
          ListAnchor(id: 'poll-4', top: 72),
          ListAnchor(id: 'poll-5', top: 248),
        ],
        itemIds: const ['poll-1', 'poll-2', 'poll-3', 'poll-4', 'poll-5'],
      );

      expect(
        store.read(context, currentItemIds: const ['poll-4', 'poll-5']),
        const ListAnchor(id: 'poll-4', top: 72),
      );
    });

    test('falls back to the nearest previous surviving item or an empty result',
        () {
      final store = ListScrollStateStore();
      store.capture(
        context,
        const ListAnchor(id: 'poll-3', top: 80),
        visibleAnchors: const [
          ListAnchor(id: 'poll-3', top: 80),
          ListAnchor(id: 'poll-4', top: 260),
        ],
        itemIds: const ['poll-1', 'poll-2', 'poll-3', 'poll-4'],
      );

      expect(
        store.read(context, currentItemIds: const ['poll-1', 'poll-2']),
        const ListAnchor(id: 'poll-2', top: 80),
      );
      expect(store.read(context, currentItemIds: const []), isNull);
      expect(store.read(context.copyWith(query: 'other')), isNull);
    });
  });

  testWidgets('restores an anchor after layout without animated scrolling',
      (tester) async {
    final store = ListScrollStateStore();
    final controller = ScrollController();
    final targetKey = GlobalKey();
    var spacerHeight = 300.0;

    double? targetTop(String id) {
      if (id != 'poll-2' || targetKey.currentContext == null) return null;
      final renderObject =
          targetKey.currentContext!.findRenderObject()! as RenderBox;
      return renderObject.localToGlobal(Offset.zero).dy;
    }

    Widget buildList() => MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              controller: controller,
              child: Column(
                children: [
                  SizedBox(height: spacerHeight),
                  SizedBox(key: targetKey, height: 120),
                  const SizedBox(height: 900),
                ],
              ),
            ),
          ),
        );

    await tester.pumpWidget(buildList());
    controller.jumpTo(180);
    await tester.pump();
    final savedTop = targetTop('poll-2')!;
    store.capture(context, ListAnchor(id: 'poll-2', top: savedTop));

    spacerHeight += 48;
    await tester.pumpWidget(buildList());
    await tester.pump();
    expect(targetTop('poll-2'), savedTop + 48);

    final restored = ListScrollRestoration.restoreAfterLayout(
      store: store,
      context: context,
      currentItemIds: const ['poll-1', 'poll-2'],
      controller: controller,
      anchorTop: targetTop,
    );
    await tester.pump();
    expect(await restored, isTrue);
    expect(targetTop('poll-2'), closeTo(savedTop, 0.01));

    controller.dispose();
  });

  test('clamps corrected offsets to the current scroll extents', () {
    expect(
      ListScrollRestoration.correctedOffset(
        currentOffset: 100,
        currentAnchorTop: 125,
        savedAnchor: const ListAnchor(id: 'poll-2', top: 75),
        minScrollExtent: 0,
        maxScrollExtent: 200,
      ),
      150,
    );
    expect(
      ListScrollRestoration.correctedOffset(
        currentOffset: 180,
        currentAnchorTop: 140,
        savedAnchor: const ListAnchor(id: 'poll-2', top: 40),
        minScrollExtent: 0,
        maxScrollExtent: 200,
      ),
      200,
    );
  });

  testWidgets('does not override an explicit comment target', (tester) async {
    final store = ListScrollStateStore();
    final controller = ScrollController();
    final targetKey = GlobalKey();
    store.capture(context, const ListAnchor(id: 'poll-2', top: 40));

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            controller: controller,
            child: Column(
              children: [
                const SizedBox(height: 300),
                SizedBox(key: targetKey, height: 100),
                const SizedBox(height: 900),
              ],
            ),
          ),
        ),
      ),
    );
    controller.jumpTo(180);
    await tester.pump();
    final explicitTargetOffset = controller.offset;
    var anchorWasRead = false;

    final restored = ListScrollRestoration.restoreAfterLayout(
      store: store,
      context: context,
      currentItemIds: const ['poll-2'],
      controller: controller,
      hasExplicitTarget: true,
      anchorTop: (_) {
        anchorWasRead = true;
        final box = targetKey.currentContext!.findRenderObject()! as RenderBox;
        return box.localToGlobal(Offset.zero).dy;
      },
    );
    await tester.pump();

    expect(await restored, isFalse);
    expect(anchorWasRead, isFalse);
    expect(controller.offset, explicitTargetOffset);
    controller.dispose();
  });
}
