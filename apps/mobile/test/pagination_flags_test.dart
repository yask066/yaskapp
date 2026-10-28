import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/core/pagination/cursor_list_controller.dart';
import 'package:yaskapp_mobile/src/core/pagination/cursor_page.dart';
import 'package:yaskapp_mobile/src/core/pagination/feed_pagination_flags.dart';

class _Item {
  const _Item(this.id);

  final String id;
}

void main() {
  test('feed pagination build flag defaults off', () {
    expect(FeedPaginationFlags.enabled, isFalse);
  });

  test('feed pagination build flag follows its environment define', () {
    expect(
      FeedPaginationFlags.enabled,
      const bool.fromEnvironment(
        'YASKAPP_FEED_PAGINATION',
        defaultValue: false,
      ),
    );
  });

  test('disabled pagination still loads the first page and stops there',
      () async {
    final cursors = <String?>[];
    final controller = CursorListController<_Item>(
      contextKey: 'feed:flag-off',
      paginationEnabled: false,
      loader: ({cursor, required limit}) async {
        cursors.add(cursor);
        return CursorPage<_Item>(
          items: [const _Item('first-page')],
          nextCursor: cursor == null ? 'next-page' : null,
        );
      },
      extractId: (item) => item.id,
    );
    addTearDown(controller.dispose);

    await controller.loadInitial();
    await controller.loadMore();

    expect(controller.state.items.map((item) => item.id), ['first-page']);
    expect(controller.state.canLoadMore, isFalse);
    expect(cursors, [null]);
  });
}
