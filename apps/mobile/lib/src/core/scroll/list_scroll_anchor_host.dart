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
    super.key,
  });

  final ListScrollContext context;
  final ListScrollStateStore store;
  final ScrollController controller;
  final List<String> itemIds;
  final Widget child;
  final bool hasExplicitTarget;

  @override
  State<ListScrollAnchorHost> createState() => _ListScrollAnchorHostState();
}

class _ListScrollAnchorHostState extends State<ListScrollAnchorHost> {
  final Map<String, GlobalKey> _itemKeys = {};
  bool _captureScheduled = false;

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
      _scheduleRestore();
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

  void _scheduleCapture() {
    if (_captureScheduled || !mounted) return;
    _captureScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _captureScheduled = false;
      if (mounted) _capture();
    });
  }

  void _capture() {
    if (!widget.controller.hasClients || widget.itemIds.isEmpty) return;
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
    if (visible.isEmpty) return;
    widget.store.capture(
      widget.context,
      visible.first,
      visibleAnchors: visible,
      itemIds: widget.itemIds,
    );
  }

  void _scheduleRestore({bool captureAfterRestore = false}) {
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted || widget.hasExplicitTarget) return;
      await ListScrollRestoration.restoreAfterLayout(
        store: widget.store,
        context: widget.context,
        currentItemIds: widget.itemIds,
        controller: widget.controller,
        anchorTop: _itemTop,
        hasExplicitTarget: widget.hasExplicitTarget,
      );
      if (captureAfterRestore && mounted) _scheduleCapture();
    });
  }

  bool _handleScroll(ScrollNotification notification) {
    if (notification.depth != 0) return false;
    if (notification is ScrollMetricsNotification) {
      _scheduleRestore(captureAfterRestore: true);
    } else if (notification is ScrollUpdateNotification ||
        notification is ScrollEndNotification) {
      _scheduleCapture();
    }
    return false;
  }

  @override
  Widget build(BuildContext context) =>
      NotificationListener<ScrollNotification>(
        onNotification: _handleScroll,
        child: widget.child,
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
