import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

import 'motion_settings.dart';
import 'motion_tokens.dart';

/// Keeps the set of already presented items alive for the lifetime of a list.
///
/// Place this above a scrollable, rather than inside a row builder, so a
/// virtualized row can be disposed and rebuilt without replaying its entry.
class EntryMotionRegistryScope extends StatefulWidget {
  const EntryMotionRegistryScope({
    required this.contextKey,
    required this.child,
    super.key,
  });

  final String contextKey;
  final Widget child;

  @override
  State<EntryMotionRegistryScope> createState() =>
      _EntryMotionRegistryScopeState();
}

class _EntryMotionRegistryScopeState extends State<EntryMotionRegistryScope> {
  final Set<String> _seenIds = <String>{};

  @override
  void didUpdateWidget(covariant EntryMotionRegistryScope oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.contextKey != widget.contextKey) _seenIds.clear();
  }

  bool markSeen(String itemId) => _seenIds.add(itemId);

  @override
  Widget build(BuildContext context) => _EntryMotionRegistryData(
        contextKey: widget.contextKey,
        markSeen: markSeen,
        child: widget.child,
      );
}

class _EntryMotionRegistryData extends InheritedWidget {
  const _EntryMotionRegistryData({
    required this.contextKey,
    required this.markSeen,
    required super.child,
  });

  final String contextKey;
  final bool Function(String itemId) markSeen;

  @override
  bool updateShouldNotify(_EntryMotionRegistryData oldWidget) =>
      contextKey != oldWidget.contextKey || markSeen != oldWidget.markSeen;
}

/// A one-shot opacity and 8 logical pixel translation for a visible list item.
///
/// The child keeps its final layout size for the whole effect. Items without a
/// matching list registry render statically, which keeps preview/dialog uses
/// safe and makes list ownership explicit.
class EntryMotion extends StatefulWidget {
  const EntryMotion({
    required this.contextKey,
    required this.itemId,
    required this.visible,
    required this.indexInBatch,
    required this.child,
    super.key,
  });

  final String contextKey;
  final String itemId;
  final bool visible;
  final int indexInBatch;
  final Widget child;

  @override
  State<EntryMotion> createState() => _EntryMotionState();
}

class _EntryMotionState extends State<EntryMotion>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  Timer? _staggerTimer;
  String? _consideredIdentity;
  String? _runningIdentity;

  String get _identity => '${widget.contextKey}\u0000${widget.itemId}';

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: MotionTokens.entryDuration,
      value: 1,
    );
    _scheduleConsideration();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!MotionSettings.of(context).entryEnabled) _finishImmediately();
    _scheduleConsideration();
  }

  @override
  void didUpdateWidget(covariant EntryMotion oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.contextKey != widget.contextKey ||
        oldWidget.itemId != widget.itemId) {
      _staggerTimer?.cancel();
      _controller.stop();
      _controller.value = 1;
      _consideredIdentity = null;
      _runningIdentity = null;
    }
    if (oldWidget.visible != widget.visible ||
        oldWidget.indexInBatch != widget.indexInBatch ||
        oldWidget.contextKey != widget.contextKey ||
        oldWidget.itemId != widget.itemId) {
      _scheduleConsideration();
    }
    if (!widget.visible) _markCurrentIdentitySeen();
  }

  void _scheduleConsideration() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _considerEntry();
    });
  }

  void _considerEntry() {
    final identity = _identity;
    if (_consideredIdentity == identity) return;

    final registry =
        context.dependOnInheritedWidgetOfExactType<_EntryMotionRegistryData>();
    final ownsIdentity = registry?.contextKey == widget.contextKey;
    if (!widget.visible || !ownsIdentity) {
      if (ownsIdentity) registry!.markSeen(widget.itemId);
      _consideredIdentity = identity;
      return;
    }

    // Rows that are mounted in a sliver's cache extent are recorded without an
    // effect, so scrolling them into view later does not trigger a delayed
    // appearance animation.
    if (!_isInsideViewport()) {
      registry!.markSeen(widget.itemId);
      _consideredIdentity = identity;
      return;
    }

    final settings = MotionSettings.of(context);
    if (!settings.entryEnabled) {
      registry!.markSeen(widget.itemId);
      _consideredIdentity = identity;
      return;
    }

    if (!registry!.markSeen(widget.itemId)) {
      _consideredIdentity = identity;
      return;
    }

    _consideredIdentity = identity;
    _runningIdentity = identity;
    _controller.value = 0;
    final staggerIndex = widget.indexInBatch < 0
        ? 0
        : widget.indexInBatch < MotionTokens.maxStaggeredItems
            ? widget.indexInBatch
            : 0;
    final delay = MotionTokens.entryStagger * staggerIndex;
    if (delay == Duration.zero) {
      _controller.forward();
    } else {
      _staggerTimer = Timer(delay, () {
        if (!mounted || _runningIdentity != identity) return;
        if (MotionSettings.of(context).entryEnabled) {
          _controller.forward();
        } else {
          _finishImmediately();
        }
      });
    }
  }

  bool _isInsideViewport() {
    final renderObject = context.findRenderObject();
    if (renderObject is! RenderBox || !renderObject.hasSize) return false;
    final viewport = RenderAbstractViewport.maybeOf(renderObject);
    if (viewport == null) return true;
    final viewportBox = viewport as RenderBox;
    if (!viewportBox.hasSize) return true;

    final itemRect =
        renderObject.localToGlobal(Offset.zero) & renderObject.size;
    final viewportRect =
        viewportBox.localToGlobal(Offset.zero) & viewportBox.size;
    return itemRect.overlaps(viewportRect);
  }

  void _markCurrentIdentitySeen() {
    final registry =
        context.getInheritedWidgetOfExactType<_EntryMotionRegistryData>();
    if (registry?.contextKey == widget.contextKey) {
      registry!.markSeen(widget.itemId);
    }
  }

  void _finishImmediately() {
    _staggerTimer?.cancel();
    _staggerTimer = null;
    if (_controller.value != 1) {
      _controller.stop();
      _controller.value = 1;
    }
    _runningIdentity = null;
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: _controller,
        child: widget.child,
        builder: (context, child) {
          final progress = _controller.value;
          return Transform.translate(
            key: const ValueKey('entry-motion-translation'),
            offset: Offset(0, MotionTokens.entryOffset * (1 - progress)),
            transformHitTests: false,
            child: Opacity(
              key: const ValueKey('entry-motion-opacity'),
              opacity: progress,
              alwaysIncludeSemantics: true,
              child: child,
            ),
          );
        },
      );

  @override
  void dispose() {
    _staggerTimer?.cancel();
    _controller.dispose();
    super.dispose();
  }
}
