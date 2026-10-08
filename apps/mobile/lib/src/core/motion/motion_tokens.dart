/// Shared timing and bounds for the Flutter motion components.
abstract final class MotionTokens {
  static const countDuration = Duration(milliseconds: 180);
  static const barDuration = Duration(milliseconds: 240);
  static const likeDuration = Duration(milliseconds: 160);
  static const entryDuration = Duration(milliseconds: 200);
  static const entryOffset = 8.0;
  static const entryStagger = Duration(milliseconds: 35);
  static const maxStaggeredItems = 6;
  static const maxEntrySequence = Duration(milliseconds: 400);
  static const skeletonCrossfadeDuration = Duration(milliseconds: 120);
  static const maxLikeScale = 1.08;
}
