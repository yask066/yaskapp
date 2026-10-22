import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show LogicalKeyboardKey;
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

  testWidgets(
      'manual continuation and Retry expose labels and accept keyboard input', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    var loads = 0;
    var retries = 0;

    try {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: PaginationFooter(
            hasMore: true,
            onLoadMore: () => loads++,
          ),
        ),
      ));

      expect(
        tester.getSemantics(find.byType(OutlinedButton)).label,
        'Load more',
      );
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      expect(loads, 1);

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: PaginationFooter(
            hasMore: true,
            error: StateError('offline'),
            onRetry: () => retries++,
          ),
        ),
      ));

      expect(tester.getSemantics(find.byType(OutlinedButton)).label, 'Retry');
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      expect(retries, 1);
    } finally {
      semantics.dispose();
    }
  });

  testWidgets('keeps keyboard focus through append loading and Retry', (
    tester,
  ) async {
    final key = GlobalKey<_FooterFocusHarnessState>();
    await tester.pumpWidget(MaterialApp(home: _FooterFocusHarness(key: key)));

    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    expect(find.bySemanticsLabel('Loading more'), findsOneWidget);

    key.currentState!.failAppend();
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);

    expect(key.currentState!.retryCalls, 1);
  });

  testWidgets('does not restore footer focus after exhaustion and refresh', (
    tester,
  ) async {
    final key = GlobalKey<_FooterFocusHarnessState>();
    await tester.pumpWidget(MaterialApp(home: _FooterFocusHarness(key: key)));

    final footerActionNode =
        tester.widget<OutlinedButton>(find.byType(OutlinedButton)).focusNode!;
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    expect(footerActionNode.hasFocus, isTrue);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();

    key.currentState!.exhaustPages();
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    expect(key.currentState!.otherActionFocusNode.hasFocus, isTrue);

    key.currentState!.refreshPages();
    await tester.pumpAndSettle();

    expect(key.currentState!.otherActionFocusNode.hasFocus, isTrue);
    expect(footerActionNode.hasFocus, isFalse);
  });

  testWidgets('manual continuation remains readable with enlarged text', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 240);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(MaterialApp(
      home: MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(2)),
        child: Scaffold(
          body: ListView(
            children: const [PaginationFooter(hasMore: true)],
          ),
        ),
      ),
    ));

    expect(find.text('Load more'), findsOneWidget);
    expect(tester.getRect(find.byType(OutlinedButton)).width, greaterThan(0));
    expect(tester.takeException(), isNull);
  });
}

class _FooterFocusHarness extends StatefulWidget {
  const _FooterFocusHarness({super.key});

  @override
  State<_FooterFocusHarness> createState() => _FooterFocusHarnessState();
}

class _FooterFocusHarnessState extends State<_FooterFocusHarness> {
  var _loading = false;
  var _failed = false;
  var _hasMore = true;
  var retryCalls = 0;
  final otherActionFocusNode = FocusNode(debugLabel: 'other action test node');

  @override
  void dispose() {
    otherActionFocusNode.dispose();
    super.dispose();
  }

  void failAppend() => setState(() {
        _loading = false;
        _failed = true;
      });

  void _load() => setState(() {
        _loading = true;
        _failed = false;
      });

  void exhaustPages() => setState(() {
        _loading = false;
        _failed = false;
        _hasMore = false;
      });

  void refreshPages() => setState(() {
        _hasMore = true;
      });

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Column(
          children: [
            PaginationFooter(
              hasMore: _hasMore,
              loading: _loading,
              error: _failed ? StateError('offline') : null,
              onLoadMore: _load,
              onRetry: () {
                retryCalls++;
                _load();
              },
              key: const ValueKey('footer'),
            ),
            TextButton(
              focusNode: otherActionFocusNode,
              onPressed: () {},
              child: const Text('Other action'),
            ),
          ],
        ),
      );
}
