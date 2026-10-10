import 'package:flutter/widgets.dart';

import 'poll_state_store.dart';

class PollStateScope extends InheritedNotifier<PollStateStore> {
  const PollStateScope({
    required PollStateStore store,
    required super.child,
    super.key,
  }) : super(notifier: store);

  static PollStateStore? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<PollStateScope>()?.notifier;

  static PollStateStore? readOf(BuildContext context) =>
      context.getInheritedWidgetOfExactType<PollStateScope>()?.notifier;
}
