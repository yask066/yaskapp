import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:yaskapp_mobile/src/core/scroll/list_scroll_state.dart';
import 'package:yaskapp_mobile/src/core/scroll/list_scroll_anchor_host.dart';

void main() {
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

    itemIds = [...itemIds, ...List.generate(8, (index) => 'next-${index}')];
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
