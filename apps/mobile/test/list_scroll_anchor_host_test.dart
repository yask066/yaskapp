import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:yaskapp_mobile/src/core/scroll/list_scroll_state.dart';
import 'package:yaskapp_mobile/src/core/scroll/list_scroll_anchor_host.dart';

void main() {
  testWidgets('restores the visible anchor when media above it resizes', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final controller = ScrollController();
    addTearDown(controller.dispose);
    final store = ListScrollStateStore();
    const context = ListScrollContext(
      userId: 'viewer',
      route: '/feed',
      list: 'polls',
      query: '',
      filter: '',
      sort: '',
    );
    var mediaHeight = 120.0;
    final itemIds = List.generate(24, (index) => 'item-$index');

    Widget buildList() => MaterialApp(
          home: Scaffold(
            body: ListScrollAnchorHost(
              context: context,
              store: store,
              controller: controller,
              itemIds: itemIds,
              child: ListView.builder(
                controller: controller,
                itemCount: itemIds.length,
                itemBuilder: (context, index) => ListScrollAnchorItem(
                  id: itemIds[index],
                  child: SizedBox(
                    height: index == 0 ? mediaHeight : 80,
                    child: Text(itemIds[index]),
                  ),
                ),
              ),
            ),
          ),
        );

    await tester.pumpWidget(buildList());
    controller.jumpTo(600);
    await tester.pumpAndSettle();
    final anchor = find.text('item-7');
    final before = tester.getTopLeft(anchor).dy;
    expect(store.read(context)?.id, 'item-7');

    mediaHeight += 96;
    await tester.pumpWidget(buildList());
    await tester.pumpAndSettle();

    expect((tester.getTopLeft(anchor).dy - before).abs(), lessThanOrEqualTo(8));
  });

  testWidgets('restores an anchor when an unanchored sliver above it grows', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final controller = ScrollController();
    addTearDown(controller.dispose);
    final store = ListScrollStateStore();
    const context = ListScrollContext(
      userId: 'viewer',
      route: '/feed',
      list: 'polls',
      query: '',
      filter: '',
      sort: 'newest',
    );
    final itemIds = List<String>.generate(
      32,
      (index) => 'anchor-$index',
      growable: false,
    );
    var mediaHeight = 1200.0;

    Widget buildList() => MaterialApp(
          home: Scaffold(
            body: ListScrollAnchorHost(
              context: context,
              store: store,
              controller: controller,
              itemIds: itemIds,
              child: CustomScrollView(
                controller: controller,
                slivers: [
                  SliverToBoxAdapter(
                    child: SizedBox(height: mediaHeight),
                  ),
                  SliverList(
                    delegate: SliverChildBuilderDelegate(
                      (context, index) => ListScrollAnchorItem(
                        id: itemIds[index],
                        child: SizedBox(
                          height: 160,
                          child: Text(itemIds[index]),
                        ),
                      ),
                      childCount: itemIds.length,
                    ),
                  ),
                ],
              ),
            ),
          ),
        );

    await tester.pumpWidget(buildList());
    controller.jumpTo(1100);
    await tester.pumpAndSettle();
    final anchor = find.text('anchor-0');
    final before = tester.getTopLeft(anchor).dy;
    expect(store.read(context)?.id, 'anchor-0');

    mediaHeight += 96;
    await tester.pumpWidget(buildList());
    await tester.pumpAndSettle();

    expect((tester.getTopLeft(anchor).dy - before).abs(), lessThanOrEqualTo(8));
  });

  testWidgets('restores the anchor when media grows during a user scroll', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final controller = ScrollController();
    addTearDown(controller.dispose);
    final store = ListScrollStateStore();
    const context = ListScrollContext(
      userId: 'viewer',
      route: '/feed',
      list: 'polls',
      query: '',
      filter: '',
      sort: 'newest',
    );
    final itemIds = List<String>.generate(
      32,
      (index) => 'scroll-anchor-$index',
      growable: false,
    );
    var mediaHeight = 1200.0;

    Widget buildList() => MaterialApp(
          home: Scaffold(
            body: ListScrollAnchorHost(
              context: context,
              store: store,
              controller: controller,
              itemIds: itemIds,
              child: CustomScrollView(
                controller: controller,
                slivers: [
                  SliverToBoxAdapter(child: SizedBox(height: mediaHeight)),
                  SliverList(
                    delegate: SliverChildBuilderDelegate(
                      (context, index) => ListScrollAnchorItem(
                        id: itemIds[index],
                        child: SizedBox(
                          height: 160,
                          child: Text(itemIds[index]),
                        ),
                      ),
                      childCount: itemIds.length,
                    ),
                  ),
                ],
              ),
            ),
          ),
        );

    await tester.pumpWidget(buildList());
    controller.jumpTo(1100);
    await tester.pumpAndSettle();

    final gesture = await tester.startGesture(const Offset(200, 600));
    await gesture.moveBy(const Offset(0, -120));
    await tester.pump();
    final anchorId = store.read(context)!.id;
    final anchor = find.text(anchorId);
    final before = tester.getTopLeft(anchor).dy;

    mediaHeight += 96;
    await tester.pumpWidget(buildList());
    await tester.pump();
    await gesture.up();
    await tester.pumpAndSettle();

    expect((tester.getTopLeft(anchor).dy - before).abs(), lessThanOrEqualTo(8));
  });

  testWidgets('restores consecutive media growth after a scroll correction', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final controller = ScrollController();
    addTearDown(controller.dispose);
    final store = ListScrollStateStore();
    const context = ListScrollContext(
      userId: 'viewer',
      route: '/feed',
      list: 'polls',
      query: '',
      filter: '',
      sort: 'newest',
    );
    final itemIds = List<String>.generate(
      32,
      (index) => 'sequential-anchor-$index',
      growable: false,
    );
    var mediaHeight = 1200.0;
    StateSetter rebuild = (_) {};

    Widget buildList() => MaterialApp(
          home: StatefulBuilder(
            builder: (buildContext, setState) {
              rebuild = setState;
              return Scaffold(
                body: ListScrollAnchorHost(
                  context: context,
                  store: store,
                  controller: controller,
                  itemIds: itemIds,
                  child: CustomScrollView(
                    controller: controller,
                    slivers: [
                      SliverToBoxAdapter(
                        child: SizedBox(height: mediaHeight),
                      ),
                      SliverList(
                        delegate: SliverChildBuilderDelegate(
                          (context, index) => ListScrollAnchorItem(
                            id: itemIds[index],
                            child: SizedBox(
                              height: 160,
                              child: Text(itemIds[index]),
                            ),
                          ),
                          childCount: itemIds.length,
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        );

    await tester.pumpWidget(buildList());
    controller.jumpTo(1100);
    await tester.pumpAndSettle();

    final gesture = await tester.startGesture(const Offset(200, 600));
    await gesture.moveBy(const Offset(0, -120));
    await tester.pump();
    final anchorId = store.read(context)!.id;
    final anchor = find.text(anchorId);
    final before = tester.getTopLeft(anchor).dy;

    mediaHeight += 96;
    rebuild(() {});
    await tester.pump();
    await gesture.up();

    var secondGrowthApplied = false;
    var lastOffset = controller.offset;
    void growAgainAfterCorrection() {
      if (secondGrowthApplied ||
          controller.position.isScrollingNotifier.value) {
        return;
      }
      if ((controller.offset - lastOffset).abs() <= 0.5) return;
      secondGrowthApplied = true;
      mediaHeight += 96;
      rebuild(() {});
    }

    controller.addListener(growAgainAfterCorrection);
    addTearDown(() => controller.removeListener(growAgainAfterCorrection));
    await tester.pumpAndSettle();

    expect(secondGrowthApplied, isTrue);
    expect((tester.getTopLeft(anchor).dy - before).abs(), lessThanOrEqualTo(8));
  });

  testWidgets('settles when viewport growth makes the saved offset unreachable',
      (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final controller = ScrollController();
    addTearDown(controller.dispose);
    final store = ListScrollStateStore();
    const context = ListScrollContext(
      userId: 'viewer',
      route: '/feed',
      list: 'polls',
      query: '',
      filter: '',
      sort: 'newest',
    );
    final itemIds = List<String>.generate(
      24,
      (index) => 'boundary-anchor-$index',
      growable: false,
    );

    Widget buildList() => MaterialApp(
          home: Scaffold(
            body: ListScrollAnchorHost(
              context: context,
              store: store,
              controller: controller,
              itemIds: itemIds,
              child: ListView.builder(
                controller: controller,
                itemCount: itemIds.length,
                itemBuilder: (context, index) => ListScrollAnchorItem(
                  id: itemIds[index],
                  child: SizedBox(height: 80, child: Text(itemIds[index])),
                ),
              ),
            ),
          ),
        );

    await tester.pumpWidget(buildList());
    controller.jumpTo(controller.position.maxScrollExtent);
    await tester.pumpAndSettle();
    final savedAnchor = store.read(context)!;
    final initialRevision = store.revisionFor(context)!;
    final anchor = find.text(savedAnchor.id);
    final beforeTop = tester.getTopLeft(anchor).dy;

    tester.view.physicalSize = const Size(400, 900);
    await tester.pumpAndSettle();

    expect(controller.offset, closeTo(controller.position.maxScrollExtent, 1));
    expect((tester.getTopLeft(anchor).dy - beforeTop).abs(), greaterThan(8));
    expect(store.revisionFor(context), greaterThan(initialRevision));
    final rebasedRevision = store.revisionFor(context);
    final recapturedAnchor = store.read(context)!;
    final recapturedTop = tester.getTopLeft(find.text(recapturedAnchor.id)).dy;
    expect((recapturedTop - recapturedAnchor.top).abs(), lessThanOrEqualTo(1));

    await tester.pumpAndSettle();
    expect(store.revisionFor(context), rebasedRevision);
  });

  testWidgets('keeps the nearest visible neighbor when its anchor is deleted', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final controller = ScrollController();
    addTearDown(controller.dispose);
    final store = ListScrollStateStore();
    const context = ListScrollContext(
      userId: 'viewer',
      route: '/feed',
      list: 'polls',
      query: '',
      filter: '',
      sort: '',
    );
    var itemIds = List.generate(20, (index) => 'item-$index');

    Widget buildList() => MaterialApp(
          home: Scaffold(
            body: ListScrollAnchorHost(
              context: context,
              store: store,
              controller: controller,
              itemIds: itemIds,
              child: ListView.builder(
                controller: controller,
                itemCount: itemIds.length,
                itemBuilder: (context, index) => ListScrollAnchorItem(
                  id: itemIds[index],
                  child: SizedBox(height: 80, child: Text(itemIds[index])),
                ),
              ),
            ),
          ),
        );

    await tester.pumpWidget(buildList());
    controller.jumpTo(480);
    await tester.pumpAndSettle();
    final before = tester.getTopLeft(find.text('item-7')).dy;
    expect(store.read(context)?.id, 'item-6');

    itemIds = itemIds.where((id) => id != 'item-6').toList();
    await tester.pumpWidget(buildList());
    await tester.pumpAndSettle();

    expect((tester.getTopLeft(find.text('item-7')).dy - before).abs(),
        lessThanOrEqualTo(8));
  });

  testWidgets(
      'keeps the list anchor stable when the keyboard resizes its viewport', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    tester.view.viewInsets = FakeViewPadding.zero;
    addTearDown(tester.view.reset);

    final controller = ScrollController();
    addTearDown(controller.dispose);
    final store = ListScrollStateStore();
    const context = ListScrollContext(
      userId: 'viewer',
      route: '/comments',
      list: 'roots',
      query: '',
      filter: '',
      sort: 'newest',
    );
    final itemIds = List.generate(30, (index) => 'comment-$index');

    Widget buildList() => MaterialApp(
          home: Scaffold(
            body: Column(
              children: [
                Expanded(
                  child: ListScrollAnchorHost(
                    context: context,
                    store: store,
                    controller: controller,
                    itemIds: itemIds,
                    child: ListView.builder(
                      controller: controller,
                      itemCount: itemIds.length,
                      itemBuilder: (context, index) => ListScrollAnchorItem(
                        id: itemIds[index],
                        child: SizedBox(
                          height: 80,
                          child: Text(itemIds[index]),
                        ),
                      ),
                    ),
                  ),
                ),
                const TextField(
                    decoration: InputDecoration(labelText: 'Reply')),
              ],
            ),
          ),
        );

    await tester.pumpWidget(buildList());
    controller.jumpTo(640);
    await tester.pumpAndSettle();
    final anchor = find.text('comment-9');
    final before = tester.getTopLeft(anchor).dy;
    expect(store.read(context)?.id, 'comment-8');

    tester.view.viewInsets = const FakeViewPadding(bottom: 280);
    await tester.pumpAndSettle();

    expect(
        tester.getRect(find.byType(TextField)).bottom, lessThanOrEqualTo(520));
    expect((tester.getTopLeft(anchor).dy - before).abs(), lessThanOrEqualTo(8));
  });

  testWidgets('keeps the visible item anchored when earlier items are removed',
      (tester) async {
    final controller = ScrollController();
    final store = ListScrollStateStore();
    const context = ListScrollContext(
      userId: 'viewer',
      route: '/feed',
      list: 'polls',
      query: '',
      filter: '',
      sort: '',
    );
    var itemIds = List.generate(12, (index) => 'item-$index');

    Widget buildList() => MaterialApp(
          home: Scaffold(
            body: ListScrollAnchorHost(
              context: context,
              store: store,
              controller: controller,
              itemIds: itemIds,
              child: ListView.builder(
                controller: controller,
                itemCount: itemIds.length,
                itemBuilder: (context, index) => ListScrollAnchorItem(
                  id: itemIds[index],
                  child: InkWell(
                    onTap: () => Navigator.of(context).push<void>(
                      MaterialPageRoute<void>(
                        builder: (context) => Scaffold(
                          body: Center(
                            child: TextButton(
                              onPressed: () => Navigator.of(context).pop(),
                              child: const Text('child detail'),
                            ),
                          ),
                        ),
                      ),
                    ),
                    child: SizedBox(
                      height: 80,
                      child: Text(itemIds[index]),
                    ),
                  ),
                ),
              ),
            ),
          ),
        );

    await tester.pumpWidget(buildList());
    controller.jumpTo(405);
    await tester.pumpAndSettle();
    final before = tester.getTopLeft(find.text('item-5')).dy;
    expect(store.read(context)?.id, 'item-5');

    itemIds = itemIds.sublist(3);
    await tester.pumpWidget(buildList());
    await tester.pumpAndSettle();

    final after = tester.getTopLeft(find.text('item-5')).dy;
    expect((after - before).abs(), lessThanOrEqualTo(2));

    itemIds = [...itemIds, ...List.generate(8, (index) => 'next-$index')];
    await tester.pumpWidget(buildList());
    await tester.pumpAndSettle();
    final beforeDetail = tester.getTopLeft(find.text('item-5')).dy;
    await tester.tap(find.text('item-5'));
    await tester.pumpAndSettle();
    expect(find.text('child detail'), findsOneWidget);
    await tester.tap(find.text('child detail'));
    await tester.pumpAndSettle();
    final afterBack = tester.getTopLeft(find.text('item-5')).dy;
    expect((afterBack - beforeDetail).abs(), lessThanOrEqualTo(2));
    controller.dispose();
  });
}
