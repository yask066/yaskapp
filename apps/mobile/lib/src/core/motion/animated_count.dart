import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'motion_settings.dart';
import 'motion_tokens.dart';

/// Animates a poll count while exposing the accepted target to semantics.
class AnimatedCount extends StatefulWidget {
  const AnimatedCount({
    required this.value,
    required this.enabled,
    this.duration = MotionTokens.countDuration,
    this.suffix = '',
    super.key,
  });

  final int value;
  final bool enabled;
  final Duration duration;
  final String suffix;

  @override
  State<AnimatedCount> createState() => _AnimatedCountState();
}

class _AnimatedCountState extends State<AnimatedCount>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: widget.duration,
    value: 1,
  );

  late double _targetValue = _clamp(widget.value).toDouble();
  late double _startValue = _targetValue;
  late MotionSettings _settings;
  var _canAnimate = false;

  static int _clamp(int value) => math.max(0, value);

  double get _displayedValue =>
      _startValue +
      (_targetValue - _startValue) *
          Curves.easeOutCubic.transform(_controller.value);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _settings = MotionSettings.of(context);
    _updateMotionAvailability();
  }

  @override
  void didUpdateWidget(AnimatedCount oldWidget) {
    super.didUpdateWidget(oldWidget);
    _controller.duration = widget.duration;
    _updateMotionAvailability();
    final target = _clamp(widget.value).toDouble();
    if (target != _targetValue) {
      _startValue = _displayedValue;
      _targetValue = target;
      _animateToTarget();
    }
  }

  void _updateMotionAvailability() {
    final canAnimate = widget.enabled && _settings.reactionsEnabled;
    if (_canAnimate == canAnimate) return;
    _canAnimate = canAnimate;
    if (!_canAnimate) {
      _startValue = _targetValue;
      _controller.stop();
      _controller.value = 1;
    }
  }

  void _animateToTarget() {
    if (_canAnimate && widget.duration > Duration.zero) {
      _controller.forward(from: 0);
    } else {
      _startValue = _targetValue;
      _controller.stop();
      _controller.value = 1;
    }
  }

  String _format(int value) {
    if (value < 1000) return '$value';
    if (value < 1000000) return '${value ~/ 1000}K';
    if (value < 1000000000) return '${value ~/ 1000000}M';
    return '${value ~/ 1000000000}B';
  }

  @override
  Widget build(BuildContext context) {
    final target = _clamp(widget.value);
    final textStyle = Theme.of(context).textTheme.bodyMedium?.copyWith(
      color: const Color(0xFF10142D),
      fontSize: 14,
      fontFeatures: const [FontFeature.tabularFigures()],
    );
    final fontSize = textStyle?.fontSize ?? 14;
    final scaledFontSize = MediaQuery.textScalerOf(context).scale(fontSize);
    final reservedCharacters = widget.suffix.isEmpty ? 4 : 9;
    final slotWidth = reservedCharacters * scaledFontSize * 0.62;

    return Semantics(
      label: '$target${widget.suffix}',
      child: ExcludeSemantics(
        child: SizedBox(
          width: slotWidth,
          child: AnimatedBuilder(
            animation: _controller,
            builder: (context, _) => Text(
              '${_format(_displayedValue.round())}${widget.suffix}',
              maxLines: 1,
              softWrap: false,
              overflow: TextOverflow.clip,
              style: textStyle,
            ),
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }
}
