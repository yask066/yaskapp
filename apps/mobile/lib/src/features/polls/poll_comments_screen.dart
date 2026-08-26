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
    this.reportsApiClient,
    super.key,
  });

  final PollSummary poll;
  final String accessToken;
  final PollsApiClient pollsApiClient;
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
    return widget.pollsApiClient.listComments(pollId: _poll.id).then((
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
        body: SafeArea(
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
                      constraints: const BoxConstraints.tightFor(width: 24, height: 24),
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
                          PollCard(poll: _poll),
                          const _CommentsLoadingState(),
                        ],
                      );
                    }

                    if (snapshot.hasError) {
                      return ListView(
                        padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                        children: [
                          PollCard(poll: _poll),
                          _CommentsErrorState(onRetry: _retryComments),
                        ],
                      );
                    }

                    final comments = _comments ?? snapshot.data ?? [];

                    return ListView(
                      padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                      children: [
                        PollCard(poll: _poll),
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
                              onReport: () => _reportComment(comment),
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
            ],
          ),
        ),
        bottomNavigationBar: SafeArea(
          top: false,
          child: _CommentComposer(
            controller: _commentController,
            isSubmitting: _isSubmittingComment,
            onSubmit: _submitComment,
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
  const _CommentTile({required this.comment, this.onReport});

  final PollCommentSummary comment;
  final VoidCallback? onReport;

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
                    Icon(
                      Icons.favorite_border,
                      size: 18,
                      color: _commentsSecondaryText,
                    ),
                    const SizedBox(width: 8),
                    const Text(
                      'Like',
                      style: TextStyle(color: _commentsSecondaryText, fontSize: 14),
                    ),
                    const SizedBox(width: 20),
                    const Text(
                      'Reply',
                      style: TextStyle(color: _commentsSecondaryText, fontSize: 14),
                    ),
                    const Spacer(),
                    if (onReport != null)
                      IconButton(
                        tooltip: 'More',
                        onPressed: onReport,
                        icon: const Icon(
                          Icons.more_horiz,
                          color: _commentsPrimaryText,
                          size: 20,
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
