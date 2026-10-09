import 'package:flutter/foundation.dart';

/// Build-time rollout settings for decorative motion.
///
/// Both flags default to false. Change them with `--dart-define` when building
/// a client; changing either value requires a new application build.
@immutable
class MotionFlags {
  const MotionFlags({
    required this.reactionsMotion,
    required this.entryMotion,
  });

  const MotionFlags.fromEnvironment()
      : reactionsMotion = const bool.fromEnvironment(
          'YASKAPP_REACTIONS_MOTION',
          defaultValue: false,
        ),
        entryMotion = const bool.fromEnvironment(
          'YASKAPP_ENTRY_MOTION',
          defaultValue: false,
        );

  final bool reactionsMotion;
  final bool entryMotion;
}
