import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/core/widgets/pagination_footer.dart';

void main() {
  testWidgets('shows a manual load action when another page is available',
      (tester) async {
    var loads = 0;
    await tester.pumpWidget(MaterialApp(
      home: PaginationFooter(
        hasMore: true,
        onLoadMore: () => loads++,
      ),
    ));

    await tester.tap(find.text('Load more'));

    expect(loads, 1);
  });

  testWidgets('shows progress while an append is pending', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: PaginationFooter(hasMore: true, loading: true),
    ));

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.text('Load more'), findsNothing);
  });

  testWidgets('shows a terminal message only for a supported exhausted page',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: PaginationFooter(hasMore: false),
    ));

    expect(find.text("You're all caught up."), findsOneWidget);
  });

  testWidgets('does not claim the end for a legacy response', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: PaginationFooter(
        hasMore: false,
        paginationSupported: false,
      ),
    ));

    expect(find.text("You're all caught up."), findsNothing);
    expect(find.text('Load more'), findsNothing);
  });

  testWidgets('offers Retry for a failed append', (tester) async {
    var retries = 0;
    await tester.pumpWidget(MaterialApp(
      home: PaginationFooter(
        hasMore: true,
        error: StateError('offline'),
        onRetry: () => retries++,
      ),
    ));

    expect(find.text('Could not load more.'), findsOneWidget);
    await tester.tap(find.text('Retry'));

    expect(retries, 1);
  });
}
