import 'package:flutter/material.dart';

import '../../core/config/api_config.dart';
import '../../core/motion/animated_count.dart';
import '../../core/motion/motion_settings.dart';
import '../../core/motion/motion_tokens.dart';
import '../../core/widgets/user_avatar.dart';
import 'poll_summary.dart';
import 'poll_state_scope.dart';

class PollCard extends StatelessWidget {
  const PollCard({
    required this.poll,
    this.accessToken,
    this.onVote,
    this.onEditPoll,
    this.onCancelVote,
    this.onDeletePoll,
    this.onReport,
    this.onOpenAuthor,
    this.onOpenComments,
    this.onToggleLike,
    this.isVoting = false,
    this.isLiking = false,
    this.compact = false,
    super.key,
  });

  final PollSummary poll;
  final String? accessToken;
  final ValueChanged<PollOptionSummary>? onVote;
  final VoidCallback? onEditPoll;
  final VoidCallback? onCancelVote;
  final VoidCallback? onDeletePoll;
  final VoidCallback? onReport;
  final VoidCallback? onOpenAuthor;
  final VoidCallback? onOpenComments;
  final VoidCallback? onToggleLike;
  final bool isVoting;
  final bool isLiking;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final store = PollStateScope.maybeOf(context);
    if (store == null) {
      return _buildCard(context, poll, isVoting: isVoting, isLiking: isLiking);
    }
    return AnimatedBuilder(
      animation: store,
      builder: (context, _) {
        if (store.isDeleted(poll.id)) return const SizedBox.shrink();
        return PollCard(
          poll: store.pollById(poll.id) ?? poll,
          accessToken: accessToken,
          onVote: store.isVoting(poll.id) ? null : onVote,
          onEditPoll: onEditPoll,
          onCancelVote: store.isVoting(poll.id) ? null : onCancelVote,
          onDeletePoll: onDeletePoll,
          onReport: onReport,
          onOpenAuthor: onOpenAuthor,
          onOpenComments: onOpenComments,
          onToggleLike: store.isLiking(poll.id) ? null : onToggleLike,
          isVoting: isVoting || store.isVoting(poll.id),
          isLiking: isLiking || store.isLiking(poll.id),
          compact: compact,
          key: key,
        )._buildCard(
          context,
          store.pollById(poll.id) ?? poll,
          isVoting: isVoting || store.isVoting(poll.id),
          isLiking: isLiking || store.isLiking(poll.id),
        );
      },
    );
  }

  Widget _buildCard(
    BuildContext context,
    PollSummary poll, {
    required bool isVoting,
    required bool isLiking,
  }) {
    final rankedOptionIndices = List<int>.generate(
      poll.options.length,
      (index) => index,
    )..sort(
        (left, right) => poll.options[right].votesCount.compareTo(
          poll.options[left].votesCount,
        ),
      );
    final rankByOptionIndex = <int, int>{};

    if (poll.votesCount > 0) {
      var denseRank = -1;
      int? previousVotes;

      for (final optionIndex in rankedOptionIndices) {
        final optionVotes = poll.options[optionIndex].votesCount;

        if (optionVotes <= 0) {
          break;
        }

        if (previousVotes != optionVotes) {
          denseRank++;
          previousVotes = optionVotes;
        }

        rankByOptionIndex[optionIndex] = denseRank;
      }
    }

    final canCancelVote = !poll.isClosed &&
        poll.allowVoteCancellation &&
        poll.selectedOptionIndex != null &&
        onCancelVote != null;
    final canDeletePoll = onDeletePoll != null;
    final canEditPoll = onEditPoll != null;
    final canReport = onReport != null;

    return Card(
      color: Colors.white,
      margin: EdgeInsets.zero,
      elevation: 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(compact ? 20 : 22),
      ),
      shadowColor: const Color(0x22000000),
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Semantics(
                  button: onOpenAuthor != null,
                  label: 'Open ${poll.author.displayName} profile',
                  child: InkWell(
                    onTap: onOpenAuthor,
                    borderRadius: BorderRadius.circular(24),
                    child: ExcludeSemantics(
                      child: UserAvatar(
                        displayName: poll.author.displayName,
                        username: poll.author.username,
                        imageUrl: poll.author.avatarUrl,
                        radius: compact ? 22 : 22,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: InkWell(
                    onTap: onOpenAuthor,
                    borderRadius: BorderRadius.circular(8),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 2),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            poll.author.displayName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Color(0xFF10142D),
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          Text(
                            '@${poll.author.username} \u00B7 ${poll.createdLabel}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Color(0xFF667085),
                              fontSize: 13,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                SizedBox(
                  width: 40,
                  height: 40,
                  child: PopupMenuButton<_PollAction>(
                    tooltip: 'More',
                    enabled: canEditPoll ||
                        canCancelVote ||
                        canDeletePoll ||
                        canReport,
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(minWidth: 220),
                    menuPadding: const EdgeInsets.symmetric(vertical: 8),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                    elevation: 6,
                    icon: Icon(Icons.more_vert, size: compact ? 20 : 22),
                    onSelected: (action) {
                      if (action == _PollAction.editPoll) {
                        onEditPoll?.call();
                      } else if (action == _PollAction.cancelVote) {
                        onCancelVote?.call();
                      } else if (action == _PollAction.deletePoll) {
                        onDeletePoll?.call();
                      } else if (action == _PollAction.report) {
                        onReport?.call();
                      }
                    },
                    itemBuilder: (context) => [
                      if (canEditPoll) ...[
                        const PopupMenuItem<_PollAction>(
                          value: _PollAction.editPoll,
                          height: 52,
                          child: _PollMenuRow(
                            icon: Icons.edit_outlined,
                            label: 'Edit poll',
                          ),
                        ),
                        const PopupMenuDivider(),
                      ],
                      if (canCancelVote)
                        const PopupMenuItem<_PollAction>(
                          value: _PollAction.cancelVote,
                          height: 52,
                          child: _PollMenuRow(
                            icon: Icons.undo,
                            label: 'Cancel vote',
                          ),
                        ),
                      if (canDeletePoll) ...[
                        if (canCancelVote) const PopupMenuDivider(),
                        const PopupMenuItem<_PollAction>(
                          value: _PollAction.deletePoll,
                          height: 52,
                          child: _PollMenuRow(
                            icon: Icons.delete_outline,
                            label: 'Delete poll',
                            destructive: true,
                          ),
                        ),
                      ],
                      if (canReport) ...[
                        if (canDeletePoll || canCancelVote || canEditPoll)
                          const PopupMenuDivider(),
                        const PopupMenuItem<_PollAction>(
                          value: _PollAction.report,
                          height: 52,
                          child: _PollMenuRow(
                            icon: Icons.flag_outlined,
                            label: 'Report',
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
            SizedBox(height: compact ? 16 : 20),
            Text(
              poll.question,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: const Color(0xFF10142D),
                fontSize: 15,
                height: compact ? 22 / 15 : 24 / 15,
                fontWeight: FontWeight.bold,
              ),
            ),
            if (poll.imageUrl != null) ...[
              const SizedBox(height: 12),
              ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: AspectRatio(
                  aspectRatio: 16 / 9,
                  child: Image.network(
                    const ApiConfig().uri(poll.imageUrl!).toString(),
                    headers: accessToken == null
                        ? null
                        : {'authorization': 'Bearer $accessToken'},
                    fit: BoxFit.cover,
                    errorBuilder: (context, error, stackTrace) => Container(
                      color: const Color(0xFFF0F2F7),
                      alignment: Alignment.center,
                      child: const Icon(Icons.broken_image_outlined),
                    ),
                  ),
                ),
              ),
            ],
            if (poll.isClosed) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  Icon(
                    Icons.lock_outline,
                    size: 16,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    'Poll closed',
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ],
            SizedBox(height: compact ? 14 : 16),
            for (var index = 0; index < poll.options.length; index++) ...[
              _PollOptionButton(
                key: ValueKey(
                    'poll-option-${poll.id}-${poll.options[index].id}'),
                option: poll.options[index],
                totalVotes: poll.votesCount,
                isSelected: poll.selectedOptionIndex == index,
                rank: rankByOptionIndex[index],
                compact: compact,
                profileVariant: compact,
                isLoading: isVoting,
                animateTap: onVote != null,
                onTap:
                    onVote == null ? null : () => onVote!(poll.options[index]),
              ),
              const SizedBox(height: 8),
            ],
            SizedBox(height: compact ? 16 : 18),
            LayoutBuilder(
              builder: (context, _) {
                final metrics = [
                  _Metric(
                    icon: Icons.people_outline,
                    label: '${poll.votesCount} votes',
                    animatedValue: poll.votesCount,
                    dense: compact,
                  ),
                  _Metric(
                    icon: Icons.mode_comment_outlined,
                    label: '${poll.commentsCount}',
                    tooltip: 'Comments',
                    onTap: onOpenComments,
                    dense: compact,
                  ),
                  _Metric(
                    icon: poll.viewerHasLiked
                        ? Icons.favorite
                        : Icons.favorite_border,
                    label: '${poll.likesCount}',
                    animatedValue: poll.likesCount,
                    isActive: poll.viewerHasLiked,
                    isLoading: isLiking,
                    animateTap: onToggleLike != null,
                    tooltip: poll.viewerHasLiked ? 'Unlike' : 'Like',
                    onTap: onToggleLike,
                    dense: compact,
                  ),
                  _Metric(
                    icon: Icons.forward_outlined,
                    label: '',
                    tooltip: 'Share',
                    dense: compact,
                  ),
                ];

                return Wrap(
                  spacing: 16,
                  runSpacing: 8,
                  alignment: WrapAlignment.spaceBetween,
                  children: metrics,
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

enum _PollAction { editPoll, cancelVote, deletePoll, report }

class _PollMenuRow extends StatelessWidget {
  const _PollMenuRow({
    required this.icon,
    required this.label,
    this.destructive = false,
  });

  final IconData icon;
  final String label;
  final bool destructive;

  @override
  Widget build(BuildContext context) {
    final color = destructive
        ? Theme.of(context).colorScheme.error
        : const Color(0xFF17233D);
    return Row(
      children: [
        Icon(icon, size: 24, color: color),
        const SizedBox(width: 16),
        Text(
          label,
          style: TextStyle(
            color: color,
            fontSize: 16,
            fontWeight: destructive ? FontWeight.w600 : FontWeight.w500,
          ),
        ),
      ],
    );
  }
}

class _PollOptionButton extends StatelessWidget {
  const _PollOptionButton({
    required this.option,
    required this.totalVotes,
    required this.isSelected,
    required this.rank,
    this.compact = false,
    this.profileVariant = false,
    this.isLoading = false,
    this.animateTap = false,
    this.onTap,
    super.key,
  });

  final PollOptionSummary option;
  final int totalVotes;
  final bool isSelected;
  final int? rank;
  final bool compact;
  final bool profileVariant;
  final bool isLoading;
  final bool animateTap;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final percent = totalVotes == 0 ? 0.0 : option.votesCount / totalVotes;
    final optionRank = rank;
    const accentColor = Color(0xFF566A9D);

    final optionMinHeight = profileVariant ? 40.0 : (compact ? 36.0 : 48.0);
    final progressHeight = profileVariant || compact ? 8.0 : 10.0;
    final numericOption = int.tryParse(option.text.trim()) != null;

    return ConstrainedBox(
      constraints: BoxConstraints(minHeight: optionMinHeight),
      child: Material(
        color:
            optionRank == 0 ? const Color(0xFFEFF2F8) : const Color(0xFFF5F6FA),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(compact ? 10 : 12),
          side: BorderSide(
            color: isSelected ? accentColor : Colors.transparent,
            width: 2,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: _LocalReactionScale(
            enabled: animateTap,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: numericOption
                  ? Row(
                      children: [
                        SizedBox(
                          width: numericOption ? 20.0 : 68.0,
                          child: _OptionLabel(
                            text: option.text,
                            compact: compact,
                            color: accentColor,
                          ),
                        ),
                        SizedBox(width: compact ? 8 : 12),
                        Expanded(
                          child: _OptionProgress(
                            percent: percent,
                            color: accentColor,
                            height: progressHeight,
                          ),
                        ),
                        SizedBox(width: compact ? 8 : 12),
                        SizedBox(
                          width: 42,
                          child: _OptionPercentage(
                            percent: percent,
                            compact: compact,
                            color: accentColor,
                          ),
                        ),
                        _OptionLoadingSlot(isLoading: isLoading),
                      ],
                    )
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: _OptionLabel(
                                text: option.text,
                                compact: compact,
                                color: accentColor,
                              ),
                            ),
                            const SizedBox(width: 8),
                            _OptionPercentage(
                              percent: percent,
                              compact: compact,
                              color: accentColor,
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        _OptionProgress(
                          percent: percent,
                          color: accentColor,
                          height: progressHeight,
                        ),
                        _OptionLoadingSlot(isLoading: isLoading),
                      ],
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

class _OptionLabel extends StatelessWidget {
  const _OptionLabel({
    required this.text,
    required this.compact,
    required this.color,
  });

  final String text;
  final bool compact;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      maxLines: compact ? 2 : 3,
      overflow: TextOverflow.ellipsis,
      style: TextStyle(
        color: color,
        fontWeight: compact ? FontWeight.w600 : FontWeight.w500,
        fontSize: compact ? 14 : 15,
      ),
    );
  }
}

class _OptionProgress extends StatelessWidget {
  const _OptionProgress({
    required this.percent,
    required this.color,
    required this.height,
  });

  final double percent;
  final Color color;
  final double height;

  @override
  Widget build(BuildContext context) {
    final shouldAnimate = MotionSettings.of(context).reactionsEnabled;
    final safePercent =
        percent.isFinite ? percent.clamp(0.0, 1.0).toDouble() : 0.0;
    return TweenAnimationBuilder<double>(
      key: ValueKey<bool>(shouldAnimate),
      tween: Tween<double>(end: safePercent),
      duration: shouldAnimate ? MotionTokens.barDuration : Duration.zero,
      curve: Curves.easeOutCubic,
      builder: (context, animatedPercent, child) {
        return ClipRRect(
          borderRadius: BorderRadius.circular(height / 2),
          child: LinearProgressIndicator(
            value: animatedPercent,
            minHeight: height,
            backgroundColor: const Color(0xFFE8EAF0),
            valueColor: AlwaysStoppedAnimation<Color>(color),
          ),
        );
      },
    );
  }
}

class _OptionPercentage extends StatelessWidget {
  const _OptionPercentage({
    required this.percent,
    required this.compact,
    required this.color,
  });

  final double percent;
  final bool compact;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final shouldAnimate = MotionSettings.of(context).reactionsEnabled;
    final targetPercent = percent.isFinite
        ? (percent.clamp(0.0, 1.0).toDouble() * 100).round()
        : 0;
    return Semantics(
      label: '$targetPercent%',
      child: ExcludeSemantics(
        child: TweenAnimationBuilder<double>(
          key: ValueKey<bool>(shouldAnimate),
          tween: Tween<double>(end: targetPercent.toDouble()),
          duration: shouldAnimate ? MotionTokens.countDuration : Duration.zero,
          curve: Curves.easeOutCubic,
          builder: (context, animatedPercent, child) {
            return Text(
              '${animatedPercent.round()}%',
              style: TextStyle(
                color: color,
                fontWeight: FontWeight.w600,
                fontSize: compact ? 14 : 15,
              ),
            );
          },
        ),
      ),
    );
  }
}

class _OptionLoading extends StatelessWidget {
  const _OptionLoading();

  @override
  Widget build(BuildContext context) {
    return const SizedBox.square(
      dimension: 18,
      child: CircularProgressIndicator(
        strokeWidth: 2,
        color: Color(0xFF566A9D),
      ),
    );
  }
}

class _OptionLoadingSlot extends StatelessWidget {
  const _OptionLoadingSlot({required this.isLoading});

  final bool isLoading;

  @override
  Widget build(BuildContext context) => SizedBox.square(
        dimension: 18,
        child: isLoading ? const _OptionLoading() : null,
      );
}

class _Metric extends StatelessWidget {
  const _Metric({
    this.icon,
    required this.label,
    this.isActive = false,
    this.isLoading = false,
    this.animateTap = false,
    this.animatedValue,
    this.tooltip,
    this.onTap,
    this.dense = false,
  });

  final IconData? icon;
  final String label;
  final bool isActive;
  final bool isLoading;
  final bool animateTap;
  final int? animatedValue;
  final String? tooltip;
  final VoidCallback? onTap;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    final content = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox.square(
          dimension: 22,
          child: isLoading
              ? CircularProgressIndicator(
                  strokeWidth: 2,
                  color: isActive ? colors.error : colors.primary,
                )
              : Icon(
                  icon,
                  size: 22,
                  color: isActive ? colors.error : colors.onSurfaceVariant,
                ),
        ),
        const SizedBox(width: 6),
        if (animatedValue == null && int.tryParse(label) == null)
          Text(
            label,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: const Color(0xFF10142D),
                  fontSize: 14,
                ),
          )
        else
          AnimatedCount(
            value: animatedValue ?? int.parse(label),
            suffix: label.endsWith(' votes') ? ' votes' : '',
            enabled: animatedValue != null,
          ),
      ],
    );

    if (onTap == null) {
      return tooltip == 'Share'
          ? Tooltip(message: tooltip!, child: content)
          : content;
    }

    return Tooltip(
      message: tooltip ?? label,
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: onTap,
        child: _LocalReactionScale(
          enabled: animateTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
            child: content,
          ),
        ),
      ),
    );
  }
}

class _LocalReactionScale extends StatefulWidget {
  const _LocalReactionScale({
    required this.child,
    this.enabled = true,
  });

  final Widget child;
  final bool enabled;

  @override
  State<_LocalReactionScale> createState() => _LocalReactionScaleState();
}

class _LocalReactionScaleState extends State<_LocalReactionScale>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: MotionTokens.likeDuration ~/ 2,
    reverseDuration: MotionTokens.likeDuration ~/ 2,
  );
  late MotionSettings _settings;
  var _canAnimate = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _settings = MotionSettings.of(context);
    _syncMotion();
  }

  @override
  void didUpdateWidget(_LocalReactionScale oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.enabled != widget.enabled) _syncMotion();
  }

  void _syncMotion() {
    _canAnimate = widget.enabled && _settings.reactionsEnabled;
    if (!_canAnimate) {
      _controller.stop();
      _controller.value = 0;
    }
  }

  void _handlePointerDown(PointerDownEvent event) {
    if (_canAnimate) _controller.forward(from: 0);
  }

  void _handlePointerUp(PointerEvent event) {
    if (_canAnimate && _controller.status != AnimationStatus.dismissed) {
      _controller.reverse();
    }
  }

  @override
  Widget build(BuildContext context) => Listener(
        onPointerDown: _handlePointerDown,
        onPointerUp: _handlePointerUp,
        onPointerCancel: _handlePointerUp,
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, child) => Transform.scale(
            scale: 1 + (MotionTokens.maxLikeScale - 1) * _controller.value,
            transformHitTests: false,
            child: child,
          ),
          child: widget.child,
        ),
      );

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }
}
