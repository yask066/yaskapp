import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/core/motion/motion_flags.dart';

void main() {
  test('reads independent rollout flags from the build environment', () {
    const expectedReactions = bool.fromEnvironment(
      'YASKAPP_REACTIONS_MOTION',
      defaultValue: false,
    );
    const expectedEntry = bool.fromEnvironment(
      'YASKAPP_ENTRY_MOTION',
      defaultValue: false,
    );
    const flags = MotionFlags.fromEnvironment();

    expect(flags.reactionsMotion, expectedReactions);
    expect(flags.entryMotion, expectedEntry);
  });

  test('keeps both rollout flags disabled by default', () {
    const flags = MotionFlags.fromEnvironment();

    expect(flags.reactionsMotion, isFalse);
    expect(flags.entryMotion, isFalse);
  });
}
