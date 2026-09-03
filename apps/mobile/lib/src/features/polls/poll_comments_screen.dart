import 'package:flutter/material.dart';

import '../../core/widgets/user_avatar.dart';
import 'poll_card.dart';
import 'poll_summary.dart';
import 'polls_api_client.dart';
import '../reports/report_dialog.dart';
import '../reports/reports_api_client.dart';

const _commentsNavy = Color(0xFF566A9D);
const _commentsPrimaryText = Color(0xFF10142D);
const _commentsSecondaryText = Color(0xFF667085);
const _commentsDivider = Color(0xFFEAECF0);

class PollCommentsScreen extends StatefulWidget {
  const PollCommentsScreen({
    required this.poll,
    required this.accessToken,
    required this.pollsApiClient,
    this.currentUserId,
    this.reportsApiClient,
    super.key,
  });

  final PollSummary poll;
  final String accessToken;
  final PollsApiClient pollsApiClient;
  final String? currentUserId;
  final ReportsApiClient? reportsApiClient;

  @override
  State<PollCommentsScreen> createState() => _PollCommentsScreenState();
}

class _PollCommentsScreenState extends State<PollCommentsScreen> {
  final _commentController = TextEditingController();
  late Future<List<PollCommentSummary>> _commentsFuture;
  late PollSummary _poll;
  List<PollCommentSummary>? _comments;
  bool _isSubmittingComment = false;
  bool _isDeletingComment = false;
  final Set<String> _likingCommentIds = {};
  late final ReportsApiClient _reportsApiClient;
  late final bool _ownsReportsApiClient;

  @override
  void initState() {
    super.initState();
    _poll = widget.poll;
    _ownsReportsApiClient = widget.reportsApiClient == null;
    _reportsApiClient = widget.reportsApiClient ?? ReportsApiClient();
    _commentsFuture = _loadComments();
  }

  @override
  void dispose() {
    _commentController.dispose();
    if (_ownsReportsApiClient) _reportsApiClient.close();
    super.dispose();
  }

  Future<void> _reportComment(PollCommentSummary comment) {
    return showReportDialog(
      context: context,
      accessToken: widget.accessToken,
      targetType: 'comment',
      targetId: comment.id,
      reportsApiClient: _reportsApiClient,
    );
  }

  Future<List<PollCommentSummary>> _loadComments() {
    return widget.pollsApiClient.listComments(
      pollId: _poll.id,
      accessToken: widget.accessToken,
    ).then((
      comments,
    ) {
      _comments = comments;

      return comments;
    });
  }

  void _retryComments() {
    setState(() {
      _comments = null;
      _commentsFuture = _loadComments();
    });
  }

  Future<void> _submitComment() async {
    final body = _commentController.text.trim();

    if (_isSubmittingComment || body.isEmpty) {
      return;
    }

    setState(() {
      _isSubmittingComment = true;
    });

    try {
      final result = await widget.pollsApiClient.createComment(
        pollId: _poll.id,
        body: body,
        accessToken: widget.accessToken,
      );

      if (!mounted) {
        return;
      }

      final updatedComments = [
        ...?_comments,
        result.comment,
      ];

      _commentController.clear();

      setState(() {
        _poll = result.poll;
        _comments = updatedComments;
        _commentsFuture = Future.value(updatedComments);
      });
    } on PollsApiException catch (error) {
      _showSnackBar(error.message);
    } catch (_) {
      _showSnackBar('Could not post comment.');
    } finally {
      if (mounted) {
        setState(() {
          _isSubmittingComment = false;
        });
      }
    }
  }

  Future<void> _toggleCommentLike(PollCommentSummary comment) async {
    if (_likingCommentIds.contains(comment.id)) {
      return;
    }

    setState(() => _likingCommentIds.add(comment.id));

    try {
      final updated = comment.viewerHasLiked
          ? await widget.pollsApiClient.unlikeComment(
              pollId: _poll.id,
              commentId: comment.id,
              accessToken: widget.accessToken,
            )
          : await widget.pollsApiClient.likeComment(
              pollId: _poll.id,
              commentId: comment.id,
              accessToken: widget.accessToken,
            );
      if (!mounted) return;

      final comments = (_comments ?? []).map((item) {
        return item.id == updated.id ? updated : item;
      }).toList();
      setState(() {
        _comments = comments;
        _commentsFuture = Future.value(comments);
      });
    } on PollsApiException catch (error) {
      _showSnackBar(error.message);
    } catch (_) {
      _showSnackBar('Could not update comment like.');
    } finally {
      if (mounted) setState(() => _likingCommentIds.remove(comment.id));
    }
  }

  Future<void> _deleteComment(PollCommentSummary comment) async {
    if (_isDeletingComment) {
      return;
    }

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete comment?'),
        content: const Text('This comment will be removed permanently.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) {
      return;
    }

    setState(() => _isDeletingComment = true);

    try {
      await widget.pollsApiClient.deleteComment(
        pollId: _poll.id,
        commentId: comment.id,
        accessToken: widget.accessToken,
      );

      if (!mounted) {
        return;
      }

      final updatedComments = (_comments ?? [])
          .where((item) => item.id != comment.id)
          .toList();
      final updatedPoll = _poll.copyWith(
        commentsCount: _poll.commentsCount > 0 ? _poll.commentsCount - 1 : 0,
      );

      setState(() {
        _poll = updatedPoll;
        _comments = updatedComments;
        _commentsFuture = Future.value(updatedComments);
      });
      _showSnackBar('Comment deleted.');
    } on PollsApiException catch (error) {
      _showSnackBar(error.userMessage);
    } catch (_) {
      _showSnackBar('Could not delete comment.');
    } finally {
      if (mounted) {
        setState(() => _isDeletingComment = false);
      }
    }
  }

  void _showSnackBar(String message) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  void _closeWithResult() {
    Navigator.of(context).pop(_poll);
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) {
          return;
        }

        _closeWithResult();
      },
      child: Scaffold(
        backgroundColor: Colors.white,
        resizeToAvoidBottomInset: false,
        body: AnimatedPadding(
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOut,
          padding: EdgeInsets.only(
            bottom: MediaQuery.viewInsetsOf(context).bottom,
          ),
          child: SafeArea(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  height: 64,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    child: Row(
                      children: [
                        IconButton(
                          tooltip: 'Back',
                          onPressed: _closeWithResult,
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints.tightFor(
                              width: 24, height: 24),
                          icon: const Icon(Icons.arrow_back_ios_new, size: 24),
                        ),
                        const SizedBox(width: 16),
                        const Text(
                          'Comments',
                          style: TextStyle(
                            color: _commentsPrimaryText,
                            fontSize: 23,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                Expanded(
                  child: FutureBuilder<List<PollCommentSummary>>(
                    future: _commentsFuture,
                    builder: (context, snapshot) {
                      if (snapshot.connectionState == ConnectionState.waiting) {
                        return ListView(
                          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                          children: [
                            PollCard(
                                poll: _poll, accessToken: widget.accessToken),
                            const _CommentsLoadingState(),
                          ],
                        );
                      }

                      if (snapshot.hasError) {
                        return ListView(
                          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                          children: [
                            PollCard(
                                poll: _poll, accessToken: widget.accessToken),
                            _CommentsErrorState(onRetry: _retryComments),
                          ],
                        );
                      }

                      final comments = _comments ?? snapshot.data ?? [];

                      return ListView(
                        padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                        children: [
                          PollCard(
                              poll: _poll, accessToken: widget.accessToken),
                          const SizedBox(height: 26),
                          Row(
                            children: [
                              Text(
                                '${comments.length} comments',
                                style: const TextStyle(
                                  color: _commentsSecondaryText,
                                  fontSize: 15,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                              const Spacer(),
                              const Text(
                                'Newest',
                                style: TextStyle(
                                  color: _commentsSecondaryText,
                                  fontSize: 15,
                                ),
                              ),
                              const Icon(
                                Icons.keyboard_arrow_down,
                                color: _commentsSecondaryText,
                                size: 18,
                              ),
                            ],
                          ),
                          const Divider(
                            height: 32,
                            color: _commentsDivider,
                          ),
                          if (comments.isEmpty)
                            const _CommentsEmptyState()
                          else
                            for (final comment in comments) ...[
                              _CommentTile(
                                comment: comment,
                                onDelete: widget.currentUserId == comment.author.id
                                    ? () => _deleteComment(comment)
                                    : null,
                                onReport: widget.currentUserId != null &&
                                        widget.currentUserId != comment.author.id
                                    ? () => _reportComment(comment)
                                    : null,
                                onToggleLike: _likingCommentIds.contains(comment.id)
                                    ? null
                                    : () => _toggleCommentLike(comment),
                              ),
                              const Divider(
                                height: 1,
                                indent: 76,
                                color: _commentsDivider,
                              ),
                            ],
                        ],
                      );
                    },
                  ),
                ),
                _CommentComposer(
                  controller: _commentController,
                  isSubmitting: _isSubmittingComment,
                  onSubmit: _submitComment,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _CommentComposer extends StatelessWidget {
  const _CommentComposer({
    required this.controller,
    required this.isSubmitting,
    required this.onSubmit,
  });

  final TextEditingController controller;
  final bool isSubmitting;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Colors.white,
        border: const Border(top: BorderSide(color: _commentsDivider)),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(
              child: SizedBox(
                height: 48,
                child: TextField(
                  controller: controller,
                  enabled: !isSubmitting,
                  minLines: 1,
                  maxLines: 1,
                  maxLength: 1000,
                  textInputAction: TextInputAction.done,
                  decoration: InputDecoration(
                    hintText: 'Add a comment...',
                    counterText: '',
                    filled: true,
                    fillColor: Colors.white,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 20),
                    hintStyle: const TextStyle(
                      color: _commentsSecondaryText,
                      fontSize: 16,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(24),
                      borderSide: const BorderSide(color: _commentsDivider),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(24),
                      borderSide: const BorderSide(color: _commentsDivider),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(24),
                      borderSide: const BorderSide(color: _commentsNavy),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 10),
            IconButton(
              tooltip: 'Post comment',
              onPressed: isSubmitting ? null : onSubmit,
              style: IconButton.styleFrom(
                backgroundColor: _commentsNavy,
                foregroundColor: Colors.white,
                disabledBackgroundColor: const Color(0xFFBFC2D8),
                disabledForegroundColor: Colors.white,
                fixedSize: const Size(48, 48),
              ),
              icon: isSubmitting
                  ? const SizedBox.square(
                      dimension: 22,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.send_rounded, size: 24),
            ),
          ],
        ),
      ),
    );
  }
}

class _CommentsLoadingState extends StatelessWidget {
  const _CommentsLoadingState();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 24),
      child: Center(
        child: SizedBox.square(
          dimension: 28,
          child: CircularProgressIndicator(strokeWidth: 3),
        ),
      ),
    );
  }
}

class _CommentsEmptyState extends StatelessWidget {
  const _CommentsEmptyState();

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 48),
      child: Column(
        children: [
          Icon(Icons.mode_comment_outlined, color: colors.onSurfaceVariant),
          const SizedBox(height: 8),
          Text(
            'No comments yet',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 6),
          Text(
            'Be the first to join the discussion.',
            textAlign: TextAlign.center,
            style: TextStyle(color: colors.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

class _CommentsErrorState extends StatelessWidget {
  const _CommentsErrorState({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 48, horizontal: 24),
      child: Column(
        children: [
          Icon(Icons.cloud_off_outlined, color: colors.onSurfaceVariant),
          const SizedBox(height: 8),
          Text(
            'Could not load comments',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}

class _CommentTile extends StatelessWidget {
  const _CommentTile({
    required this.comment,
    this.onDelete,
    this.onReport,
    this.onToggleLike,
  });

  final PollCommentSummary comment;
  final VoidCallback? onDelete;
  final VoidCallback? onReport;
  final VoidCallback? onToggleLike;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          UserAvatar(
            displayName: comment.author.displayName,
            username: comment.author.username,
            imageUrl: comment.author.avatarUrl,
            radius: 22,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        comment.author.displayName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: _commentsPrimaryText,
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      comment.createdLabel,
                      style: const TextStyle(
                        color: _commentsSecondaryText,
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  comment.body,
                  style: const TextStyle(
                    color: _commentsPrimaryText,
                    fontSize: 16,
                    height: 21 / 16,
                  ),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    IconButton(
                      key: ValueKey('like-comment-${comment.id}'),
                      tooltip: comment.viewerHasLiked ? 'Unlike comment' : 'Like comment',
                      onPressed: onToggleLike,
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints.tightFor(width: 24, height: 24),
                      alignment: Alignment.centerRight,
                      icon: Icon(
                        comment.viewerHasLiked ? Icons.favorite : Icons.favorite_border,
                        size: 18,
                        color: comment.viewerHasLiked ? Colors.redAccent : _commentsSecondaryText,
                      ),
                    ),
                    const SizedBox(width: 1),
                    Text(
                      '${comment.likesCount}',
                      style: TextStyle(
                          color: _commentsSecondaryText, fontSize: 14),
                    ),
                    const SizedBox(width: 20),
                    const Text(
                      'Reply',
                      style: TextStyle(
                          color: _commentsSecondaryText, fontSize: 14),
                    ),
                    const Spacer(),
                    if (onDelete != null || onReport != null)
                      SizedBox(
                        width: 40,
                        height: 40,
                        child: PopupMenuButton<_CommentAction>(
                          tooltip: 'More',
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(minWidth: 220),
                          menuPadding: const EdgeInsets.symmetric(vertical: 8),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                          ),
                          elevation: 6,
                          icon: const Icon(Icons.more_vert, size: 22),
                          onSelected: (action) {
                            if (action == _CommentAction.deleteComment) {
                              onDelete?.call();
                            } else if (action == _CommentAction.report) {
                              onReport?.call();
                            }
                          },
                          itemBuilder: (context) => [
                            if (onDelete != null)
                              const PopupMenuItem<_CommentAction>(
                                value: _CommentAction.deleteComment,
                                height: 52,
                                child: _CommentMenuRow(
                                  icon: Icons.delete_outline,
                                  label: 'Delete comment',
                                  destructive: true,
                                ),
                              ),
                            if (onReport != null)
                              const PopupMenuItem<_CommentAction>(
                                value: _CommentAction.report,
                                height: 52,
                                child: _CommentMenuRow(
                                  icon: Icons.flag_outlined,
                                  label: 'Report',
                                ),
                              ),
                          ],
                        ),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

enum _CommentAction { deleteComment, report }

class _CommentMenuRow extends StatelessWidget {
  const _CommentMenuRow({
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
