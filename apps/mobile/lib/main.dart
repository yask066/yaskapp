import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:firebase_core/firebase_core.dart';

import 'src/app.dart';
import 'src/features/notifications/firebase_push_service.dart';
import 'src/performance/ac12_frame_timing_probe.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (kProfileMode && const bool.fromEnvironment('M17_AC12_PROBE')) {
    Ac12FrameTimingProbe.install();
  }
  await Firebase.initializeApp();
  await FirebasePushService().initialize();
  runApp(const YaskappApp());
}
