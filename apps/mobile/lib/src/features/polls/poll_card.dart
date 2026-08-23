import 'package:flutter/material.dart';

import '../../core/widgets/user_avatar.dart';
import 'poll_summary.dart';

class PollCard extends StatelessWidget {
  const PollCard({
    required this.poll,
    this.onVote,
    this.onCancelVote,
    this.onOpenAuthor,
    this.onOpenComments,
    this.onToggleLike,
    this.isVoting = false,
    this.isLiking = false,
    this.compact = false,
    super.key,
  });

  final PollSummary poll;
  final ValueChanged<PollOptionSummary>? onVote;
  final VoidCallback? onCancelVote;
  final VoidCallback? onOpenAuthor;
  final VoidCallback? onOpenComments;
  final VoidCallback? onToggleLike;
  final bool isVoting;
  final bool isLiking;
  final bool compact;

  @override
  Widget build(BuildContext context) {
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
                InkWell(
                  onTap: onOpenAuthor,
                  borderRadius: BorderRadius.circular(24),
                  child: UserAvatar(
                    displayName: poll.author.displayName,
                    username: poll.author.username,
                    imageUrl: poll.author.avatarUrl,
                    radius: compact ? 22 : 22,
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
                    enabled: canCancelVote,
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(minWidth: 190),
                    menuPadding: const EdgeInsets.symmetric(vertical: 6),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                    elevation: 4,
                    icon: Icon(Icons.more_vert, size: compact ? 20 : 22),
                    onSelected: (action) {
                      if (action == _PollAction.cancelVote) {
                        onCancelVote?.call();
                      }
                    },
                    itemBuilder: (context) => [
                      if (canCancelVote)
                        const PopupMenuItem<_PollAction>(
                          value: _PollAction.cancelVote,
                          height: 48,
                          child: Row(
                            children: [
                              Icon(Icons.clear, size: 20),
                              SizedBox(width: 12),
                              Text('Cancel vote'),
                            ],
                          ),
                        ),
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
                color: Color(0xFF10142D),
                fontSize: 15,
                height: compact ? 22 / 15 : 24 / 15,
                fontWeight: FontWeight.bold,
              ),
            ),
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
                option: poll.options[index],
                totalVotes: poll.votesCount,
                isSelected: poll.selectedOptionIndex == index,
                rank: rankByOptionIndex[index],
                compact: compact,
                profileVariant: compact,
                isLoading: isVoting,
                onTap:
                    onVote == null ? null : () => onVote!(poll.options[index]),
              ),
              const SizedBox(height: 8),
            ],
            SizedBox(height: compact ? 16 : 18),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
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
              ],
            ),
          ],
        ),
      ),
    );
  }
}

enum _PollAction { cancelVote }

class _PollOptionButton extends StatelessWidget {
  const _PollOptionButton({
    required this.option,
    required this.totalVotes,
    required this.isSelected,
    required this.rank,
    this.compact = false,
    this.profileVariant = false,
    this.isLoading = false,
    this.onTap,
  });

  final PollOptionSummary option;
  final int totalVotes;
  final bool isSelected;
  final int? rank;
  final bool compact;
  final bool profileVariant;
  final bool isLoading;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final percent = totalVotes == 0 ? 0.0 : option.votesCount / totalVotes;
    final optionRank = rank;
    const accentColor = Color(0xFF566A9D);

    final optionMinHeight = profileVariant ? 40.0 : (compact ? 36.0 : 48.0);
    final progressHeight = profileVariant || compact ? 8.0 : 10.0;
    final numericOption = int.tryParse(option.text.trim()) != null;
    final optionLabelWidth = numericOption ? 20.0 : 68.0;

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
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: numericOption
                ? Row(
                    children: [
                      SizedBox(
                        width: optionLabelWidth,
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
                      if (isLoading) const _OptionLoading(),
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
                      if (isLoading) const _OptionLoading(),
                    ],
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
    return TweenAnimationBuilder<double>(
      tween: Tween<double>(end: percent.clamp(0, 1)),
      duration: const Duration(milliseconds: 350),
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
    return TweenAnimationBuilder<double>(
      tween: Tween<double>(end: percent * 100),
      duration: const Duration(milliseconds: 350),
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

class _Metric extends StatelessWidget {
  const _Metric({
    this.icon,
    this.assetPath,
    required this.label,
    this.isActive = false,
    this.isLoading = false,
    this.animatedValue,
    this.tooltip,
    this.onTap,
    this.dense = false,
  });

  final IconData? icon;
  final String? assetPath;
  final String label;
  final bool isActive;
  final bool isLoading;
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
              : assetPath == null
                  ? Icon(
                      icon,
                      size: 22,
                      color: isActive ? colors.error : colors.onSurfaceVariant,
                    )
                  : Image.asset(
                      assetPath!,
                      width: 22,
                      height: 22,
                      fit: BoxFit.contain,
                    ),
        ),
        const SizedBox(width: 6),
        if (animatedValue == null)
          Text(
            label,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: const Color(0xFF10142D),
                  fontSize: 14,
                ),
          )
        else
          TweenAnimationBuilder<int>(
            tween: IntTween(end: animatedValue!),
            duration: const Duration(milliseconds: 250),
            curve: Curves.easeOutCubic,
            builder: (context, value, child) {
              final suffix = label.endsWith(' votes') ? ' votes' : '';
              return Text(
                '$value$suffix',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: const Color(0xFF10142D),
                      fontSize: 14,
                    ),
              );
            },
          ),
      ],
    );

    if (onTap == null) {
      return content;
    }

    return Tooltip(
      message: tooltip ?? label,
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
          child: content,
        ),
      ),
    );
  }
}
