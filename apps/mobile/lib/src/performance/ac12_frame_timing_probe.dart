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
            'vsyncStartUs':
                timing.timestampInMicroseconds(FramePhase.vsyncStart),
            'buildStartUs':
                timing.timestampInMicroseconds(FramePhase.buildStart),
            'buildFinishUs':
                timing.timestampInMicroseconds(FramePhase.buildFinish),
            'rasterStartUs':
                timing.timestampInMicroseconds(FramePhase.rasterStart),
            'rasterFinishUs':
                timing.timestampInMicroseconds(FramePhase.rasterFinish),
            'rasterFinishWallUs':
                timing.timestampInMicroseconds(FramePhase.rasterFinishWallTime),
            'vsyncOverheadUs': timing.vsyncOverhead.inMicroseconds,
            'buildDurationUs': timing.buildDuration.inMicroseconds,
            'rasterDurationUs': timing.rasterDuration.inMicroseconds,
            'totalSpanUs': timing.totalSpan.inMicroseconds,
          },
        )
        .toList(growable: false);

    // Flutter batches timing callbacks, but Android truncates long log records.
    // Keep each record to at most two frames so profile captures remain parseable.
    for (var start = 0; start < frames.length; start += 2) {
      final end = (start + 2).clamp(0, frames.length);
      // ignore: avoid_print
      print('M17_AC12_FRAME_BATCH ${jsonEncode(frames.sublist(start, end))}');
    }
  }
}
