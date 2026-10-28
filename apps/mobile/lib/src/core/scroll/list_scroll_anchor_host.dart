import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

import 'list_scroll_state.dart';

/// Connects an existing scrollable to the shared ID-anchor store.
///
/// The scrollable and its controller remain owned by the screen. Wrap each
/// content row in [ListScrollAnchorItem] so the host can measure its position.
class ListScrollAnchorHost extends StatefulWidget {
  const ListScrollAnchorHost({
    required this.context,
    required this.store,
    required this.controller,
    required this.itemIds,
    required this.child,
    this.hasExplicitTarget = false,
    this.onVisibleItemsChanged,
    super.key,
  });

  final ListScrollContext context;
  final ListScrollStateStore store;
  final ScrollController controller;
  final List<String> itemIds;
  final Widget child;
  final bool hasExplicitTarget;
  final ValueChanged<List<String>>? onVisibleItemsChanged;

  @override
  State<ListScrollAnchorHost> createState() => _ListScrollAnchorHostState();
}

class _ListScrollAnchorHostState extends State<ListScrollAnchorHost> {
  final Map<String, GlobalKey> _itemKeys = {};
  bool _captureScheduled = false;
  bool _restoreScheduled = false;
  bool _capturePending = false;
  bool _captureAfterRestore = false;
  bool _suppressMetricsRestoreAfterScroll = false;
  bool _metricsRestorePending = false;
  bool _scrollSuppressionClearScheduled = false;
  bool _applyingAnchorCorrection = false;
  int _userScrollGeneration = 0;
  int _userMovementGeneration = 0;
  int _lastCapturedMovementGeneration = 0;
  String? _lastCapturedAnchorId;
  double? _lastCaptureScrollOffset;

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_scheduleCapture);
    _scheduleRestore();
  }

  @override
  void didUpdateWidget(covariant ListScrollAnchorHost oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller.removeListener(_scheduleCapture);
      widget.controller.addListener(_scheduleCapture);
    }
    if (oldWidget.context != widget.context ||
        oldWidget.hasExplicitTarget != widget.hasExplicitTarget ||
        !_sameIds(oldWidget.itemIds, widget.itemIds)) {
      if (oldWidget.controller == widget.controller &&
          oldWidget.context == widget.context &&
          _hasUncapturedUserPosition()) {
        _scheduleCapture();
      } else {
        _scheduleRestore();
      }
    }
  }

  @override
  void dispose() {
    widget.controller.removeListener(_scheduleCapture);
    super.dispose();
  }

  bool _sameIds(List<String> left, List<String> right) {
    if (identical(left, right)) return true;
    if (left.length != right.length) return false;
    for (var index = 0; index < left.length; index++) {
      if (left[index] != right[index]) return false;
    }
    return true;
  }

  void _register(String id, GlobalKey key) => _itemKeys[id] = key;

  void _unregister(String id, GlobalKey key) {
    if (identical(_itemKeys[id], key)) _itemKeys.remove(id);
  }

  double? _itemTop(String id) {
    final renderObject = _itemKeys[id]?.currentContext?.findRenderObject();
    if (renderObject is! RenderBox || !renderObject.attached) return null;
    final viewport = RenderAbstractViewport.maybeOf(renderObject);
    if (viewport == null || !widget.controller.hasClients) return null;
    return viewport.getOffsetToReveal(renderObject, 0).offset -
        widget.controller.offset;
  }

  bool _savedAnchorHasMoved() {
    final anchor = widget.store.read(
      widget.context,
      currentItemIds: widget.itemIds,
    );
    if (anchor == null || !anchor.hasMeasuredTop) return false;
    final currentTop = _itemTop(anchor.id);
    if (currentTop == null) return false;
    final capturedOffset = _lastCaptureScrollOffset;
    if (_lastCapturedAnchorId == anchor.id && capturedOffset != null) {
      final expectedTop =
          anchor.top - (widget.controller.offset - capturedOffset);
      return (currentTop - expectedTop).abs() > 0.5;
    }
    return (currentTop - anchor.top).abs() > 0.5;
  }

  bool _hasUncapturedUserPosition() {
    if (_lastCapturedMovementGeneration != _userMovementGeneration) {
      return true;
    }
    if (_extentClampExplainsOffsetChange()) return false;
    final capturedOffset = _lastCaptureScrollOffset;
    if (!widget.controller.hasClients || capturedOffset == null) return false;
    final positionChanged =
        (widget.controller.offset - capturedOffset).abs() > 0.5;
    return positionChanged && !_savedAnchorHasMoved();
  }

  bool _extentClampExplainsOffsetChange() {
    if (!widget.controller.hasClients) return false;
    final capturedOffset = _lastCaptureScrollOffset;
    if (capturedOffset == null) return false;

    final position = widget.controller.position;
    final offset = position.pixels;
    final isAtMin = (offset - position.minScrollExtent).abs() <= 0.5;
    final isAtMax = (offset - position.maxScrollExtent).abs() <= 0.5;

    return (capturedOffset < position.minScrollExtent - 0.5 && isAtMin) ||
        (capturedOffset > position.maxScrollExtent + 0.5 && isAtMax);
  }

  void _scheduleCapture() {
    if (_captureScheduled || !mounted) return;
    if (_applyingAnchorCorrection) return;
    if (_restoreScheduled) {
      _capturePending = true;
      return;
    }
    _captureScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _captureScheduled = false;
      if (!mounted) return;
      // A capture queued before a layout change must not replace the saved
      // anchor while its restoration is waiting for the new layout to settle.
      if (_restoreScheduled || _metricsRestorePending) {
        _capturePending = true;
        return;
      }
      _capture();
    });
  }

  void _capture({bool allowUncorrectedAnchor = false}) {
    if (!widget.controller.hasClients || widget.itemIds.isEmpty) {
      widget.onVisibleItemsChanged?.call(const []);
      return;
    }
    final position = widget.controller.position;
    final visible = <ListAnchor>[];
    for (final id in widget.itemIds) {
      final top = _itemTop(id);
      if (top == null || top >= position.viewportDimension || top + 1 <= 0) {
        continue;
      }
      final box = _itemKeys[id]?.currentContext?.findRenderObject();
      final height = box is RenderBox ? box.size.height : 0;
      if (top + height > 0) visible.add(ListAnchor(id: id, top: top));
    }
    widget.onVisibleItemsChanged?.call(
      visible.map((anchor) => anchor.id).toList(growable: false),
    );
    if (visible.isEmpty) return;
    if (!allowUncorrectedAnchor && _savedAnchorHasMoved()) {
      // A layout change can land between an automatic correction and its
      // queued capture. Keep the pre-change anchor until the new layout is
      // corrected, or the shifted position would become the new baseline.
      _metricsRestorePending = true;
      _scheduleRestore(captureAfterRestore: true);
      return;
    }
    widget.store.capture(
      widget.context,
      visible.first,
      visibleAnchors: visible,
      itemIds: widget.itemIds,
    );
    _lastCapturedAnchorId = visible.first.id;
    _lastCaptureScrollOffset = position.pixels;
    _lastCapturedMovementGeneration = _userMovementGeneration;
  }

  void _scheduleRestore({bool captureAfterRestore = false}) {
    if (_restoreScheduled) {
      _captureAfterRestore |= captureAfterRestore;
      return;
    }
    _restoreScheduled = true;
    final revisionAtSchedule = widget.store.revisionFor(widget.context);
    final scrollGenerationAtSchedule = _userScrollGeneration;
    _captureAfterRestore = captureAfterRestore;
    WidgetsBinding.instance.scheduleFrame();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      WidgetsBinding.instance.scheduleFrame();
      await WidgetsBinding.instance.endOfFrame;
      if (!mounted) return;
      var anchorCorrectionUnreachable = false;
      if (mounted &&
          !widget.hasExplicitTarget &&
          !_suppressMetricsRestoreAfterScroll &&
          !_metricsRestorePending &&
          !_hasUncapturedUserPosition() &&
          scrollGenerationAtSchedule == _userScrollGeneration) {
        _applyingAnchorCorrection = true;
        try {
          final savedAnchor = widget.store.read(
            widget.context,
            currentItemIds: widget.itemIds,
          );
          final currentAnchorTop = savedAnchor?.hasMeasuredTop == true
              ? _itemTop(savedAnchor!.id)
              : null;
          var correctionWasClamped = false;
          if (savedAnchor != null &&
              currentAnchorTop != null &&
              widget.controller.hasClients) {
            final position = widget.controller.position;
            final requestedOffset =
                widget.controller.offset + currentAnchorTop - savedAnchor.top;
            final correctedOffset = ListScrollRestoration.correctedOffset(
              currentOffset: widget.controller.offset,
              currentAnchorTop: currentAnchorTop,
              savedAnchor: savedAnchor,
              minScrollExtent: position.minScrollExtent,
              maxScrollExtent: position.maxScrollExtent,
            );
            correctionWasClamped =
                (requestedOffset - correctedOffset).abs() > 0.5;
          }
          final restored = ListScrollRestoration.restoreAtCurrentLayout(
            store: widget.store,
            context: widget.context,
            currentItemIds: widget.itemIds,
            controller: widget.controller,
            anchorTop: _itemTop,
            hasExplicitTarget: widget.hasExplicitTarget,
          );
          if (restored && widget.controller.hasClients) {
            // The correction is host initiated. Make it the new offset
            // baseline so a later extent update is measured from this layout.
            _lastCaptureScrollOffset = widget.controller.offset;
            final currentTopAfterCorrection =
                savedAnchor == null ? null : _itemTop(savedAnchor.id);
            anchorCorrectionUnreachable = correctionWasClamped &&
                savedAnchor != null &&
                currentTopAfterCorrection != null &&
                (currentTopAfterCorrection - savedAnchor.top).abs() > 0.5;
          }
        } finally {
          _applyingAnchorCorrection = false;
        }
      }
      _restoreScheduled = false;
      final shouldCapture = _capturePending || _captureAfterRestore;
      _capturePending = false;
      _captureAfterRestore = false;
      if (anchorCorrectionUnreachable && mounted) {
        // Viewport or content changes can clamp the requested offset at an
        // extent boundary. Rebase to the visible position instead of retrying
        // an anchor that this scroll range can no longer reach.
        _metricsRestorePending = false;
        _capture(allowUncorrectedAnchor: true);
        return;
      }
      if (_metricsRestorePending &&
          mounted &&
          !widget.hasExplicitTarget &&
          !_suppressMetricsRestoreAfterScroll) {
        _metricsRestorePending = false;
        _scheduleRestore(captureAfterRestore: shouldCapture);
        return;
      }
      if (shouldCapture &&
          mounted &&
          widget.store.revisionFor(widget.context) == revisionAtSchedule) {
        _scheduleCapture();
      }
    });
  }

  bool _handleScroll(ScrollNotification notification) {
    if (notification.depth != 0) return false;
    if (_applyingAnchorCorrection) return false;
    if (notification is ScrollUpdateNotification) {
      _userScrollGeneration++;
      _userMovementGeneration++;
      // Movement after an extent change represents newer user intent. Capture
      // that position instead of restoring the anchor from before the change.
      _metricsRestorePending = false;
      _deferMetricsRestoreUntilScrollSettles();
      _scheduleCapture();
    } else if (notification is ScrollEndNotification) {
      _userScrollGeneration++;
      _deferMetricsRestoreUntilScrollSettles();
    }
    return false;
  }

  bool _handleScrollMetrics(ScrollMetricsNotification notification) {
    if (notification.depth == 0 && widget.controller.hasClients) {
      if (_restoreScheduled) {
        final moved = _savedAnchorHasMoved();
        if (moved) _metricsRestorePending = true;
        _captureAfterRestore = true;
        return false;
      }
      final position = widget.controller.position;
      if (_suppressMetricsRestoreAfterScroll ||
          position.isScrollingNotifier.value) {
        if (_lastCapturedMovementGeneration != _userMovementGeneration) {
          _scheduleCapture();
          return false;
        }
        if (!_savedAnchorHasMoved()) {
          if (widget.store.revisionFor(widget.context) == null) {
            _scheduleCapture();
          }
          return false;
        }
        // Keep the last settled anchor until the scroll ends. Capturing after
        // this layout could save the already-shifted position and lose the
        // offset needed to compensate for the extent change.
        _metricsRestorePending = true;
        return false;
      }
    }
    if (notification.depth == 0 &&
        widget.store.revisionFor(widget.context) != null) {
      _scheduleRestore(captureAfterRestore: true);
    }
    return false;
  }

  void _deferMetricsRestoreUntilScrollSettles() {
    // Scroll-end can be followed by extent updates from lazy row layout.
    // Let those settle before treating a metrics change as a separate resize.
    _suppressMetricsRestoreAfterScroll = true;
    if (_scrollSuppressionClearScheduled) return;
    _scrollSuppressionClearScheduled = true;
    final generation = _userScrollGeneration;
    WidgetsBinding.instance.scheduleFrame();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      WidgetsBinding.instance.scheduleFrame();
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        _scrollSuppressionClearScheduled = false;
        if (generation != _userScrollGeneration ||
            (widget.controller.hasClients &&
                widget.controller.position.isScrollingNotifier.value)) {
          _deferMetricsRestoreUntilScrollSettles();
          return;
        }
        _suppressMetricsRestoreAfterScroll = false;
        if (_metricsRestorePending) {
          _metricsRestorePending = false;
          _scheduleRestore(captureAfterRestore: true);
        }
      });
    });
  }

  @override
  Widget build(BuildContext context) =>
      NotificationListener<ScrollMetricsNotification>(
        onNotification: _handleScrollMetrics,
        child: NotificationListener<ScrollNotification>(
          onNotification: _handleScroll,
          child: widget.child,
        ),
      );
}

/// Marks a content row as a candidate anchor inside [ListScrollAnchorHost].
class ListScrollAnchorItem extends StatefulWidget {
  ListScrollAnchorItem({required this.id, required this.child, Key? key})
      : super(key: key ?? ValueKey<String>('list-scroll-$id'));

  final String id;
  final Widget child;

  @override
  State<ListScrollAnchorItem> createState() => _ListScrollAnchorItemState();
}

class _ListScrollAnchorItemState extends State<ListScrollAnchorItem> {
  final GlobalKey _renderKey = GlobalKey();
  _ListScrollAnchorHostState? _host;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final nextHost =
        context.findAncestorStateOfType<_ListScrollAnchorHostState>();
    if (identical(nextHost, _host)) return;
    _host?._unregister(widget.id, _renderKey);
    _host = nextHost;
    _host?._register(widget.id, _renderKey);
  }

  @override
  void didUpdateWidget(covariant ListScrollAnchorItem oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.id == widget.id) return;
    _host?._unregister(oldWidget.id, _renderKey);
    _host?._register(widget.id, _renderKey);
  }

  @override
  void dispose() {
    _host?._unregister(widget.id, _renderKey);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => KeyedSubtree(
        key: _renderKey,
        child: widget.child,
      );
}
