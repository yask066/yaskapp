import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/core/motion/entry_motion.dart';
import 'package:yaskapp_mobile/src/core/motion/motion_settings.dart';
import 'package:yaskapp_mobile/src/core/widgets/content_skeleton.dart';

void main() {
  testWidgets('fades and translates a first visible item for 200 ms', (
    tester,
  ) async {
    await tester.pumpWidget(_app(_entry()));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(_opacity(tester), inInclusiveRange(0.0, 1.0));
    expect(_opacity(tester), lessThan(1));
    expect(_translationY(tester), inInclusiveRange(0.0, 8.0));
    expect(_translationY(tester), greaterThan(0));

    await tester.pump(const Duration(milliseconds: 100));
    expect(_opacity(tester), 1);
    expect(_translationY(tester), 0);
  });

  testWidgets('marks an offscreen or initially invisible item as seen', (
    tester,
  ) async {
    await tester.pumpWidget(_app(_entry(visible: false)));
    await tester.pump();
    expect(_opacity(tester), 1);

    await tester.pumpWidget(_app(_entry(visible: true)));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
    expect(_opacity(tester), 1);
  });

  testWidgets('flags off stays static and enabling later does not replay', (
    tester,
  ) async {
    await tester.pumpWidget(_appBuilder(_entry(), entryMotion: false));
    await tester.pump();
    expect(_opacity(tester), 1);

    await tester.pumpWidget(_app(_entry()));
    await tester.pump(const Duration(milliseconds: 200));
    expect(_opacity(tester), 1);
  });

  testWidgets('a new list context gets a fresh entry batch', (tester) async {
    Widget app(String contextKey) => MaterialApp(
          home: MotionSettingsScope(
            entryMotion: true,
            child: Scaffold(
              body: EntryMotionRegistryScope(
                contextKey: contextKey,
                child: EntryMotion(
                  contextKey: contextKey,
                  itemId: 'poll-1',
                  visible: true,
                  indexInBatch: 0,
                  child: const Text('card'),
                ),
              ),
            ),
          ),
        );

    await tester.pumpWidget(app('search:climate'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
    expect(_opacity(tester), 1);

    await tester.pumpWidget(app('search:movies'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(_opacity(tester), lessThan(1));
  });

  testWidgets('does not replay entry after a virtualized row remount', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final controller = ScrollController();
    addTearDown(controller.dispose);

    Widget list() => MaterialApp(
          home: MotionSettingsScope(
            entryMotion: true,
            child: EntryMotionRegistryScope(
              contextKey: 'feed',
              child: ListView.builder(
                controller: controller,
                itemExtent: 120,
                itemCount: 20,
                itemBuilder: (context, index) => EntryMotion(
                  contextKey: 'feed',
                  itemId: 'row-$index',
                  visible: true,
                  indexInBatch: index,
                  child: Text('row-$index'),
                ),
              ),
            ),
          ),
        );

    await tester.pumpWidget(list());
    await tester.pump(const Duration(milliseconds: 200));
    expect(find.text('row-0'), findsOneWidget);

    controller.jumpTo(1200);
    await tester.pump();
    expect(find.text('row-0'), findsNothing);

    controller.jumpTo(0);
    await tester.pump();
    expect(find.text('row-0'), findsOneWidget);
    expect(_opacityFor(tester, 'row-0'), 1);
  });

  testWidgets('stagger stays within six items and the 400 ms sequence', (
    tester,
  ) async {
    await tester.pumpWidget(_app(_entry(indexInBatch: 5)));
    await tester.pump(const Duration(milliseconds: 174));
    expect(_opacity(tester), 0);
    await tester.pump(const Duration(milliseconds: 1));
    await tester.pump(const Duration(milliseconds: 200));
    expect(_opacity(tester), 1);

    await tester.pumpWidget(_app(_entry(itemId: 'seventh', indexInBatch: 6)));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 1));
    expect(_opacity(tester), greaterThan(0));
  });

  testWidgets('reduced motion finishes a running entry immediately', (
    tester,
  ) async {
    var reduceMotion = false;
    await tester.pumpWidget(_appBuilder(
      _entry(),
      reduceMotion: () => reduceMotion,
    ));
    await tester.pump(const Duration(milliseconds: 80));
    expect(_opacity(tester), lessThan(1));

    reduceMotion = true;
    await tester.pumpWidget(_appBuilder(
      _entry(),
      reduceMotion: () => reduceMotion,
    ));
    await tester.pump();
    expect(_opacity(tester), 1);
  });

  testWidgets('TickerMode pauses and resumes an active entry', (tester) async {
    var enabled = true;
    await tester.pumpWidget(_appBuilder(
      _entry(),
      tickerEnabled: () => enabled,
    ));
    await tester.pump(const Duration(milliseconds: 80));
    final pausedOpacity = _opacity(tester);

    enabled = false;
    await tester.pumpWidget(_appBuilder(
      _entry(),
      tickerEnabled: () => enabled,
    ));
    await tester.pump(const Duration(milliseconds: 200));
    expect(_opacity(tester), pausedOpacity);

    enabled = true;
    await tester.pumpWidget(_appBuilder(
      _entry(),
      tickerEnabled: () => enabled,
    ));
    await tester.pump(const Duration(milliseconds: 200));
    expect(_opacity(tester), 1);
  });

  testWidgets('backgrounding finishes motion and does not replay on resume', (
    tester,
  ) async {
    await tester.pumpWidget(_app(_entry()));
    await tester.pump(const Duration(milliseconds: 80));
    expect(_opacity(tester), lessThan(1));

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump();
    expect(_opacity(tester), 1);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(_opacity(tester), 1);
  });

  testWidgets('hit targets remain interactive at zero opacity', (tester) async {
    var tapped = false;
    await tester.pumpWidget(_app(EntryMotion(
      contextKey: 'feed',
      itemId: 'button',
      visible: true,
      indexInBatch: 0,
      child: ElevatedButton(
        onPressed: () => tapped = true,
        child: const Text('Action'),
      ),
    )));

    await tester.tap(find.text('Action'));
    expect(tapped, isTrue);
  });

  testWidgets('dispose cancels a pending stagger timer', (tester) async {
    await tester.pumpWidget(_app(_entry(indexInBatch: 5)));
    await tester.pumpWidget(_app(const SizedBox.shrink()));
    await tester.pump(const Duration(seconds: 1));

    expect(tester.takeException(), isNull);
  });

  testWidgets('skeleton and loaded content crossfade in at most 120 ms', (
    tester,
  ) async {
    var loading = true;
    await tester.pumpWidget(_skeletonApp(loading));
    expect(find.text('skeleton'), findsOneWidget);

    loading = false;
    await tester.pumpWidget(_skeletonApp(loading));
    await tester.pump(const Duration(milliseconds: 60));
    await tester.pump();
    expect(find.text('content'), findsOneWidget);
    expect(find.text('skeleton'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 60));
    expect(find.text('content'), findsOneWidget);
    final skeletonFade = find.ancestor(
      of: find.text('skeleton'),
      matching: find.byType(FadeTransition),
    );
    expect(
      tester.widget<FadeTransition>(skeletonFade.first).opacity.value,
      0,
    );
  });

  testWidgets('reduced motion finishes a skeleton crossfade immediately', (
    tester,
  ) async {
    await tester.pumpWidget(_skeletonApp(true));
    await tester.pumpWidget(_skeletonApp(false));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 60));
    expect(_fadeFor(tester, 'skeleton'), greaterThan(0));

    await tester.pumpWidget(_skeletonApp(false, reduceMotion: true));
    await tester.pump();
    expect(find.text('skeleton'), findsNothing);
    expect(find.text('content'), findsOneWidget);
  });
}

double _fadeFor(WidgetTester tester, String text) => tester
    .widget<FadeTransition>(
      find
          .ancestor(of: find.text(text), matching: find.byType(FadeTransition))
          .first,
    )
    .opacity
    .value;

Widget _skeletonApp(bool loading, {bool reduceMotion = false}) => MaterialApp(
      home: MotionSettingsScope(
        entryMotion: true,
        child: MediaQuery(
          data: MediaQueryData(disableAnimations: reduceMotion),
          child: Scaffold(
            body: ContentEntryTransition(
              loading: loading,
              skeleton: const Text('skeleton'),
              child: const Text('content'),
            ),
          ),
        ),
      ),
    );

Widget _app(Widget child) => _appBuilder(child);

Widget _appBuilder(
  Widget child, {
  bool entryMotion = true,
  bool Function()? reduceMotion,
  bool Function()? tickerEnabled,
}) {
  final reduce = reduceMotion?.call() ?? false;
  final ticker = tickerEnabled?.call() ?? true;
  return MaterialApp(
    home: MotionSettingsScope(
      entryMotion: entryMotion,
      child: TickerMode(
        enabled: ticker,
        child: MediaQuery(
          data: MediaQueryData(disableAnimations: reduce),
          child: Scaffold(
              body: EntryMotionRegistryScope(
            contextKey: 'feed',
            child: child,
          )),
        ),
      ),
    ),
  );
}

Widget _entry({
  String contextKey = 'feed',
  String itemId = 'poll-1',
  bool visible = true,
  int indexInBatch = 0,
}) =>
    EntryMotion(
      contextKey: contextKey,
      itemId: itemId,
      visible: visible,
      indexInBatch: indexInBatch,
      child: const SizedBox(width: 100, height: 48, child: Text('card')),
    );

double _opacity(WidgetTester tester) => tester
    .widget<Opacity>(
      find.byKey(const ValueKey('entry-motion-opacity')),
    )
    .opacity;

double _opacityFor(WidgetTester tester, String text) => tester
    .widget<Opacity>(
      find.ancestor(of: find.text(text), matching: find.byType(Opacity)).first,
    )
    .opacity;

double _translationY(WidgetTester tester) => tester
    .widget<Transform>(find.byKey(const ValueKey('entry-motion-translation')))
    .transform
    .getTranslation()
    .y;
