import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/core/motion/motion_settings.dart';
import 'package:yaskapp_mobile/src/core/motion/animated_count.dart';

void main() {
  testWidgets('shows target semantics immediately and animates the value', (
    tester,
  ) async {
    await tester
        .pumpWidget(_host(const AnimatedCount(value: 9, enabled: true)));
    expect(find.text('9'), findsOneWidget);

    await tester
        .pumpWidget(_host(const AnimatedCount(value: 10, enabled: true)));
    expect(find.bySemanticsLabel('10'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 30));
    expect(_visibleCount(tester), 9);
    await tester.pump(const Duration(milliseconds: 150));
    expect(_visibleCount(tester), 10);
  });

  testWidgets('animates digit-boundary changes and decreases', (tester) async {
    for (final values in [
      (9, 10),
      (99, 100),
      (999, 1000),
      (1000, 999),
    ]) {
      await tester.pumpWidget(_host(
        AnimatedCount(value: values.$1, enabled: true),
      ));
      await tester.pumpWidget(_host(
        AnimatedCount(value: values.$2, enabled: true),
      ));
      await tester.pump(const Duration(milliseconds: 180));
      expect(_visibleCount(tester), values.$2);
    }
  });

  testWidgets('interrupts a count transition from its current visual value', (
    tester,
  ) async {
    await tester
        .pumpWidget(_host(const AnimatedCount(value: 0, enabled: true)));
    await tester
        .pumpWidget(_host(const AnimatedCount(value: 100, enabled: true)));
    await tester.pump(const Duration(milliseconds: 90));
    final current = _visibleCount(tester);
    expect(current, greaterThan(0));
    expect(current, lessThan(100));

    await tester
        .pumpWidget(_host(const AnimatedCount(value: 0, enabled: true)));
    expect(_visibleCount(tester), current);
    expect(find.bySemanticsLabel('0'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 180));
    expect(_visibleCount(tester), 0);
  });

  testWidgets('disabled and reduced motion updates are immediate',
      (tester) async {
    var reduceMotion = false;
    Widget build(int value, {bool enabled = true}) => MaterialApp(
          home: StatefulBuilder(
            builder: (context, setState) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                disableAnimations: reduceMotion,
              ),
              child: MotionSettingsScope(
                reactionsMotion: true,
                child: Column(
                  children: [
                    AnimatedCount(value: value, enabled: enabled),
                    TextButton(
                      onPressed: () => setState(() => reduceMotion = true),
                      child: const Text('Reduce motion'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );

    await tester.pumpWidget(build(9));
    await tester.pumpWidget(build(10));
    expect(_visibleCount(tester), 9);
    await tester.pumpWidget(build(11, enabled: false));
    expect(_visibleCount(tester), 11);

    await tester.pumpWidget(build(9));
    await tester.pumpWidget(build(10));
    await tester.pump(const Duration(milliseconds: 50));
    await tester.tap(find.text('Reduce motion'));
    await tester.pump();
    expect(_visibleCount(tester), 10);
  });

  testWidgets('clamps zero and negative values without invalid output', (
    tester,
  ) async {
    await tester
        .pumpWidget(_host(const AnimatedCount(value: -4, enabled: true)));
    expect(find.text('0'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('background lifecycle completes the current target immediately', (
    tester,
  ) async {
    await tester
        .pumpWidget(_host(const AnimatedCount(value: 1, enabled: true)));
    await tester
        .pumpWidget(_host(const AnimatedCount(value: 100, enabled: true)));
    await tester.pump(const Duration(milliseconds: 30));
    expect(_visibleCount(tester), lessThan(100));

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump();
    expect(_visibleCount(tester), 100);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(_visibleCount(tester), 100);
  });

  testWidgets('disposing mid-transition releases its controller',
      (tester) async {
    await tester
        .pumpWidget(_host(const AnimatedCount(value: 1, enabled: true)));
    await tester
        .pumpWidget(_host(const AnimatedCount(value: 100, enabled: true)));
    await tester.pump(const Duration(milliseconds: 30));
    await tester.pumpWidget(const MaterialApp(home: SizedBox.shrink()));
    await tester.pump(const Duration(seconds: 1));
    expect(tester.takeException(), isNull);
  });
}

Widget _host(Widget child) => MaterialApp(
      builder: (context, _) => MotionSettingsScope(
        reactionsMotion: true,
        child: Scaffold(body: Center(child: child)),
      ),
    );

int _visibleCount(WidgetTester tester) {
  final text = tester.widget<Text>(find.byType(Text).first).data;
  final value = text!;
  if (value.endsWith('K')) {
    return int.parse(value.substring(0, value.length - 1)) * 1000;
  }
  if (value.endsWith('M')) {
    return int.parse(value.substring(0, value.length - 1)) * 1000000;
  }
  return int.parse(value);
}
