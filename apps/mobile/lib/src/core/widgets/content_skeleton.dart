import 'dart:async';

import 'package:flutter/material.dart';

enum ContentSkeletonKind { poll, user, comment, notification }

class ContentSkeleton extends StatelessWidget {
  const ContentSkeleton({
    required this.kind,
    this.rows = 3,
    this.semanticsKey,
    super.key,
  }) : assert(rows > 0);

  final ContentSkeletonKind kind;
  final int rows;
  final Key? semanticsKey;

  static String labelFor(ContentSkeletonKind kind) => switch (kind) {
        ContentSkeletonKind.poll => 'Loading polls',
        ContentSkeletonKind.user => 'Loading users',
        ContentSkeletonKind.comment => 'Loading comments',
        ContentSkeletonKind.notification => 'Loading notifications',
      };

  @override
  Widget build(BuildContext context) => Semantics(
        key: semanticsKey,
        container: true,
        liveRegion: true,
        label: labelFor(kind),
        child: ExcludeSemantics(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (var index = 0; index < rows; index++) ...[
                if (index > 0) const SizedBox(height: 12),
                _SkeletonRow(kind: kind),
              ],
            ],
          ),
        ),
      );
}

class DelayedContentSkeleton extends StatefulWidget {
  const DelayedContentSkeleton({
    required this.kind,
    this.rows = 3,
    this.isLoading = true,
    this.delay = const Duration(milliseconds: 150),
    this.semanticsKey,
    super.key,
  });

  final ContentSkeletonKind kind;
  final int rows;
  final bool isLoading;
  final Duration delay;
  final Key? semanticsKey;

  @override
  State<DelayedContentSkeleton> createState() => _DelayedContentSkeletonState();
}

class _DelayedContentSkeletonState extends State<DelayedContentSkeleton> {
  Timer? _timer;
  bool _visible = false;

  @override
  void initState() {
    super.initState();
    _scheduleIfLoading();
  }

  @override
  void didUpdateWidget(covariant DelayedContentSkeleton oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.isLoading != widget.isLoading) {
      _timer?.cancel();
      _visible = false;
      _scheduleIfLoading();
    }
  }

  void _scheduleIfLoading() {
    if (!widget.isLoading) return;
    _timer = Timer(widget.delay, () {
      if (mounted && widget.isLoading) setState(() => _visible = true);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.isLoading) return const SizedBox.shrink();
    return Visibility(
      visible: _visible,
      maintainSize: true,
      maintainAnimation: true,
      maintainState: true,
      child: ContentSkeleton(
        kind: widget.kind,
        rows: widget.rows,
        semanticsKey: widget.semanticsKey,
      ),
    );
  }
}

class _SkeletonRow extends StatelessWidget {
  const _SkeletonRow({required this.kind});

  final ContentSkeletonKind kind;

  @override
  Widget build(BuildContext context) {
    final card = BoxDecoration(
      color: Theme.of(context).colorScheme.surface,
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: const Color(0xFFE4E7EC)),
    );
    return DecoratedBox(
      decoration: card,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: switch (kind) {
          ContentSkeletonKind.poll => const _PollSkeletonRow(),
          ContentSkeletonKind.user => const _UserSkeletonRow(),
          ContentSkeletonKind.comment => const _CommentSkeletonRow(),
          ContentSkeletonKind.notification => const _NotificationSkeletonRow(),
        },
      ),
    );
  }
}

class _PollSkeletonRow extends StatelessWidget {
  const _PollSkeletonRow();

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Row(children: [
            _CirclePlaceholder(diameter: 36),
            SizedBox(width: 10),
            Expanded(child: _LinesPlaceholder(widths: [110, 72])),
          ]),
          const SizedBox(height: 14),
          const _LinesPlaceholder(widths: [220, 150]),
          const SizedBox(height: 12),
          AspectRatio(
            aspectRatio: 16 / 9,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: const Color(0xFFF2F4F7),
                borderRadius: BorderRadius.circular(8),
              ),
            ),
          ),
        ],
      );
}

class _UserSkeletonRow extends StatelessWidget {
  const _UserSkeletonRow();

  @override
  Widget build(BuildContext context) => const Row(children: [
        _CirclePlaceholder(diameter: 48),
        SizedBox(width: 12),
        Expanded(child: _LinesPlaceholder(widths: [120, 88, 64])),
        SizedBox(width: 60, height: 36, child: _Placeholder()),
      ]);
}

class _CommentSkeletonRow extends StatelessWidget {
  const _CommentSkeletonRow();

  @override
  Widget build(BuildContext context) => const Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _CirclePlaceholder(diameter: 36),
          SizedBox(width: 10),
          Expanded(child: _LinesPlaceholder(widths: [105, 220, 170])),
        ],
      );
}

class _NotificationSkeletonRow extends StatelessWidget {
  const _NotificationSkeletonRow();

  @override
  Widget build(BuildContext context) => const Row(children: [
        _CirclePlaceholder(diameter: 42),
        SizedBox(width: 12),
        Expanded(child: _LinesPlaceholder(widths: [170, 215, 90])),
      ]);
}

class _LinesPlaceholder extends StatelessWidget {
  const _LinesPlaceholder({required this.widths});

  final List<double> widths;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var index = 0; index < widths.length; index++) ...[
            if (index > 0) const SizedBox(height: 7),
            SizedBox(
              width: widths[index],
              height: index == 0 ? 12 : 9,
              child: const _Placeholder(),
            ),
          ],
        ],
      );
}

class _CirclePlaceholder extends StatelessWidget {
  const _CirclePlaceholder({required this.diameter});

  final double diameter;

  @override
  Widget build(BuildContext context) => SizedBox.square(
        dimension: diameter,
        child: const _Placeholder(),
      );
}

class _Placeholder extends StatelessWidget {
  const _Placeholder();

  @override
  Widget build(BuildContext context) => DecoratedBox(
        decoration: BoxDecoration(
          color: const Color(0xFFE4E7EC),
          borderRadius: BorderRadius.circular(6),
        ),
      );
}
