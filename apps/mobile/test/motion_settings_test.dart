import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/core/motion/motion_settings.dart';

void main() {
  testWidgets('flags default off and can be injected independently',
      (tester) async {
    MotionSettings? settings;
    await tester.pumpWidget(MaterialApp(
      home: MotionSettingsScope(
        child: Builder(
          builder: (context) {
            settings = MotionSettings.of(context);
            return const SizedBox.shrink();
          },
        ),
      ),
    ));

    expect(settings!.reactionsMotion, isFalse);
    expect(settings!.entryMotion, isFalse);

    await tester.pumpWidget(MaterialApp(
      home: const MotionSettingsScope(
        reactionsMotion: true,
        entryMotion: false,
        child: _SettingsProbe(),
      ),
    ));
    expect(find.text('reactions=true,entry=false'), findsOneWidget);
  });

  testWidgets('system disableAnimations updates live and wins over flags',
      (tester) async {
    var disableAnimations = false;
    await tester.pumpWidget(MaterialApp(
      home: StatefulBuilder(
        builder: (context, setState) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            disableAnimations: disableAnimations,
          ),
          child: MotionSettingsScope(
            reactionsMotion: true,
            entryMotion: true,
            child: Column(
              children: [
                const _SettingsProbe(),
                TextButton(
                  onPressed: () => setState(() => disableAnimations = true),
                  child: const Text('Reduce motion'),
                ),
              ],
            ),
          ),
        ),
      ),
    ));

    expect(find.text('reduce=false'), findsOneWidget);
    await tester.tap(find.text('Reduce motion'));
    await tester.pump();
    expect(find.text('reduce=true'), findsOneWidget);
    expect(find.text('reactions=true,entry=true'), findsOneWidget);
    expect(find.text('enabled=false'), findsOneWidget);
  });

  testWidgets('lifecycle pause suspends animation and resume restores it',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: MotionSettingsScope(child: _SettingsProbe()),
    ));
    expect(find.text('suspended=false'), findsOneWidget);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump();
    expect(find.text('suspended=true'), findsOneWidget);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(find.text('suspended=false'), findsOneWidget);
  });

  testWidgets('switching to reduced motion completes an active effect',
      (tester) async {
    var disableAnimations = false;
    await tester.pumpWidget(MaterialApp(
      home: StatefulBuilder(
        builder: (context, setState) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            disableAnimations: disableAnimations,
          ),
          child: MotionSettingsScope(
            child: Column(
              children: [
                const _MotionEffectProbe(),
                TextButton(
                  onPressed: () => setState(() => disableAnimations = true),
                  child: const Text('Reduce motion'),
                ),
              ],
            ),
          ),
        ),
      ),
    ));
    await tester.pump(const Duration(milliseconds: 100));
    expect(tester.widget<Opacity>(find.byType(Opacity)).opacity, lessThan(1));

    await tester.tap(find.text('Reduce motion'));
    await tester.pump();
    expect(tester.widget<Opacity>(find.byType(Opacity)).opacity, 1);
  });
}

class _SettingsProbe extends StatelessWidget {
  const _SettingsProbe();

  @override
  Widget build(BuildContext context) {
    final settings = MotionSettings.of(context);
    return Column(
      children: [
        Text(
          'reactions=${settings.reactionsMotion},entry=${settings.entryMotion}',
        ),
        Text('reduce=${settings.reduceMotion}'),
        Text('suspended=${settings.animationsSuspended}'),
        Text('enabled=${settings.reactionsEnabled || settings.entryEnabled}'),
      ],
    );
  }
}

class _MotionEffectProbe extends StatefulWidget {
  const _MotionEffectProbe();

  @override
  State<_MotionEffectProbe> createState() => _MotionEffectProbeState();
}

class _MotionEffectProbeState extends State<_MotionEffectProbe>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 1),
  )..forward();

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MotionSettings.of(context).reduceMotion) {
      _controller.value = 1;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Opacity(
        opacity: _controller.value,
        child: const Text('Effect'),
      );
}
