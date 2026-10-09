import 'package:flutter/widgets.dart';

/// Motion configuration for the current app presentation.
///
/// Settings are deliberately independent of the authenticated session. The
/// application supplies the two rollout flags; the system accessibility
/// preference always takes precedence when deciding whether motion may run.
@immutable
class MotionSettings {
  const MotionSettings({
    required this.reactionsMotion,
    required this.entryMotion,
    required this.reduceMotion,
    required this.animationsSuspended,
  });

  final bool reactionsMotion;
  final bool entryMotion;
  final bool reduceMotion;

  /// True while the app is backgrounded or otherwise not in the resumed state.
  final bool animationsSuspended;

  /// Whether a new motion effect may start under the current settings.
  bool get canAnimate => !reduceMotion && !animationsSuspended;

  bool get reactionsEnabled => reactionsMotion && canAnimate;

  bool get entryEnabled => entryMotion && canAnimate;

  static MotionSettings of(BuildContext context) {
    final scope =
        context.dependOnInheritedWidgetOfExactType<_MotionSettingsData>();
    // Missing injection fails closed: standalone widgets stay static.
    final disableAnimations =
        MediaQuery.maybeOf(context)?.disableAnimations ?? false;

    return MotionSettings(
      reactionsMotion: scope?.reactionsMotion ?? false,
      entryMotion: scope?.entryMotion ?? false,
      reduceMotion: disableAnimations,
      animationsSuspended: !(scope?.isResumed ?? true),
    );
  }
}

/// App-level, session-independent injection point for motion rollout flags.
class MotionSettingsScope extends StatefulWidget {
  const MotionSettingsScope({
    required this.child,
    this.reactionsMotion = false,
    this.entryMotion = false,
    super.key,
  });

  final bool reactionsMotion;
  final bool entryMotion;
  final Widget child;

  @override
  State<MotionSettingsScope> createState() => _MotionSettingsScopeState();
}

class _MotionSettingsScopeState extends State<MotionSettingsScope>
    with WidgetsBindingObserver {
  var _isResumed = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final isResumed = state == AppLifecycleState.resumed;
    if (_isResumed == isResumed) {
      return;
    }
    setState(() => _isResumed = isResumed);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => _MotionSettingsData(
        reactionsMotion: widget.reactionsMotion,
        entryMotion: widget.entryMotion,
        isResumed: _isResumed,
        child: widget.child,
      );
}

class _MotionSettingsData extends InheritedWidget {
  const _MotionSettingsData({
    required this.reactionsMotion,
    required this.entryMotion,
    required this.isResumed,
    required super.child,
  });

  final bool reactionsMotion;
  final bool entryMotion;
  final bool isResumed;

  @override
  bool updateShouldNotify(_MotionSettingsData oldWidget) =>
      reactionsMotion != oldWidget.reactionsMotion ||
      entryMotion != oldWidget.entryMotion ||
      isResumed != oldWidget.isResumed;
}
