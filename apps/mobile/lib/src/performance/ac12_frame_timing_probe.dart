import 'dart:convert';
import 'dart:ui' show FramePhase;

import 'package:flutter/scheduler.dart';

/// Optional profile-only frame timing output used for M17 Android AC-12.
///
/// Enable with `--dart-define=M17_AC12_PROBE=true` in profile mode. Each log
/// batch contains Flutter engine timings for rasterized app frames, including
/// their system-wall-clock raster finish timestamp for run-window filtering.
class Ac12FrameTimingProbe {
  Ac12FrameTimingProbe._();

  static void install() {
    SchedulerBinding.instance.addTimingsCallback(_report);
  }

  static void _report(List<FrameTiming> timings) {
    final frames = timings
        .map(
          (timing) => <String, int>{
            'frame': timing.frameNumber,
            'rasterFinishWallUs':
                timing.timestampInMicroseconds(FramePhase.rasterFinishWallTime),
            'buildDurationUs': timing.buildDuration.inMicroseconds,
            'rasterDurationUs': timing.rasterDuration.inMicroseconds,
            'totalSpanUs': timing.totalSpan.inMicroseconds,
          },
        )
        .toList(growable: false);

    // Keep the logcat callback overhead low without approaching Android's
    // per-record truncation limit. These are the fields used by the AC-12
    // report: frame window, build/raster duration, and end-to-end frame span.
    const framesPerRecord = 6;
    for (var start = 0; start < frames.length; start += framesPerRecord) {
      final end = (start + framesPerRecord).clamp(0, frames.length);
      // ignore: avoid_print
      print('M17_AC12_FRAME_BATCH ${jsonEncode(frames.sublist(start, end))}');
    }
  }
}
