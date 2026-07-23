import 'package:flutter/material.dart';

import 'poll_summary.dart';

class PollCard extends StatelessWidget {
  const PollCard({
    required this.poll,
    this.onVote,
    this.onOpenComments,
    this.onToggleLike,
    super.key,
  });

  final PollSummary poll;
  final ValueChanged<PollOptionSummary>? onVote;
  final VoidCallback? onOpenComments;
  final VoidCallback? onToggleLike;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final colors = Theme.of(context).colorScheme;

    return Card(
      color: Colors.white,
      margin: EdgeInsets.zero,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(color: colors.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 20,
                  backgroundColor: colors.primaryContainer,
                  child: Text(
                    poll.author.displayName.substring(0, 1).toUpperCase(),
                    style: TextStyle(color: colors.onPrimaryContainer),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        poll.author.displayName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: textTheme.labelLarge,
                      ),
                      Text(
                        '@${poll.author.username} - ${poll.createdLabel}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: textTheme.bodySmall?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'More',
                  onPressed: () {},
                  icon: const Icon(Icons.more_horiz),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Text(
              poll.question,
              style: textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 12),
            for (var index = 0; index < poll.options.length; index++) ...[
              _PollOptionButton(
                option: poll.options[index],
                totalVotes: poll.votesCount,
                isSelected: poll.votedOptionIndex == index,
                onTap:
                    onVote == null ? null : () => onVote!(poll.options[index]),
              ),
              const SizedBox(height: 8),
            ],
            const SizedBox(height: 8),
            Row(
              children: [
                _Metric(
                  icon: Icons.how_to_vote,
                  label: '${poll.votesCount} votes',
                  animatedValue: poll.votesCount,
                ),
                const SizedBox(width: 16),
                _Metric(
                  icon: Icons.mode_comment_outlined,
                  label: '${poll.commentsCount}',
                  tooltip: 'Comments',
                  onTap: onOpenComments,
                ),
                const SizedBox(width: 16),
                _Metric(
                  icon: poll.viewerHasLiked
                      ? Icons.favorite
                      : Icons.favorite_border,
                  label: '${poll.likesCount}',
                  animatedValue: poll.likesCount,
                  isActive: poll.viewerHasLiked,
                  tooltip: poll.viewerHasLiked ? 'Unlike' : 'Like',
                  onTap: onToggleLike,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _PollOptionButton extends StatelessWidget {
  const _PollOptionButton({
    required this.option,
    required this.totalVotes,
    required this.isSelected,
    this.onTap,
  });

  final PollOptionSummary option;
  final int totalVotes;
  final bool isSelected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final percent = totalVotes == 0 ? 0.0 : option.votesCount / totalVotes;

    return Material(
      color: isSelected ? colors.primaryContainer : colors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(
          color: isSelected ? colors.primary : colors.outlineVariant,
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Stack(
          children: [
            Positioned.fill(
              child: TweenAnimationBuilder<double>(
                tween: Tween<double>(end: percent.clamp(0, 1)),
                duration: const Duration(milliseconds: 350),
                curve: Curves.easeOutCubic,
                builder: (context, animatedPercent, child) {
                  return FractionallySizedBox(
                    alignment: Alignment.centerLeft,
                    widthFactor: animatedPercent,
                    child: child,
                  );
                },
                child: ColoredBox(
                  color: colors.primary.withValues(
                    alpha: isSelected ? 0.18 : 0.08,
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      option.text,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontWeight:
                            isSelected ? FontWeight.w700 : FontWeight.w500,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  TweenAnimationBuilder<double>(
                    tween: Tween<double>(end: percent * 100),
                    duration: const Duration(milliseconds: 350),
                    curve: Curves.easeOutCubic,
                    builder: (context, animatedPercent, child) {
                      return Text(
                        '${animatedPercent.round()}%',
                        style: TextStyle(
                          color: colors.onSurfaceVariant,
                          fontWeight: FontWeight.w700,
                        ),
                      );
                    },
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({
    required this.icon,
    required this.label,
    this.isActive = false,
    this.animatedValue,
    this.tooltip,
    this.onTap,
  });

  final IconData icon;
  final String label;
  final bool isActive;
  final int? animatedValue;
  final String? tooltip;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    final content = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          icon,
          size: 18,
          color: isActive ? colors.error : colors.onSurfaceVariant,
        ),
        const SizedBox(width: 6),
        if (animatedValue == null)
          Text(
            label,
            style: Theme.of(
              context,
            ).textTheme.bodySmall?.copyWith(color: colors.onSurfaceVariant),
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
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: colors.onSurfaceVariant),
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
