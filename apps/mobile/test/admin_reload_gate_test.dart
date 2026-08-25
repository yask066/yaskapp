import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:yaskapp_mobile/src/features/admin/admin_reload_gate.dart';

void main() {
  test('coalesces reload requests that arrive during an active load', () async {
    final gate = AdminReloadGate();
    final firstLoadFinished = Completer<void>();
    var loadCount = 0;

    Future<void> load() async {
      loadCount++;
      if (loadCount == 1) {
        await firstLoadFinished.future;
      }
    }

    final firstRequest = gate.run(load);
    await Future<void>.delayed(Duration.zero);
    final secondRequest = gate.run(load);

    expect(loadCount, 1);
    firstLoadFinished.complete();
    await Future.wait([firstRequest, secondRequest]);

    expect(loadCount, 2);
  });
}
